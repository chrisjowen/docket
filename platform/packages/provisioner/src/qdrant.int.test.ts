// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { mem0Collection, qdrantProvisioner, qdrantToken } from './qdrant.js'

const URL = process.env.DOCKET_TEST_QDRANT_URL
const API_KEY = process.env.DOCKET_TEST_QDRANT_API_KEY ?? ''

if (!URL && process.env.CI) throw new Error('DOCKET_TEST_QDRANT_URL must be set in CI')

describe.skipIf(!URL)('qdrantProvisioner against Qdrant', () => {
  const provisioner = qdrantProvisioner({ url: URL ?? '', apiKey: API_KEY, dimension: 8 })
  const suffix = Math.random().toString(36).slice(2, 8)
  const a = { orgId: `qa${suffix}` }
  const b = { orgId: `qb${suffix}` }

  const read = (token: string, collection: string) =>
    fetch(`${URL}/collections/${collection}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status)

  it("makes each org's collections, and a JWT that reaches only its own", async () => {
    expect((await provisioner.provision(a)).created).toBe(true)
    await provisioner.provision(b)
    // Repeating is safe, and makes nothing.
    expect((await provisioner.provision(a)).created).toBe(false)
    expect(await provisioner.health(a)).toBe('ok')
    const access = await provisioner.access(a, 60)
    expect(access.collection).toBe(`org_${a.orgId}__mem0`)
    expect(await read(access.token, mem0Collection(a))).toBe(200)
    expect(await read(access.token, `${mem0Collection(a)}_entities`)).toBe(200)
    // Org A's token on org B's collection: refused (§5.5).
    expect(await read(access.token, mem0Collection(b))).toBe(403)
  })

  it('refuses an expired or forged token', async () => {
    const expired = qdrantToken(API_KEY, [mem0Collection(a)], -60)
    expect(await read(expired, mem0Collection(a))).toBe(403)
    const forged = qdrantToken('not-the-key', [mem0Collection(a)], 60)
    expect(await read(forged, mem0Collection(a))).toBe(403)
  })

  it('drops the collections on deprovision', async () => {
    await provisioner.deprovision(a, 'shred')
    await provisioner.deprovision(b, 'shred')
    expect(await provisioner.health(a)).toBe('down')
  })
})
