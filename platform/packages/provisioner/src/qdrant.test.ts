// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { qdrantToken } from './qdrant.js'

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
