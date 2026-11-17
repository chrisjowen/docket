import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { STORE_KINDS, TEST_PG_URL, createTestStore, type TestStore } from '../../test/postgres.js'
import { OntologyBreakingChange } from '../ontology/errors.js'
import { template } from '../ontology/templates.js'
import type { StoreContext } from '../ports.js'
import type { RememberInput, Writer } from '../write/inputs.js'
import { createDraft, createWorkspace, headOf, listDocuments, publish, writeResource } from './index.js'

const publisher = { actor: 'user:owner', login: 'owner' }

/** The blank template with the given resource types. */
function withTypes(types: readonly string[]): string {
  const doc = parseDocument(template('blank').yaml)
  for (const type of types) doc.setIn(['resourceTypes', type], { description: `A ${type}.` })
  return doc.toString()
}

/** A promise and the function that settles it: a gate a transaction waits at. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { opened, open }
}

const settledWithin = async (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true, () => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))])

/**
 * An ontology publish racing a write (Review Focus): the write is validated
 * inside its transaction against the head it commits under, with the head
 * row held FOR SHARE, so a write validated at v13 is refused with
 * `unknown-type` if v14, which removes its type, won.
 */
describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('publish racing a write over $name', (kind) => {
  let org: TestStore
  const as = <T>(fn: (ctx: StoreContext) => Promise<T>) => org.as(fn)
  let writer: Writer

  const widget = (id: string): RememberInput => ({
    id,
    type: 'widget',
    title: `Widget ${id}`,
    evidence: [{ source: 'human', note: 'seen on the board' }],
  })

  /** A fresh workspace whose head is v13, with the type `widget`, and a v14 draft without it. */
  async function atV13(slug: string) {
    return as(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, { name: slug, slug, start: { template: 'blank' }, publisher })
      for (let n = 2; n <= 13; n += 1) {
        const draft = await createDraft(ctx.tx, workspace.id, { yaml: withTypes(['gadget', 'widget']), source: 'editor', author: publisher.actor })
        await publish(ctx, workspace.id, draft.id, { expectedHead: n - 1, publisher, acceptNarrowing: true })
      }
      const v14 = await createDraft(ctx.tx, workspace.id, { yaml: withTypes(['gadget']), source: 'editor', author: publisher.actor })
      return { workspaceId: workspace.id, v14: v14.id }
    })
  }

  beforeAll(async () => {
    org = await createTestStore(kind)
  })
  afterAll(() => org?.drop())

  it('refuses a write validated at v13 with unknown-type once v14 removes its type', async () => {
    const { workspaceId, v14 } = await atV13('sequential')
    writer = { workspaceId, actor: 'token:dkt_live_race0001', label: 'race-bot (token tok_race…)', channel: 'mcp', requestId: 'req-race-1' }

    // Validated at v13: a dry run passes.
    const atV13Check = await as((ctx) => writeResource(ctx, writer, widget('widget.one'), { dryRun: true }))
    expect(atV13Check.diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    await as((ctx) => publish(ctx, workspaceId, v14, { expectedHead: 13, publisher }))
    expect((await as((ctx) => headOf(ctx.tx, workspaceId)))?.number).toBe(14)

    // The commit validates again, against v14.
    const committed = await as((ctx) => writeResource(ctx, writer, widget('widget.one')))
    expect(committed.documentId).toBeUndefined()
    expect(committed.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'unknown-type' }))
    const records = await as((ctx) => listDocuments(ctx.tx, workspaceId))
    expect(records).toEqual([])
  })

  it('a publish that starts while a write holds the head waits for it, then sees the write', async () => {
    const { workspaceId, v14 } = await atV13('write-first')
    writer = { workspaceId, actor: 'token:dkt_live_race0002', label: 'race-bot (token tok_race…)', channel: 'mcp', requestId: 'req-race-2' }
    const validated = gate()
    const commit = gate()
    const writing = as(async (ctx) => {
      const result = await writeResource(ctx, writer, widget('widget.two'))
      validated.open()
      await commit.opened
      return result
    })
    await validated.opened
    const publishing = as((ctx) => publish(ctx, workspaceId, v14, { expectedHead: 13, publisher }))
    // The head is held FOR SHARE by the write: the publish cannot take it yet.
    expect(await settledWithin(publishing, 300)).toBe(false)
    commit.open()
    const written = await writing
    expect(written.changed).toBe(true)
    // Now the publish sees widget.two, and v14 would break it.
    await expect(publishing).rejects.toBeInstanceOf(OntologyBreakingChange)
    expect((await as((ctx) => headOf(ctx.tx, workspaceId)))?.number).toBe(13)
  })

  it('a write that starts while a publish holds the head waits, then validates against the new head', async () => {
    const { workspaceId, v14 } = await atV13('publish-first')
    writer = { workspaceId, actor: 'token:dkt_live_race0003', label: 'race-bot (token tok_race…)', channel: 'mcp', requestId: 'req-race-3' }
    const published = gate()
    const commit = gate()
    const publishing = as(async (ctx) => {
      const version = await publish(ctx, workspaceId, v14, { expectedHead: 13, publisher })
      published.open()
      await commit.opened
      return version
    })
    await published.opened
    const writing = as((ctx) => writeResource(ctx, writer, widget('widget.three')))
    expect(await settledWithin(writing, 300)).toBe(false)
    commit.open()
    expect((await publishing).number).toBe(14)
    const result = await writing
    expect(result.documentId).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-type' }))
  })
})
