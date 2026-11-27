// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { orgCollections, qdrantCollection, qdrantProvisioner, qdrantToken } from './qdrant.js'

describe('qdrantToken', () => {
  it('signs an HS256 JWT granting exactly the named collections until it expires', () => {
    const token = qdrantToken('secret', ['org_a__mem0', 'org_a__mem0_entities'], 60, Date.UTC(2026, 0, 1))
    const [header, claims] = token.split('.').slice(0, 2).map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()) as unknown)
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(claims).toEqual({
      exp: Date.UTC(2026, 0, 1) / 1000 + 60,
      access: [
        { collection: 'org_a__mem0', access: 'rw' },
        { collection: 'org_a__mem0_entities', access: 'rw' },
      ],
    })
  })
})

describe('a Qdrant collection per docket (tenancy v2 §5)', () => {
  it("names a docket's collection under its org, beside the org's shared one, and refuses an unsafe id", () => {
    expect(qdrantCollection({ orgId: 'acme' })).toBe('org_acme__mem0')
    expect(qdrantCollection({ orgId: 'acme', docketId: 'w123' })).toBe('org_acme__ws_w123')
    expect(orgCollections({ orgId: 'acme', docketId: 'w123' })).toEqual(['org_acme__ws_w123', 'org_acme__ws_w123_entities'])
    expect(() => qdrantCollection({ orgId: 'acme', docketId: '../x' })).toThrow(/not a docket id/)
  })

  it("gives a docket a token for its own collections only, never its org's shared one", async () => {
    const provisioner = qdrantProvisioner({ url: 'http://qdrant:6333', apiKey: 'secret', dimension: 8, fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch })
    const access = await provisioner.access({ orgId: 'acme', docketId: 'w123' }, 60)
    expect(access.collection).toBe('org_acme__ws_w123')
    const claims = JSON.parse(Buffer.from(access.token.split('.')[1] as string, 'base64url').toString()) as { access: { collection: string }[] }
    expect(claims.access.map((each) => each.collection)).toEqual(['org_acme__ws_w123', 'org_acme__ws_w123_entities'])
  })
})
