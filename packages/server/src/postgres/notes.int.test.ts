import { validate } from '@chrisjowen/docket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import { parseMemoryFile } from '../docket.js'
import type { AppendNotesInput, Writer } from '../write/inputs.js'
import { addEvidence, appendNotes, insertWorkspace, listDocuments, listIngests, postgresSource, putDocument, readDocument, writeResource } from './index.js'

const NOW = new Date('2026-11-12T09:30:00.000Z')
const DATE_HEADER = `### Notes added ${NOW.toISOString()}\n\n`

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('appending notes over $name', (kind) => {
  let org: TestStore
  let writer: Writer

  beforeAll(async () => {
    org = await createTestStore(kind)
    const fixture = await readFixture()
    const workspaceId = await org.as((ctx) => seedWorkspace(ctx, { slug: 'notes', ontology: fixture.ontology }))
    writer = { workspaceId, actor: 'user:alice', label: 'Alice', channel: 'mcp', requestId: 'req-append' }
  })
  afterAll(() => org?.drop())

  const append = (input: AppendNotesInput, dryRun = false) => org.as((ctx) => appendNotes(ctx, writer, input, { now: () => NOW, dryRun }))
  const input = (id: string, additionalNotes = 'New observation.') => ({ id, additionalNotes, evidence: [{ source: 'human', note: additionalNotes }] })
  const seed = (id: string, body: string) => org.as((ctx) => writeResource(ctx, writer, { id, type: 'service', title: 'Original title', body, attributes: { tier: 'critical' }, evidence: [{ source: 'human', note: 'original observation' }] }))
  const read = (path: string) => org.as((ctx) => readDocument(ctx, writer.workspaceId, path))

  it('preserves the body, title, attributes, links and evidence, adding dated prose and stamped evidence', async () => {
    const id = 'service.rich-notes'
    const path = '.docket/resources/service/rich-notes.md'
    const raw = '---\nid: service.rich-notes\ntype: service\ntitle: Original title\nattributes:\n  tier: critical\nlinks:\n  - rel: depends_on\n    target: service.rich-notes\n    evidence:\n      - source: human\n        note: original link\nevidence:\n  - source: human\n    note: original observation\n---\nOriginal paragraph.\n\nSecond paragraph.\n'
    await org.as((ctx) => putDocument(ctx, { workspaceId: writer.workspaceId, path, raw, origin: 'cloud', actor: writer.actor }))
    const result = await append(input(id))
    expect(result).toMatchObject({ created: false, changed: true, revision: 2, evidenceAdded: 1, diagnostics: [] })
    const stored = await read(path)
    const parsed = parseMemoryFile(stored?.raw as string, path).document
    expect(parsed?.content.trim()).toBe(`Original paragraph.\n\nSecond paragraph.\n\n---\n\n${DATE_HEADER}New observation.`)
    expect(parsed?.title).toBe('Original title')
    expect(parsed?.attributes).toEqual({ tier: 'critical' })
    expect(parsed?.links).toEqual([expect.objectContaining({ rel: 'depends_on', target: id, evidence: [expect.objectContaining({ note: 'original link' })] })])
    expect(parsed?.evidence).toEqual([
      expect.objectContaining({ note: 'original observation' }),
      expect.objectContaining({ note: 'New observation.', observedBy: 'Alice', session: 'req-append', observedAt: NOW.toISOString() }),
    ])
    const events = await org.as((ctx) => listIngests(ctx, { workspaceId: writer.workspaceId, resourceId: id }))
    expect(events).toEqual([expect.objectContaining({ outcome: 'ok', action: 'remember', evidenceCount: 1, requestId: 'req-append' })])
  })

  it('handles empty notes without a leading separator and does not duplicate evidence on repeated appends', async () => {
    const id = 'service.empty-notes'
    const seeded = await seed(id, '')
    await append(input(id))
    const stored = await read(seeded.path as string)
    expect(parseMemoryFile(stored?.raw as string, seeded.path as string).document?.content.trim()).toBe(`${DATE_HEADER}New observation.`)
    const again = await append(input(id))
    expect(again).toMatchObject({ changed: true, evidenceAdded: 0 })
    const repeated = await read(seeded.path as string)
    const parsed = parseMemoryFile(repeated?.raw as string, seeded.path as string).document
    expect(parsed?.content.trim()).toBe(`${DATE_HEADER}New observation.\n\n---\n\n${DATE_HEADER}New observation.`)
    expect(parsed?.evidence).toHaveLength(2)
  })

  it('adds only the new notes in a cloud document, leaving repo and CLI bodies untouched', async () => {
    const id = 'service.sourced-notes'
    const raw = `---\nid: ${id}\ntype: service\ntitle: Source notes\n---\n`
    await org.as(async (ctx) => {
      await putDocument(ctx, { workspaceId: writer.workspaceId, path: '.docket/repo-notes.md', raw: `${raw}Repo observations.\n`, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      await putDocument(ctx, { workspaceId: writer.workspaceId, path: '.docket/cli-notes.md', raw: `${raw}CLI observations.\n`, origin: 'cli', originRef: 'checkout1', actor: 'user:alice' })
    })
    const result = await append(input(id))
    expect(result).toMatchObject({ changed: true, created: false, path: '.docket/resources/service/sourced-notes.md' })
    expect((await read('.docket/repo-notes.md'))?.raw).toBe(`${raw}Repo observations.\n`)
    expect((await read('.docket/cli-notes.md'))?.raw).toBe(`${raw}CLI observations.\n`)
    const cloud = await read(result.path as string)
    expect(parseMemoryFile(cloud?.raw as string, result.path as string).document?.content.trim()).toBe(`${DATE_HEADER}New observation.`)
    // Aggregation joins the documents' notes, as docket reads them.
    const aggregated = await org.as((ctx) => validate({ source: postgresSource(ctx, writer.workspaceId) }))
    const entity = aggregated.entities.find((entry) => entry.id === id)
    expect(entity?.content).toContain('Repo observations.')
    expect(entity?.content).toContain('CLI observations.')
    expect(entity?.content).toContain('New observation.')
  })

  it('refuses missing resources, blank/oversized notes, invalid or absent evidence without changing notes', async () => {
    const id = 'service.invalid-notes'
    const seeded = await seed(id, 'Keep me.')
    const before = await read(seeded.path as string)
    const cases: [AppendNotesInput, string][] = [
      [input('service.missing'), 'unknown-resource'],
      [input(id, '  '), 'missing-notes'],
      [input(id, 'x'.repeat(60001)), 'notes-too-long'],
      [{ ...input(id), evidence: [] }, 'missing-evidence'],
      [{ ...input(id), evidence: [{ source: 'rumour' }] }, 'unknown-evidence-source'],
      [{ ...input(id), evidence: [{ source: 'code' }] }, 'evidence-location-missing'],
    ]
    for (const [args, code] of cases) {
      const result = await append(args)
      expect(result.changed).toBe(false)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code }))
    }
    expect((await read(seeded.path as string))?.raw).toBe(before?.raw)
    expect((await read(seeded.path as string))?.revision).toBe(before?.revision)
    const documents = await org.as((ctx) => listDocuments(ctx.tx, writer.workspaceId))
    expect(documents.some((document) => document.resourceId === 'service.missing')).toBe(false)
  })

  it('dry runs leave document revisions and ingest events unchanged', async () => {
    const id = 'service.dry-notes'
    const seeded = await seed(id, 'Original notes.')
    const before = await read(seeded.path as string)
    const events = () => org.as((ctx) => listIngests(ctx, { workspaceId: writer.workspaceId, resourceId: id }))
    const beforeEvents = await events()
    const result = await append(input(id), true)
    expect(result).toMatchObject({ changed: false, created: false, evidenceAdded: 1, diagnostics: [] })
    expect(await read(seeded.path as string)).toEqual(before)
    expect(await events()).toEqual(beforeEvents)
  })

  it('serializes concurrent appends and evidence writes without losing any prose or evidence', async () => {
    const id = 'service.concurrent-notes'
    const seeded = await seed(id, 'Original notes.')
    const additions = ['First addition.', 'Second addition.', 'Third addition.']
    const results = await Promise.all([
      ...additions.map((notes) => append(input(id, notes))),
      org.as((ctx) => addEvidence(ctx, writer, { id, evidence: [{ source: 'human', note: 'independent confirmation' }] })),
    ])
    expect(results.every((result) => result.changed && !result.diagnostics.some((d) => d.severity === 'error'))).toBe(true)
    const stored = await read(seeded.path as string)
    expect(stored?.revision).toBe(5)
    const parsed = parseMemoryFile(stored?.raw as string, seeded.path as string).document
    expect(parsed?.content).toMatch(/^Original notes\./)
    for (const notes of additions) expect(parsed?.content.split(notes)).toHaveLength(2)
    expect(parsed?.evidence).toHaveLength(5)
  })

  it('uses the writer workspace, refusing a resource that exists only elsewhere', async () => {
    const id = 'service.scoped-notes'
    await seed(id, 'Private notes.')
    const other = await org.as((ctx) => insertWorkspace(ctx.tx, { name: 'Other', slug: 'other', createdBy: 'user:owner' }))
    const result = await org.as((ctx) => appendNotes(ctx, { ...writer, workspaceId: other.id }, input(id)))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-resource' }))
    expect(await org.as((ctx) => listDocuments(ctx.tx, other.id))).toEqual([])
  })
})
