import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { readFixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, type TestStore } from '../../test/postgres.js'
import type { AuditEventInput, AuditSink, Principal, StoreContext } from '../ports.js'
import { createWorkspace, listDocuments, listIngests } from '../postgres/index.js'
import { handleMcp, type McpHandlerOptions } from './handler.js'

/**
 * The endpoint end to end over a real store: a write and its audit event
 * commit in one transaction, and a refused write leaves neither behind.
 */
describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('the MCP endpoint over $name', (kind) => {
  let test: TestStore
  let workspaceId: string
  const RESOURCE = 'https://docket.test/mcp/platform'

  beforeAll(async () => {
    test = await createTestStore(kind)
    const fixture = await readFixture()
    workspaceId = await test.as(async (ctx) => {
      const { workspace } = await createWorkspace(ctx, { name: 'Platform', slug: 'platform', start: { importYaml: fixture.ontology }, publisher: { actor: 'user:owner', login: 'owner' } })
      await ctx.tx.query('CREATE TABLE audit_log (seq serial PRIMARY KEY, in_tx boolean NOT NULL, action text NOT NULL, outcome text NOT NULL, target text[] NOT NULL)')
      return workspace.id
    })
  })
  afterAll(() => test?.drop())

  /** An audit sink that writes into the store: inside the write's transaction when it is given one. */
  const sink: AuditSink = {
    async record(ctx: StoreContext | null, event: AuditEventInput) {
      const write = (tx: StoreContext['tx'], inTx: boolean) =>
        tx.query('INSERT INTO audit_log (in_tx, action, outcome, target) VALUES ($1, $2, $3, $4)', [inTx, event.action, event.outcome, event.target ?? []])
      if (ctx) await write(ctx.tx, true)
      else await test.as(({ tx }) => write(tx, false))
    }
  }

  const options = (overrides: Partial<McpHandlerOptions> = {}): McpHandlerOptions => ({
    resourceUrl: RESOURCE,
    resource: { url: RESOURCE, workspaceId },
    authenticator: {
      resolve: async (bearer): Promise<Principal | null> =>
        bearer === 'token-editor' ? { subject: 'u-bot', workspaceId, scopes: ['docket:read', 'docket:write', 'ontology:propose'], actor: 'token:bot' } : null
    },
    authorizer: { role: async () => 'editor' },
    audit: () => sink,
    store: () => test.store,
    query: () => ({ search: vi.fn(), ask: vi.fn() }),
    links: () => ({ viewer: 'https://docket.test/w/platform/graph', ontologyHistory: 'https://docket.test/w/platform/ontology/history' }),
    writerLabel: async () => 'ci-bot (token tok_bot…)',
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    ...overrides
  })

  const call = (name: string, args: unknown, overrides: Partial<McpHandlerOptions> = {}) =>
    handleMcp(
      new Request(RESOURCE, {
        method: 'POST',
        headers: { authorization: 'Bearer token-editor', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } })
      }),
      options(overrides)
    )

  const auditRows = () => test.as(async ({ tx }) => (await tx.query('SELECT in_tx, action, outcome, target FROM audit_log ORDER BY seq')).rows)

  it('writes with evidence, records the write in the activity log, and audits it once inside the write’s transaction', async () => {
    const before = (await auditRows()).length
    const response = await call('docket_remember', { id: 'service.ledger', type: 'service', title: 'Ledger', evidence: [{ source: 'human', note: 'seen in the runbook' }] })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { structuredContent: Record<string, unknown>; isError?: boolean } }
    expect(body.result.isError).toBeUndefined()
    expect(body.result.structuredContent).toMatchObject({ ok: true, created: true, path: '.docket/resources/service/ledger.md' })
    expect((await auditRows()).slice(before)).toEqual([{ in_tx: true, action: 'mcp.tools/call docket_remember', outcome: 'ok', target: ['service.ledger'] }])
    const events = await test.as((ctx) => listIngests(ctx, { workspaceId, resourceId: 'service.ledger' }))
    expect(events[0]).toMatchObject({ channel: 'mcp', action: 'remember', actor: 'token:bot', actorLabel: 'ci-bot (token tok_bot…)' })
  })

  it('rolls the audit event back with a write that fails, and audits the failure once', async () => {
    const before = (await auditRows()).length
    const failing: AuditSink = {
      record: async (ctx, event) => {
        if (ctx) throw new Error('the audit log is unavailable')
        await sink.record(null, event)
      }
    }
    const response = await call('docket_remember', { id: 'service.vault', type: 'service', title: 'Vault', evidence: [{ source: 'human' }] }, { audit: () => failing })
    const body = (await response.json()) as { error?: { code: number } }
    expect(body.error?.code).toBe(-32603)
    expect((await test.as(({ tx }) => listDocuments(tx, workspaceId))).some((document) => document.resourceId === 'service.vault')).toBe(false)
    expect((await auditRows()).slice(before)).toEqual([{ in_tx: false, action: 'mcp.tools/call docket_remember', outcome: 'error', target: ['service.vault'] }])
  })

  it('audits a refused write as invalid, with the refusal in the activity log', async () => {
    const before = (await auditRows()).length
    const response = await call('docket_remember', { id: 'service.nothing', type: 'service', title: 'Nothing', evidence: [] })
    const body = (await response.json()) as { result: { isError?: boolean; content: { text: string }[] } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]?.text).toContain('missing-evidence')
    expect((await auditRows()).slice(before)).toEqual([{ in_tx: true, action: 'mcp.tools/call docket_remember', outcome: 'invalid', target: ['service.nothing'] }])
  })

  it('reads the ontology and a resource through the same endpoint, each audited once outside any write', async () => {
    const before = (await auditRows()).length
    const ontology = (await (await call('docket_ontology', {})).json()) as { result: { structuredContent: { version: number } } }
    expect(ontology.result.structuredContent.version).toBe(1)
    const resource = (await (await call('docket_get', { id: 'service.ledger' })).json()) as { result: { structuredContent: { resource: { title: string } } } }
    expect(resource.result.structuredContent.resource.title).toBe('Ledger')
    expect((await auditRows()).slice(before).map((row: { in_tx: boolean; outcome: string }) => [row.in_tx, row.outcome])).toEqual([
      [false, 'ok'],
      [false, 'ok']
    ])
  })
})
