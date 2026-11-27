// SPDX-License-Identifier: AGPL-3.0-only
import { CAPABILITIES, builtinRole, type Capability } from '@docket/platform-tenancy'
import { describe, expect, it } from 'vitest'

import { capabilityScopes, credentialScopes, impliedScopes, parseScopeString } from './scopes.js'

const caps = (...list: Capability[]) => new Set(list)

describe('capabilityScopes', () => {
  it("reaches what each built-in role's capabilities reach", () => {
    expect(capabilityScopes(new Set(builtinRole('reader').caps))).toEqual(['docket:read', 'ontology:read'])
    expect(capabilityScopes(new Set(builtinRole('writer').caps))).toEqual(['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'])
    expect(capabilityScopes(new Set(CAPABILITIES))).toEqual(['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'])
  })

  it('publishes over MCP with Publish ontology changes alone, however it was given', () => {
    expect(capabilityScopes(caps('read', 'write', 'propose', 'publish'))).toContain('ontology:write')
    expect(capabilityScopes(caps('read', 'publish'))).toEqual(['docket:read', 'ontology:read', 'ontology:write'])
  })

  it('reaches no content without Read and ask, whatever else is held', () => {
    expect(capabilityScopes(caps('create', 'access', 'audit'))).toEqual([])
    expect(capabilityScopes(caps('write', 'publish'))).toEqual([])
    expect(capabilityScopes(caps())).toEqual([])
  })
})

describe('credentialScopes', () => {
  it('reads only when read-only, and cuts to a kept ceiling', () => {
    expect(credentialScopes({ readOnly: true })).toEqual(['docket:read', 'ontology:read'])
    expect(credentialScopes({ readOnly: false, legacy: ['docket:read', 'docket:write'] })).toEqual(['docket:read', 'docket:write', 'ontology:read'])
  })
})

describe('scope strings', () => {
  it('reads ontology:write from an OAuth scope string, and implies nothing from it', () => {
    expect(parseScopeString('ontology:write docket:read made:up')).toEqual(['docket:read', 'ontology:write'])
    expect(impliedScopes(['ontology:write'])).toEqual(['ontology:write'])
  })
})
