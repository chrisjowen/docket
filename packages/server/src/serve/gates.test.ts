import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { TOOL_DEFINITIONS, surfaceOf } from '@chrisjowen/docket/mcp/surface'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { STORES, makeDatabase, startTestServe, type TestServe } from '../../test/serve.js'
import { revokeToken, createToken } from './tokens.js'

/**
 * `docket serve` end to end, over HTTP, once over a project's files (the
 * default, with no database) and once over Postgres: two people's tokens - an
 * owner's and an editor's - remember, search, propose and publish an ontology
 * change with a migration; the editor's publish is refused unless the server
 * allows editors; a stale `expectedHead` is refused; and the projections are
 * rebuilt from the canonical documents after the index is dropped.
 */

const EVIDENCE = [{ source: 'human', note: 'Said in planning.' }]

/** Searches until `id` is found or the projections have caught up: they project writes in the background. */
async function found(serve: TestServe, query: string): Promise<string[]> {
  await serve.running.backend.indexed(serve.running.backend.workspaces[0] as never)
  // The facts the projections hold, not the activity log's timeline, which a Postgres store searches as well.
  const answer = await serve.call(serve.tokens.editor, 'docket_search', { query, include: ['facts'] })
  return ((answer.result?.structuredContent?.matches ?? []) as { id: string }[]).map((match) => match.id)
}

describe.each(STORES)('docket serve over $kind', ({ kind, skip }) => {
  let serve: TestServe
  let database: Awaited<ReturnType<typeof makeDatabase>> | null = null

  beforeAll(async () => {
    if (skip) return
    database = kind === 'postgres' ? await makeDatabase() : null
    serve = await startTestServe(kind, database ? { database: database.url } : {})
  })
  afterAll(async () => {
    await serve?.close()
    await database?.drop()
  })

  it.skipIf(skip)('answers health and readiness, and refuses a call without a token', async () => {
    expect(await (await fetch(`${serve.running.url}/healthz`)).json()).toMatchObject({ status: 'ok', store: kind })
    expect(await (await fetch(`${serve.running.url}/readyz`)).json()).toMatchObject({ status: 'ready' })
    const anonymous = await fetch(serve.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('www-authenticate')).toMatch(/^Bearer resource_metadata=/)
  })

  it.skipIf(skip)("offers Docket's whole MCP surface to an owner, and the editor every tool but publishing", async () => {
    const owner = await serve.rpc(serve.tokens.owner, 'tools/list')
    expect((owner.body.result.tools as never[]).map(surfaceOf)).toEqual(TOOL_DEFINITIONS.map(surfaceOf))
    const editor = await serve.rpc(serve.tokens.editor, 'tools/list')
    expect((editor.body.result.tools as { name: string }[]).map((tool) => tool.name)).toEqual(
      TOOL_DEFINITIONS.map((tool) => tool.name).filter((name) => name !== 'docket_publish_ontology_change')
    )
  })

  it.skipIf(skip)('remembers through one token and finds it through the other', async () => {
    for (const [id, type, title, body] of [
      ['team.payments', 'team', 'Payments', 'The payments team owns checkout money movement.'],
      ['service.ledger', 'service', 'Ledger', 'Keeps the double-entry books for every order.']
    ] as const) {
      const written = await serve.call(serve.tokens.owner, 'docket_remember', { id, type, title, body, evidence: EVIDENCE })
      expect(written.result?.isError, written.text).toBeUndefined()
    }
    const linked = await serve.call(serve.tokens.editor, 'docket_add_evidence', {
      id: 'service.ledger',
      evidence: [{ source: 'human', note: 'The editor saw it too.' }]
    })
    expect(linked.result?.structuredContent).toMatchObject({ ok: true })
    expect(await found(serve, 'double-entry books ledger')).toContain('service.ledger')
  })

  it.skipIf(skip)('proposes a change as a draft and publishes it with a migration, as the owner', async () => {
    const proposed = await serve.call(serve.tokens.editor, 'docket_propose_ontology_change', { patch: 'resourceTypes:\n  squad:\n    description: A squad.\n', message: 'Squads.' })
    expect(proposed.result?.structuredContent).toMatchObject({ schema: 'docket-ontology-proposal.v1', head: 1 })

    const head = (await serve.call(serve.tokens.owner, 'docket_ontology', {})).result?.structuredContent as { version: number }
    const published = await serve.call(serve.tokens.owner, 'docket_publish_ontology_change', {
      patch: 'resourceTypes:\n  squad:\n    description: A squad.\n',
      migration: [{ op: 'mapType', from: 'team', to: 'squad' }],
      acceptNarrowing: true,
      expectedHead: head.version,
      message: 'Teams are squads now.'
    })
    expect(published.result?.isError, published.text).toBeUndefined()
    const answer = published.result?.structuredContent as { version: number; rewritten: { resourceId: string }[] }
    expect(answer.version).toBe(head.version + 1)
    expect(answer.rewritten.map((each) => each.resourceId)).toContain('team.payments')
    const payments = await serve.call(serve.tokens.editor, 'docket_get', { id: 'team.payments' })
    expect(payments.result?.structuredContent?.resource?.type).toBe('squad')
  })

  it.skipIf(skip)("refuses the editor's publish, and a stale expectedHead", async () => {
    const editor = await serve.call(serve.tokens.editor, 'docket_publish_ontology_change', { patch: 'resourceTypes:\n  queue:\n    description: A queue.\n' })
    expect(editor.status).toBe(403)
    const stale = await serve.call(serve.tokens.owner, 'docket_publish_ontology_change', { patch: 'resourceTypes:\n  queue:\n    description: A queue.\n', expectedHead: 1 })
    expect(stale.result?.isError).toBe(true)
    expect(stale.text).toMatch(/Nothing was published: the draft was made against v1, but the head is now v2/)
  })

  it.skipIf(skip)('refuses a token in the URL, and a revoked token from its next call', async () => {
    const inUrl = await fetch(`${serve.mcpUrl}?access_token=${serve.tokens.owner}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(inUrl.status).toBe(400)
    const { token, record } = await createToken(serve.config, { name: 'short-lived', role: 'viewer' })
    expect((await serve.rpc(token, 'tools/list')).status).toBe(200)
    expect(await revokeToken(serve.config, record.name)).toBe(true)
    expect((await serve.rpc(token, 'tools/list')).status).toBe(401)
  })

  it.skipIf(skip)('a viewer reads and is refused writes', async () => {
    const { token } = await createToken(serve.config, { name: 'reader', role: 'viewer' })
    const listed = await serve.rpc(token, 'tools/list')
    expect((listed.body.result.tools as { name: string }[]).map((tool) => tool.name)).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])
    const write = await serve.call(token, 'docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: EVIDENCE })
    expect(write.status).toBe(403)
  })

  it.skipIf(skip)('answers docket_ask that it is off without a model, while search works', async () => {
    const asked = await serve.call(serve.tokens.owner, 'docket_ask', { question: 'Who keeps the books?' })
    expect(asked.result?.isError).toBe(true)
    expect(asked.text).toMatch(/docket_ask is off on this server/)
  })

  it.skipIf(skip)('rebuilds the projections from the canonical documents after the index is dropped', async () => {
    expect(await found(serve, 'double-entry books ledger')).toContain('service.ledger')
    const index =
      kind === 'files'
        ? join(serve.project, '.docket/.index')
        : join(serve.config.dataDir, 'index', serve.config.workspaces[0]?.slug as string, '.index')
    await rm(index, { recursive: true, force: true })
    expect(await found(serve, 'double-entry books ledger')).not.toContain('service.ledger')

    const slug = serve.config.workspaces[0]?.slug as string
    const refused = await fetch(`${serve.running.url}/api/w/${slug}/rebuild`, { method: 'POST', headers: { authorization: `Bearer ${serve.tokens.editor}` } })
    expect(refused.status).toBe(403)
    const rebuilt = await fetch(`${serve.running.url}/api/w/${slug}/rebuild`, { method: 'POST', headers: { authorization: `Bearer ${serve.tokens.owner}` } })
    expect(rebuilt.status).toBe(200)
    expect(await found(serve, 'double-entry books ledger')).toContain('service.ledger')
  })

  it.skipIf(skip)('keeps an audit log of every call, with arguments only as a digest', async () => {
    const lines = (await readFile(join(serve.config.dataDir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines.some((line) => line.action === 'mcp.tools/call docket_remember' && line.outcome === 'ok')).toBe(true)
    expect(lines.some((line) => line.action === 'mcp.tools/call docket_publish_ontology_change' && line.outcome === 'denied')).toBe(true)
    expect(JSON.stringify(lines)).not.toContain('double-entry')
  })
})

describe.each(STORES)('docket serve over $kind, with editors allowed to publish', ({ kind, skip }) => {
  let serve: TestServe
  let database: Awaited<ReturnType<typeof makeDatabase>> | null = null
  beforeAll(async () => {
    if (skip) return
    database = kind === 'postgres' ? await makeDatabase() : null
    serve = await startTestServe(kind, { env: { DOCKET_ONTOLOGY_MCP_WRITERS: 'owner,editor' }, ...(database ? { database: database.url } : {}) })
  })
  afterAll(async () => {
    await serve?.close()
    await database?.drop()
  })

  it.skipIf(skip)("publishes the editor's change", async () => {
    const published = await serve.call(serve.tokens.editor, 'docket_publish_ontology_change', { patch: 'resourceTypes:\n  queue:\n    description: A queue.\n', expectedHead: 1 })
    expect(published.result?.isError, published.text).toBeUndefined()
    expect(published.result?.structuredContent).toMatchObject({ version: 2, previous: 1 })
  })
})
