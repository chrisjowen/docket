// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt } from 'node:crypto'

import { operation, type Operation, type OperationId } from '@docket/api'
import { argsDigest } from '@docket/platform-audit'
import { SESSION_COOKIE, createSession, csrfToken, issueApiToken, tokenResolver } from '@docket/platform-auth'
import { insertSpace, insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import { upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimiter as addressLimiter } from '../rate-limit'
import type { Runtime } from '../runtime'

let runtime: Runtime
vi.mock('../runtime', () => ({ getRuntime: () => runtime, initRuntime: () => undefined, RuntimeUnavailable: class extends Error {} }))
// Room for a space's own Neo4j however many pods other tests' accounts hold on the shared test database.
const env: Record<string, string | undefined> = { DOCKET_NEO4J_POD_CAPACITY: '100000' }
vi.mock('$env/dynamic/private', () => ({ env }))
const { handle } = await import('../../../hooks.server')
const { handleApiV1 } = await import('./v1')

type Credential = { session: string } | { bearer: string } | null

/**
 * Storage and AI settings on `/api/v1` (tenancy v2 §3.5, §5), against real
 * Postgres: the account's, a space's and a docket's settings need Change
 * settings there (the monthly cap, an owner), every choice stays within the
 * limits of the places above it, and a space's own provider key is
 * write-only - never answered, logged or audited, only its provider and
 * last four characters.
 */
describe.skipIf(!TEST_PG_URL)('storage and AI settings on /api/v1', () => {
  let org: TestOrg
  let other: { orgId: string; userId: string; login: string }
  const slug = () => `o-${org.orgId}`
  const ids: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  const sessions: Record<string, string> = {}
  let eng = ''
  let payments = ''

  const human = (login: string) =>
    org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] }))

  async function member(name: string, role: string | null, place: { kind: 'account' | 'space' | 'docket'; id: string | null } = { kind: 'account', id: null }) {
    const user = await human(`${name}${org.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, user.id])
    if (role) {
      await org.db.admin.query('INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES ($1, $2, $3, $4, $5, $6)', [
        `g_${name}_${org.orgId}`,
        org.orgId,
        user.id,
        place.kind,
        place.id,
        role,
      ])
    }
    return user.id
  }

  const token = (userId: string, input: { readOnly?: boolean; dockets?: string[] | null; orgId?: string } = {}) =>
    org.router.withPlatform(async (tx) =>
      (await issueApiToken(tx, { orgId: input.orgId ?? org.orgId, ownerId: userId, createdBy: userId, readOnly: input.readOnly ?? false, dockets: input.dockets ?? null, name: 'test' })).token,
    )

  /** One call through the hooks, as a client sends it. */
  async function api(as: Credential, method: string, path: string, body?: unknown) {
    const url = new URL(path, 'https://docket.example')
    const headers = new Headers({ 'user-agent': 'settings-test' })
    if (as && 'bearer' in as) headers.set('authorization', `Bearer ${as.bearer}`)
    if (as && 'session' in as && method !== 'GET') headers.set('x-csrf-token', csrfToken(as.session))
    if (body !== undefined) {
      headers.set('content-type', 'application/json')
      headers.set('content-length', String(Buffer.byteLength(JSON.stringify(body))))
    }
    const request = new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const cookie = as && 'session' in as ? as.session : undefined
    const event = {
      url,
      request,
      params: { path: url.pathname.replace(/^\/api\/v1\/?/, '') },
      route: { id: '/api/v1/[...path]' },
      locals: {},
      cookies: { get: (name: string) => (name === SESSION_COOKIE ? cookie : undefined), delete: () => undefined },
      getClientAddress: () => '192.0.2.40',
    } as unknown as RequestEvent
    const response = await handle({ event, resolve: (resolved: RequestEvent) => handleApiV1(resolved) } as never)
    const text = await response.text()
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null, text }
  }

  function conforms(id: OperationId, body: unknown) {
    const schema = (operation(id) as Operation).response
    if (!schema) return
    const result = schema.safeParse(body)
    expect(result.success, `${id}: ${JSON.stringify(result.error?.issues ?? [])}`).toBe(true)
  }

  const as = (name: string): Credential => ({ bearer: tokens[name] as string })
  const at = (path = '') => `/api/v1/accounts/${slug()}${path}`

  beforeAll(async () => {
    org = await createTestOrg({ everyoneReadsGeneral: false })
    other = await org.addOrg()
    eng = (await org.withOrg(({ tx }) => insertSpace(tx, { name: 'Engineering', slug: 'eng', createdBy: org.userId }))).id
    await org.withOrg(({ tx }) => insertSpace(tx, { name: 'Legal', slug: 'legal', createdBy: org.userId }))
    payments = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Payments', slug: 'payments', createdBy: org.userId, spaceId: eng }))).id
    ids.owner = org.userId
    ids.admin = await member('admin', 'admin')
    ids.writer = await member('writer', 'writer')
    ids.engAdmin = await member('engadmin', 'admin', { kind: 'space', id: eng })
    for (const name of ['owner', 'admin', 'writer', 'engAdmin']) tokens[name] = await token(ids[name] as string)
    tokens.ownerReadOnly = await token(org.userId, { readOnly: true })
    tokens.ownerPayments = await token(org.userId, { dockets: [payments] })
    tokens.otherOwner = await token(other.userId, { orgId: other.orgId })
    sessions.owner = (await org.router.withPlatform((tx) => createSession(tx, { userId: org.userId, ip: null, userAgent: null }))).id

    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      tokens: tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 }),
      frameAncestors: "'none'",
      platformAdmins: new Set<string>(),
      maxOrgs: 100,
      cognee: false,
    } as unknown as Runtime
  })
  beforeEach(() => {
    const now = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => now }), now: () => now })
    runtime.refusedAuth = addressLimiter({ limit: 1000, windowMs: 60_000 })
  })
  afterAll(() => org?.drop())

  it('needs Change settings on the place, and an owner for the monthly cap', async () => {
    // A writer changes no settings anywhere.
    for (const path of [at('/settings'), at('/spaces/eng/settings'), at('/dockets/payments/settings')]) {
      const read = await api(as('writer'), 'GET', path)
      expect(read.status, path).toBe(403)
      expect(read.body).toMatchObject({ error: 'forbidden' })
      expect((await api(as('writer'), 'PATCH', path, { models: { synthesis: null } })).status, path).toBe(403)
    }
    expect((await api(as('writer'), 'PATCH', at('/spaces/eng'), { graph: 'own' })).status).toBe(403)

    // An admin on Engineering changes Engineering's settings and its dockets', nowhere else.
    const space = await api(as('engAdmin'), 'GET', at('/spaces/eng/settings'))
    expect(space.status).toBe(200)
    conforms('spaces.settings.get', space.body)
    expect(space.body).toMatchObject({ place: { ref: 'space:eng' }, key: { from: 'account' }, storage: { graph: 'account' }, agents: null })
    const docket = await api(as('engAdmin'), 'GET', at('/dockets/payments/settings'))
    conforms('dockets.settings.get', docket.body)
    expect(docket.body).toMatchObject({ place: { ref: 'docket:payments' }, storage: null, agents: { enrichment: { enabled: false }, cognee: { enabled: false, available: false } } })
    expect((await api(as('engAdmin'), 'GET', at('/settings'))).status).toBe(403)
    expect((await api(as('engAdmin'), 'PATCH', at('/settings'), { models: { synthesis: 'openai/gpt-4.1' } })).status).toBe(403)
    expect((await api(as('engAdmin'), 'PATCH', at('/spaces/legal/settings'), { slice_usd: 1 })).status).toBe(403)
    // Enrichment spends the account's AI and may publish onto the ontology: as in the app, it takes Change settings on the account.
    expect((await api(as('engAdmin'), 'PATCH', at('/dockets/payments/settings'), { enrichment: { enabled: false } })).status).toBe(403)

    // An admin on the account changes its models, but only an owner sets the monthly cap (what the account pays).
    const models = await api(as('admin'), 'PATCH', at('/settings'), { models: { cypher: 'openai/gpt-4.1-mini' } })
    expect(models.status, JSON.stringify(models.body)).toBe(200)
    conforms('accounts.settings.update', models.body)
    expect(models.body?.models.cypher).toMatchObject({ own: 'openai/gpt-4.1-mini', model: 'openai/gpt-4.1-mini', from: 'account' })
    const cap = await api(as('admin'), 'PATCH', at('/settings'), { monthly_cap_usd: 50 })
    expect(cap.status).toBe(403)
    expect(cap.body?.error_description).toMatch(/owner/)
    const owned = await api(as('owner'), 'PATCH', at('/settings'), { monthly_cap_usd: 10 })
    expect(owned.status).toBe(200)
    // The model the admin chose is kept: only what is sent changes.
    expect(owned.body).toMatchObject({ budget: { monthly_cap_usd: 10, space_slice_usd: null }, models: { cypher: { own: 'openai/gpt-4.1-mini' } } })
    expect((await api(as('owner'), 'PATCH', at('/settings'), { monthly_cap_usd: 5000 })).body).toMatchObject({ error: 'invalid_request' })
    expect((await api(as('owner'), 'PATCH', at('/settings'), {})).body).toMatchObject({ error: 'invalid_request' })

    // A browser session takes its CSRF token, as every other change does.
    expect((await api({ session: sessions.owner as string }, 'PATCH', at('/settings'), { models: { cypher: null } })).status).toBe(200)
  })

  it('keeps read-only, docket-limited and other accounts’ credentials to what they reach', async () => {
    expect((await api(as('ownerReadOnly'), 'GET', at('/spaces/eng/settings'))).status).toBe(200)
    const readOnly = await api(as('ownerReadOnly'), 'PATCH', at('/spaces/eng/settings'), { slice_usd: 1 })
    expect(readOnly.status).toBe(403)
    expect(readOnly.body).toMatchObject({ error: 'read_only' })
    expect((await api(as('ownerReadOnly'), 'PATCH', at('/spaces/eng'), { graph: 'own' })).body).toMatchObject({ error: 'read_only' })

    // The owner's token for Payments alone: Payments' own settings, nothing on its space or the account.
    const limited = as('ownerPayments')
    expect((await api(limited, 'PATCH', at('/dockets/payments/settings'), { models: { synthesis: null } })).status).toBe(200)
    expect((await api(limited, 'GET', at('/spaces/eng/settings'))).status).toBe(403)
    expect((await api(limited, 'PATCH', at('/settings'), { models: { synthesis: null } })).status).toBe(403)
    expect((await api(limited, 'PATCH', at('/spaces/eng'), { ai_key: null })).status).toBe(403)
    expect((await api(limited, 'PATCH', at('/dockets/payments/settings'), { enrichment: { enabled: false } })).status).toBe(403)

    for (const path of [at('/settings'), at('/spaces/eng/settings'), at('/dockets/payments/settings')]) {
      const elsewhere = await api(as('otherOwner'), 'PATCH', path, { models: { synthesis: null } })
      expect(elsewhere.status, path).toBe(404)
    }
  })

  it("holds every place's choices within the limits of the places above it", async () => {
    // The account lets its spaces choose between two answer models; its cap is $10.
    const account = await api(as('owner'), 'PATCH', at('/settings'), {
      models: { synthesis: 'openai/gpt-4.1' },
      allowed: { synthesis: ['openai/gpt-4.1', 'anthropic/claude-sonnet-5.5'] },
      monthly_cap_usd: 10,
    })
    expect(account.status, JSON.stringify(account.body)).toBe(200)
    expect(account.body?.models.synthesis.allowed).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-4.1'])

    // Engineering may not choose outside the account's list, nor take more than the account's cap.
    const outside = await api(as('engAdmin'), 'PATCH', at('/spaces/eng/settings'), { models: { synthesis: 'google/gemini-3.8-flash' } })
    expect(outside.status).toBe(400)
    expect(outside.body).toMatchObject({ error: 'invalid_request' })
    const tooMuch = await api(as('engAdmin'), 'PATCH', at('/spaces/eng/settings'), { slice_usd: 12 })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body?.error_description).toMatch(/at most the account's monthly cap, \$10.00/)
    // Nor limit its dockets to a model it may not choose itself.
    expect((await api(as('engAdmin'), 'PATCH', at('/spaces/eng/settings'), { allowed: { synthesis: ['google/gemini-3.8-flash'] } })).status).toBe(400)

    const space = await api(as('engAdmin'), 'PATCH', at('/spaces/eng/settings'), {
      models: { synthesis: 'anthropic/claude-sonnet-5.5' },
      allowed: { synthesis: ['anthropic/claude-sonnet-5.5'] },
      slice_usd: 4,
    })
    expect(space.status, JSON.stringify(space.body)).toBe(200)
    conforms('spaces.settings.update', space.body)
    expect(space.body?.models.synthesis).toMatchObject({
      own: 'anthropic/claude-sonnet-5.5',
      model: 'anthropic/claude-sonnet-5.5',
      from: 'space',
      inherited: { model: 'openai/gpt-4.1', from: 'account' },
      choices: ['anthropic/claude-sonnet-5.5', 'openai/gpt-4.1'],
      allowed: ['anthropic/claude-sonnet-5.5'],
    })
    expect(space.body?.budget).toEqual({ monthly_cap_usd: 10, space_slice_usd: 4 })

    // Payments, in Engineering, chooses only from what Engineering allows.
    const docket = await api(as('engAdmin'), 'PATCH', at('/dockets/payments/settings'), { models: { synthesis: 'openai/gpt-4.1' } })
    expect(docket.status).toBe(400)
    expect(docket.body).toMatchObject({ error: 'invalid_request' })
    const inherits = await api(as('engAdmin'), 'GET', at('/dockets/payments/settings'))
    expect(inherits.body?.models.synthesis).toMatchObject({ own: null, model: 'anthropic/claude-sonnet-5.5', from: 'space', choices: ['anthropic/claude-sonnet-5.5'] })
    // A docket has nothing inside it to limit, and no slice of its own.
    expect((await api(as('engAdmin'), 'PATCH', at('/dockets/payments/settings'), { allowed: { synthesis: [] } })).status).toBe(400)

    // A change that sends only the slice keeps the space's models; null clears its own choice.
    const slice = await api(as('engAdmin'), 'PATCH', at('/spaces/eng/settings'), { slice_usd: 3 })
    expect(slice.body?.models.synthesis).toMatchObject({ own: 'anthropic/claude-sonnet-5.5', allowed: ['anthropic/claude-sonnet-5.5'] })
    expect(slice.body?.budget.space_slice_usd).toBe(3)

    // The account lowering its cap caps the space's slice; changing its list leaves a stale choice unused.
    const lowered = await api(as('owner'), 'PATCH', at('/settings'), { monthly_cap_usd: 2, allowed: { synthesis: ['openai/gpt-4.1'] } })
    expect(lowered.status, JSON.stringify(lowered.body)).toBe(200)
    const capped = await api(as('engAdmin'), 'GET', at('/spaces/eng/settings'))
    expect(capped.body?.budget).toEqual({ monthly_cap_usd: 2, space_slice_usd: 2 })
    expect(capped.body?.models.synthesis).toMatchObject({ own: 'anthropic/claude-sonnet-5.5', model: 'openai/gpt-4.1', from: 'account' })
    // Nor may a space choose it again.
    expect((await api(as('engAdmin'), 'PATCH', at('/spaces/eng/settings'), { models: { synthesis: 'anthropic/claude-sonnet-5.5' } })).status).toBe(400)
    const cleared = await api(as('engAdmin'), 'PATCH', at('/spaces/eng/settings'), { models: { synthesis: null }, allowed: { synthesis: null }, slice_usd: null })
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200)
    expect(cleared.body?.models.synthesis).toMatchObject({ own: null, from: 'account', allowed: [] })
    expect(cleared.body?.budget.space_slice_usd).toBeNull()
    await api(as('owner'), 'PATCH', at('/settings'), { monthly_cap_usd: 10, allowed: { synthesis: null } })
  })

  it("takes a space's own key write-only: never answered, logged or audited, only its provider and last four characters", async () => {
    const secret = 'sk-ant-api03-very-secret-WXYZ'
    const set = await api(as('engAdmin'), 'PATCH', at('/spaces/eng'), { ai_key: { provider: 'anthropic', key: secret } })
    expect(set.status, set.text).toBe(200)
    conforms('spaces.update', set.body)
    expect(set.text).not.toContain('very-secret')
    for (const path of [at('/spaces/eng/settings'), at('/dockets/payments/settings')]) {
      const read = await api(as('engAdmin'), 'GET', path)
      expect(read.body?.key, path).toEqual({ from: 'space', space: 'eng', provider: 'anthropic', hint: 'WXYZ' })
      expect(read.text).not.toContain('very-secret')
    }
    // Its dockets now choose only models Anthropic serves.
    const choices = await api(as('engAdmin'), 'GET', at('/dockets/payments/settings'))
    expect((choices.body?.models.synthesis.choices as string[]).every((model) => model.startsWith('anthropic/'))).toBe(true)

    // The audit event records the provider and the last four characters, and nothing else of it.
    const { rows } = await org.withOrg(({ tx }) =>
      tx.query<{ args_digest: string; row: string }>("SELECT args_digest, row_to_json(e)::text AS row FROM audit_event e WHERE action = 'api.spaces.update' ORDER BY seq"),
    )
    expect(rows.at(-1)?.args_digest).toBe(argsDigest({ name: 'Engineering', key: { provider: 'anthropic', hint: 'WXYZ' } }))
    expect(rows.map((row) => row.row).join('\n')).not.toContain('very-secret')
    const stored = await org.db.admin.query<{ row: string }>('SELECT row_to_json(k)::text AS row FROM platform.provider_keys k WHERE org_id = $1', [org.orgId])
    expect(stored.rows[0]?.row).not.toContain('very-secret')

    // A malformed key is refused without being repeated back.
    const bad = await api(as('engAdmin'), 'PATCH', at('/spaces/eng'), { ai_key: { provider: 'openai', key: 'two words-secret' } })
    expect(bad.status).toBe(400)
    expect(bad.text).not.toContain('words-secret')

    const removed = await api(as('engAdmin'), 'PATCH', at('/spaces/eng'), { ai_key: null })
    expect(removed.status).toBe(200)
    expect((await api(as('engAdmin'), 'GET', at('/spaces/eng/settings'))).body?.key).toEqual({ from: 'account' })
  })

  it("asks for a space's own Neo4j and gives it back, renaming it in the same change", async () => {
    const own = await api(as('engAdmin'), 'PATCH', at('/spaces/eng'), { graph: 'own', description: 'Builds things' })
    expect(own.status, own.text).toBe(200)
    expect(own.body).toMatchObject({ description: 'Builds things' })
    expect((await api(as('engAdmin'), 'GET', at('/spaces/eng/settings'))).body?.storage).toEqual({ graph: 'own', status: 'requested', last_error: null })
    const back = await api(as('engAdmin'), 'PATCH', at('/spaces/eng'), { graph: 'account' })
    expect(back.status).toBe(200)
    expect((await api(as('engAdmin'), 'GET', at('/spaces/eng/settings'))).body?.storage).toEqual({ graph: 'account', status: 'retiring', last_error: null })

    // With the box full, nothing in the change is kept.
    env.DOCKET_NEO4J_POD_CAPACITY = '0'
    try {
      const full = await api(as('engAdmin'), 'PATCH', at('/spaces/eng'), { graph: 'own', name: 'Platform Engineering' })
      expect(full.status).toBe(409)
      expect(full.body).toMatchObject({ error: 'conflict' })
      expect((await api(as('engAdmin'), 'GET', at('/spaces/eng'))).body).toMatchObject({ name: 'Engineering' })
    } finally {
      env.DOCKET_NEO4J_POD_CAPACITY = '100000'
    }
  })

  it("sets a docket's background agents within the account's cap", async () => {
    // A docket with a published ontology, which enrichment writes against.
    const made = await api(as('owner'), 'POST', at('/dockets'), { space: 'eng', name: 'Incidents', template: 'blank' })
    expect(made.status, made.text).toBe(201)

    const tooMuch = await api(as('owner'), 'PATCH', at('/dockets/incidents/settings'), { enrichment: { enabled: true, monthly_limit_usd: 50 } })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body?.error_description).toMatch(/\$10.00/)
    const on = await api(as('owner'), 'PATCH', at('/dockets/incidents/settings'), { enrichment: { enabled: true, schedule: 'weekly', monthly_limit_usd: 2 } })
    expect(on.status, on.text).toBe(200)
    conforms('dockets.settings.update', on.body)
    expect(on.body?.agents.enrichment).toEqual({ enabled: true, schedule: 'weekly', monthly_limit_usd: 2 })
    // Only what is sent changes.
    const nightly = await api(as('owner'), 'PATCH', at('/dockets/incidents/settings'), { enrichment: { schedule: 'nightly' } })
    expect(nightly.body?.agents.enrichment).toEqual({ enabled: true, schedule: 'nightly', monthly_limit_usd: 2 })

    // cognee turns on only where it runs; its floor and limit still change.
    const cognee = await api(as('engAdmin'), 'PATCH', at('/dockets/incidents/settings'), { cognee: { enabled: true } })
    expect(cognee.status).toBe(400)
    expect(cognee.body?.error_description).toMatch(/does not run on this server/)
    const floor = await api(as('engAdmin'), 'PATCH', at('/dockets/incidents/settings'), { cognee: { floor: 0.5, monthly_limit_usd: 1 } })
    expect(floor.status, floor.text).toBe(200)
    expect(floor.body?.agents.cognee).toEqual({ enabled: false, floor: 0.5, monthly_limit_usd: 1, available: false })

    // A docket with no ontology has nothing for enrichment to write against.
    const bare = await api(as('owner'), 'PATCH', at('/dockets/payments/settings'), { enrichment: { enabled: true } })
    expect(bare.status).toBe(400)
    expect(bare.body?.error_description).toMatch(/Publish an ontology first/)

    const log = await api(as('owner'), 'GET', at('/audit?action=api.dockets.settings.update'))
    expect(new Set((log.body?.events as { outcome: string; docket: string }[]).map((event) => `${event.docket}:${event.outcome}`))).toEqual(
      new Set(['incidents:ok', 'incidents:invalid', 'payments:ok', 'payments:invalid', 'payments:denied']),
    )
  })
})
