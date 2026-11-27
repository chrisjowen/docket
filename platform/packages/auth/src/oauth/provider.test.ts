// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest'

import { cimdFetchAllowed, isLocalRedirect } from './cimd.js'
import { providerEndpoint } from './provider.js'

describe('client metadata document fetches', () => {
  it('allows public https URLs only', () => {
    expect(cimdFetchAllowed('https://claude.ai/oauth/claude-code-client-metadata')).toBe(true)
    for (const id of [
      'http://claude.ai/meta',
      'https://localhost/meta',
      'https://127.0.0.1/meta',
      'https://[::1]/meta',
      'https://10.0.0.8/meta',
      'https://docket-cloud-api.docket-cloud.svc/meta',
      'https://printer.local/meta',
      'https://user:pw@claude.ai/meta',
      'https://claude.ai:8443/meta',
      'https://intranet/meta',
    ]) {
      expect(cimdFetchAllowed(id), id).toBe(false)
    }
  })

  it('names the provider endpoint a path is, the longest match first', () => {
    expect(providerEndpoint('/oauth/device/auth')).toBe('device_authorization')
    expect(providerEndpoint('/oauth/device')).toBe('code_verification')
    expect(providerEndpoint('/oauth/device/abc123')).toBe('code_verification')
    expect(providerEndpoint('/oauth/register')).toBe('registration')
    expect(providerEndpoint('/oauth/consent/abc')).toBeNull()
    expect(providerEndpoint('/oauth/tokens')).toBeNull()
  })

  it('flags redirects to this machine as a local app', () => {
    expect(isLocalRedirect('http://localhost:33418/callback')).toBe(true)
    expect(isLocalRedirect('http://127.0.0.1:9/cb')).toBe(true)
    expect(isLocalRedirect('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe(true)
    expect(isLocalRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(false)
  })
})
