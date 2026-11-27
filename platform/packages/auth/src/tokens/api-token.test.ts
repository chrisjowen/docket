// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'

import { newApiToken, parseApiToken } from './api-token.js'
import { tokenResolver } from './lookup.js'

describe('API token format', () => {
  it('is dkt_live_, 43 base62 characters and a crc32', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = newApiToken()
      expect(token).toMatch(/^dkt_live_[0-9A-Za-z]{43}_[0-9a-f]{8}$/)
      expect(parseApiToken(token)).toEqual({ prefix: token.slice(0, 17), ok: true })
    }
  })

  it('fails the checksum on a one-character typo', () => {
    const token = newApiToken()
    const at = 12
    const swapped = token[at] === 'a' ? 'b' : 'a'
    const typo = `${token.slice(0, at)}${swapped}${token.slice(at + 1)}`
    expect(parseApiToken(typo).ok).toBe(false)
    expect(parseApiToken(`${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`).ok).toBe(false)
    expect(parseApiToken('dkt_live_short_00000000').ok).toBe(false)
  })

  it('turns a typo away with no database call', async () => {
    const platform = vi.fn()
    const resolver = tokenResolver({ platform })
    const token = newApiToken()
    const typo = `${token.slice(0, 20)}${token[20] === 'x' ? 'y' : 'x'}${token.slice(21)}`
    expect(await resolver.resolveBearer(typo, { url: 'https://d.test/mcp/a/b', orgId: 'a', workspaceId: 'b' })).toBeNull()
    expect(platform).not.toHaveBeenCalled()
  })
})
