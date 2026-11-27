// SPDX-License-Identifier: AGPL-3.0-only
import { crc32 } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import { credentialScopes, fromLegacyScopes } from '../scopes.js'
import { isApiTokenText, newApiToken, parseApiToken } from './api-token.js'
import { tokenResolver } from './lookup.js'

describe('API token format', () => {
  it('is dkt_pat_ for a person and dkt_sys_ for a system account, 43 base62 characters and a crc32', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = newApiToken()
      expect(token).toMatch(/^dkt_pat_[0-9A-Za-z]{43}_[0-9a-f]{8}$/)
      expect(parseApiToken(token)).toEqual({ prefix: token.slice(0, 16), ok: true })
      const system = newApiToken('system')
      expect(system).toMatch(/^dkt_sys_[0-9A-Za-z]{43}_[0-9a-f]{8}$/)
      expect(parseApiToken(system)).toEqual({ prefix: system.slice(0, 16), ok: true })
    }
  })

  it('still reads a dkt_live_ token, issued before the two kinds', () => {
    const body = '0'.repeat(43)
    const legacy = `dkt_live_${body}_${crc32(`dkt_live_${body}`).toString(16).padStart(8, '0')}`
    expect(parseApiToken(legacy)).toEqual({ prefix: legacy.slice(0, 17), ok: true })
    expect(isApiTokenText(legacy)).toBe(true)
    // The checksum covers the prefix: the same body under another kind's prefix is a typo.
    expect(parseApiToken(legacy.replace('dkt_live_', 'dkt_pat_')).ok).toBe(false)
  })

  it('fails the checksum on a one-character typo', () => {
    const token = newApiToken()
    const at = 12
    const swapped = token[at] === 'a' ? 'b' : 'a'
    const typo = `${token.slice(0, at)}${swapped}${token.slice(at + 1)}`
    expect(parseApiToken(typo).ok).toBe(false)
    expect(parseApiToken(`${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`).ok).toBe(false)
    expect(parseApiToken('dkt_pat_short_00000000').ok).toBe(false)
  })

  it('turns a typo away with no database call', async () => {
    const platform = vi.fn()
    const resolver = tokenResolver({ platform })
    for (const token of [newApiToken(), newApiToken('system')]) {
      const typo = `${token.slice(0, 20)}${token[20] === 'x' ? 'y' : 'x'}${token.slice(21)}`
      expect(await resolver.resolveBearer(typo, { url: 'https://d.test/mcp/a/b', orgId: 'a', workspaceId: 'b' })).toBeNull()
    }
    expect(platform).not.toHaveBeenCalled()
  })
})

describe('what a credential carries', () => {
  it('is everything, or reading only, with no scopes to choose', () => {
    expect(credentialScopes({ readOnly: false })).toEqual(['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'])
    expect(credentialScopes({ readOnly: true })).toEqual(['docket:read', 'ontology:read'])
  })

  it('keeps an old ceiling read-only cannot say, and drops one it can', () => {
    expect(fromLegacyScopes(['docket:read'])).toEqual({ readOnly: true, legacy: null })
    expect(fromLegacyScopes(['docket:read', 'ontology:read'])).toEqual({ readOnly: true, legacy: null })
    expect(fromLegacyScopes(['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'])).toEqual({ readOnly: false, legacy: null })
    // A writer that could not propose, or read only the ontology, keeps exactly that.
    expect(fromLegacyScopes(['docket:read', 'docket:write'])).toEqual({ readOnly: false, legacy: ['docket:read', 'docket:write', 'ontology:read'] })
    expect(fromLegacyScopes(['ontology:read'])).toEqual({ readOnly: true, legacy: ['ontology:read'] })
    expect(credentialScopes({ readOnly: false, legacy: ['docket:read', 'docket:write', 'ontology:read'] })).toEqual(['docket:read', 'docket:write', 'ontology:read'])
  })
})
