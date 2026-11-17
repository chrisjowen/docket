import { describe, expect, it } from 'vitest'

import { impliedScopes, isScope, parseScopeString, roleScopes } from './scopes.js'

describe('roleScopes', () => {
  it('gives editors and up every scope but ontology:write, and viewers reads only', () => {
    expect(roleScopes('editor')).toEqual(['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'])
    expect(roleScopes('owner')).toEqual(['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'])
    expect(roleScopes('viewer')).toEqual(['docket:read', 'ontology:read'])
    expect(roleScopes(null)).toEqual([])
  })

  it('adds ontology:write only for a role the workspace enabled, never for a viewer', () => {
    expect(roleScopes('editor', ['editor'])).toContain('ontology:write')
    expect(roleScopes('admin', ['editor'])).not.toContain('ontology:write')
    expect(roleScopes('owner', ['owner', 'admin'])).toContain('ontology:write')
    expect(roleScopes('viewer', ['owner', 'admin', 'editor', 'viewer'])).not.toContain('ontology:write')
    expect(roleScopes(null, ['owner'])).toEqual([])
  })

  it('reads ontology:write from an OAuth scope string, and implies nothing from it', () => {
    expect(parseScopeString('ontology:write docket:read made:up')).toEqual(['docket:read', 'ontology:write'])
    expect(impliedScopes(['ontology:write'])).toEqual(['ontology:write'])
  })
})

describe('impliedScopes', () => {
  it('adds ontology:read to docket:read, in canonical order', () => {
    expect(impliedScopes(['docket:write', 'docket:read'])).toEqual(['docket:read', 'docket:write', 'ontology:read'])
  })
})

describe('parseScopeString', () => {
  it('reads nothing from an absent or empty string', () => {
    expect(parseScopeString(undefined)).toEqual([])
    expect(parseScopeString(null)).toEqual([])
    expect(parseScopeString('  ')).toEqual([])
  })
})

describe('isScope', () => {
  it('knows the five scopes and nothing else', () => {
    expect(isScope('ontology:propose')).toBe(true)
    expect(isScope('ontology:admin')).toBe(false)
    expect(isScope(undefined)).toBe(false)
  })
})
