// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { GENESIS_HASH, argsDigest, canonical, eventHash, verifyLinks } from './chain.js'

describe('canonical JSON', () => {
  it('sorts keys and drops undefined members', () => {
    expect(canonical({ b: 1, a: [true, null, undefined], c: undefined, d: { z: 'x', y: 2 } })).toBe(
      '{"a":[true,null,null],"b":1,"d":{"y":2,"z":"x"}}',
    )
  })

  it('digests equal arguments equally, whatever their key order', () => {
    expect(argsDigest({ q: 'orders', limit: 5 })).toBe(argsDigest({ limit: 5, q: 'orders' }))
    expect(argsDigest({ q: 'orders' })).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('verifyLinks', () => {
  const base = {
    at: new Date('2026-11-03T10:00:00.000Z'),
    orgId: 'o1',
    workspaceId: null,
    actor: 'user:u1',
    ip: null,
    userAgent: null,
    action: 'a',
    target: [],
    argsDigest: null,
    outcome: 'ok',
    latencyMs: 1,
    requestId: 'r',
  }
  const first = { ...base, id: 'e1', prevHash: GENESIS_HASH, hash: eventHash(GENESIS_HASH, { ...base, id: 'e1' }) }
  const second = { ...base, id: 'e2', prevHash: first.hash, hash: eventHash(first.hash, { ...base, id: 'e2' }) }

  it('passes an intact chain and an empty one', () => {
    expect(verifyLinks([first, second], second.hash)).toEqual({ ok: true, events: 2 })
    expect(verifyLinks([], GENESIS_HASH)).toEqual({ ok: true, events: 0 })
  })

  it('reports a deleted row at the row after it, and a deleted tail at the head', () => {
    expect(verifyLinks([second], second.hash)).toMatchObject({ ok: false, brokenAt: 'e2' })
    expect(verifyLinks([first], second.hash)).toMatchObject({ ok: false, brokenAt: 'head' })
  })
})
