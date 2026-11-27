// SPDX-License-Identifier: AGPL-3.0-only
import { audit, listAudit } from '@docket/platform-audit'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { rateLimiter } from './limiter.js'
import { mcpRateLimit, type McpMessage } from './mcp.js'
import { mcpLimits } from './quotas.js'
import { postgresBucketStore, pruneBuckets } from './token-bucket.js'

const search = (id: number): McpMessage => ({
  id,
  method: 'tools/call',
  params: { name: 'docket_search', arguments: { query: 'orders' } },
})

describe.skipIf(!TEST_PG_URL)('token buckets in Postgres', () => {
  let org: TestOrg

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  it('two replicas sharing the store allow 120 calls in all, not 120 each', async () => {
    const store = postgresBucketStore(org.db.app)
    const replicas = [rateLimiter({ store }), rateLimiter({ store })]
    const limits = mcpLimits({ orgId: org.orgId, tokenId: 'shared' })
    const started = performance.now()
    const decisions = await Promise.all(
      Array.from({ length: 160 }, (_, i) => replicas[i % 2]!.check(limits)),
    )
    // The token bucket refills at 2 a second while the calls run.
    const refilled = Math.ceil(((performance.now() - started) / 1000) * 2)
    const allowed = decisions.filter((decision) => decision.allowed).length
    expect(allowed).toBeGreaterThanOrEqual(120)
    expect(allowed).toBeLessThanOrEqual(120 + refilled)
    const { rows } = await org.db.superuser.query('SELECT key FROM platform.rate_buckets ORDER BY key')
    expect(rows.map((row) => row.key)).toEqual([`mcp:org:${org.orgId}`, 'mcp:token:shared'])
  })

  it('writes the refusal to the org audit log with outcome denied', async () => {
    const limiter = rateLimiter({ store: postgresBucketStore(org.db.app) })
    const caller = { orgId: org.orgId, tokenId: 'audited', userId: org.userId }
    const limit = mcpRateLimit<typeof caller>({
      limiter,
      audit: ({ caller: who, action, refusal }) =>
        org.router.withTenant(who.orgId, async (tx) => {
          await audit(tx, {
            orgId: who.orgId,
            actor: `token:${who.tokenId}`,
            action,
            target: [`rate-limit:${refusal.limit.scope}`],
            outcome: 'denied',
            latencyMs: 1,
            requestId: 'req-121',
          })
        }),
    })
    for (let i = 1; i <= 120; i += 1) expect(await limit(caller, search(i))).toBeNull()
    // Real time passes between round trips and the bucket refills at 2 a second, so call until refused.
    let response: Response | null = null
    for (let i = 121; !response && i <= 200; i += 1) response = await limit(caller, search(i))
    expect(response?.status).toBe(429)
    expect(Number(response?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)

    const events = await org.router.withTenant(org.orgId, (tx) => listAudit(tx, { limit: 5 }))
    expect(events.filter((event) => event.outcome === 'denied')).toEqual([
      expect.objectContaining({ actor: 'token:audited', action: 'mcp.tools/call docket_search', target: ['rate-limit:token'] }),
    ])
  })

  it('prunes idle buckets', async () => {
    await org.db.superuser.query("UPDATE platform.rate_buckets SET updated_at = now() - interval '2 hours'")
    expect(await pruneBuckets(org.db.app)).toBeGreaterThan(0)
    const { rows } = await org.db.superuser.query('SELECT count(*)::int AS n FROM platform.rate_buckets')
    expect(rows[0].n).toBe(0)
  })
})
