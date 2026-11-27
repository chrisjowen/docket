// SPDX-License-Identifier: AGPL-3.0-only
import { ROLES, accountRoleOf, namespacePermission, type NamespacePermission, type Role } from '@docket/platform-tenancy'
import { describe, expect, it } from 'vitest'

import { impliedScopes, namespaceScopes, parseScopeString, roleScopes } from './scopes.js'

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

describe('namespaceScopes', () => {
  const WRITE = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']

  it('gives Write and Admin every scope but ontology:write, Read reads only, and no permission nothing', () => {
    expect(namespaceScopes({ role: 'owner', permission: 'admin' })).toEqual(WRITE)
    expect(namespaceScopes({ role: 'editor', permission: 'write' })).toEqual(WRITE)
    expect(namespaceScopes({ role: 'viewer', permission: 'write' })).toEqual(WRITE)
    expect(namespaceScopes({ role: 'editor', permission: 'read' })).toEqual(['docket:read', 'ontology:read'])
    expect(namespaceScopes({ role: 'owner', permission: null })).toEqual([])
    expect(namespaceScopes(null)).toEqual([])
  })

  it('adds ontology:write only where the workspace enabled the org role, and never with Read', () => {
    expect(namespaceScopes({ role: 'editor', permission: 'write' }, ['editor'])).toContain('ontology:write')
    expect(namespaceScopes({ role: 'admin', permission: 'admin' }, ['editor'])).not.toContain('ontology:write')
    expect(namespaceScopes({ role: 'editor', permission: 'read' }, ['editor'])).not.toContain('ontology:write')
    expect(namespaceScopes({ role: 'editor', permission: null }, ['editor'])).toEqual([])
  })

  it("takes no one's access away: with the grants the backfill gives, every role gets exactly roleScopes", () => {
    const backfilled: Record<Role, NamespacePermission[]> = { owner: [], admin: [], editor: ['write'], viewer: ['read'] }
    for (const writers of [[], ['owner'], ['owner', 'admin', 'editor']] as Role[][]) {
      for (const role of ROLES) {
        const access = { role, permission: namespacePermission(accountRoleOf(role), backfilled[role]) }
        expect(namespaceScopes(access, writers)).toEqual(roleScopes(role, writers))
      }
    }
  })
})
