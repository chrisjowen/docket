// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { syncPasswordUsers } from '@docket/platform-auth'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import { identitiesOf, resolveIdentity, tenantRouter, type ExternalIdentity, type TenantRouter } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { isRedirect, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const { actions } = await import('./+page.server')

// Real Postgres (migrations, rate limiting arithmetic, password hashing); only the process runtime is injected.
describe.skipIf(!TEST_PG_URL)('signing in', () => {
  let db: TestDatabase
  let router: TenantRouter

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await router.withPlatform((tx) => syncPasswordUsers(tx, [{ login: 'jo.bloggs', name: null, email: null, password: 'correct horse battery' }]))
  })
  afterAll(() => db?.drop())
  beforeEach(() => {
    const at = Date.now()
    runtime = {
      password: true,
      router,
      limiter: rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at }),
      secureCookies: false,
    } as unknown as Runtime
  })

  function event(login: string, password: string): RequestEvent {
    const form = new FormData()
    form.set('login', login)
    form.set('password', password)
    const url = new URL('https://docket.example/signin')
    return {
      params: {},
      locals: { startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: new Request(url, { method: 'POST', body: form }),
      getClientAddress: () => '192.0.2.1',
      cookies: { set: () => undefined },
    } as unknown as RequestEvent
  }

  async function attempt(login: string, password: string) {
    return Promise.resolve(actions.password!(event(login, password))).catch((thrown: unknown) => thrown)
  }

  it('signs a listed password user in, and refuses an unknown login or wrong password alike', async () => {
    const wrongPassword = await attempt('jo.bloggs', 'not the password')
    expect(wrongPassword).toMatchObject({ status: 403 })
    const unknownLogin = await attempt('nobody.here', 'correct horse battery')
    expect(unknownLogin).toMatchObject({ status: 403 })
    const success = await attempt('jo.bloggs', 'correct horse battery')
    expect(isRedirect(success)).toBe(true)
  })

  it('counts a login and its @-prefixed spelling against the same rate-limit bucket, not two', async () => {
    // 10 wrong attempts, alternating spelling, exhausts the shared bucket (passwordPerLogin capacity 10).
    for (let i = 0; i < 10; i++) {
      const spelling = i % 2 === 0 ? 'jo.bloggs' : '@jo.bloggs'
      const result = await attempt(spelling, 'wrong password')
      expect(result).toMatchObject({ status: 403 })
    }
    // Before the fix, "@jo.bloggs" kept its own untouched bucket here and would still authenticate.
    const refused = await attempt('@jo.bloggs', 'correct horse battery')
    expect(refused).toMatchObject({ status: 429 })
    const alsoRefused = await attempt('jo.bloggs', 'correct horse battery')
    expect(alsoRefused).toMatchObject({ status: 429 })
  })

  it('resolves two genuinely concurrent first sign-ins of the same brand-new OIDC identity to one user, not two', async () => {
    const identity: ExternalIdentity = {
      provider: 'oidc',
      issuer: 'https://idp.example.com',
      subject: `race-${randomUUID()}`,
      login: 'race.okta',
      name: 'Race Condition',
      avatarUrl: null,
      emails: ['race@example.com'],
    }

    // Holds each transaction's first query open until both resolveIdentity calls have reached it,
    // so they genuinely overlap instead of one finishing before the other starts (Promise.all alone
    // does not guarantee that on a fast local connection).
    const clientA = await db.app.connect()
    const clientB = await db.app.connect()
    await clientA.query('BEGIN')
    await clientB.query('BEGIN')
    let releaseGate: () => void
    const gate = new Promise<void>((resolve) => (releaseGate = resolve))
    const arrived = { a: false, b: false }
    function gated(client: typeof clientA, flag: 'a' | 'b') {
      let first = true
      return {
        query: async (sql: string, params?: unknown[]) => {
          if (first) {
            first = false
            arrived[flag] = true
            await gate
          }
          return client.query(sql, params)
        },
      } as unknown as Parameters<typeof resolveIdentity>[0]
    }

    const pA = resolveIdentity(gated(clientA, 'a'), identity).then(async (user) => {
      await clientA.query('COMMIT')
      clientA.release()
      return user
    })
    const pB = resolveIdentity(gated(clientB, 'b'), identity).then(async (user) => {
      await clientB.query('COMMIT')
      clientB.release()
      return user
    })

    const deadline = Date.now() + 2000
    while (!(arrived.a && arrived.b)) {
      if (Date.now() > deadline) throw new Error('both resolveIdentity calls never reached their gated first query')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    releaseGate!()

    const [first, second] = await Promise.all([pA, pB])
    expect(first.id).toBe(second.id)
    expect(first.login).toBe('race.okta')
    const identities = await router.withPlatform((tx) => identitiesOf(tx, first.id))
    expect(identities).toHaveLength(1)
    expect(identities[0]).toMatchObject({ provider: 'oidc', issuer: identity.issuer, subject: identity.subject })
    const { rows } = await db.superuser.query('SELECT login FROM platform.users WHERE login LIKE $1', ['race.okta%'])
    expect(rows).toHaveLength(1)
  })
})
