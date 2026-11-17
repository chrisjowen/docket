import { describe, expect, it } from 'vitest'

import type { Authorizer, Principal } from '../ports.js'
import { checkScope, effectiveScopes } from './effective.js'
import type { Role } from './roles.js'
import type { Scope } from './scopes.js'

describe('checkScope', () => {
  it('refuses with 403 insufficient_scope, or 401 when nothing is left', () => {
    expect(checkScope(['docket:read', 'docket:write'], 'docket:write')).toBeNull()
    expect(checkScope(['docket:read'], 'docket:write')).toMatchObject({ status: 403, error: 'insufficient_scope', scope: 'docket:write' })
    expect(checkScope([], 'docket:read')).toMatchObject({ status: 401, error: 'invalid_token' })
  })
})

describe('effectiveScopes', () => {
  const principal = (subject: string, scopes: Scope[]): Principal => ({ subject, workspaceId: 'ws1', scopes, actor: `token:${subject}` })

  /** Roles and the workspace's setting, read afresh on every call, as a deployment's authorizer does. */
  function members(roles: Record<string, Role>, writers: readonly Role[] = []) {
    const state = { roles: { ...roles } as Record<string, Role | undefined>, writers: [...writers] as Role[], askedFor: [] as string[] }
    const authorizer: Required<Authorizer> = {
      role: async (p) => state.roles[p.subject] ?? null,
      ontologyWriters: async (workspaceId) => {
        state.askedFor.push(workspaceId)
        return state.writers
      }
    }
    return { state, authorizer }
  }

  /** What the MCP endpoint does on every call: cut the resolved principal to the role now, then check. */
  async function call(p: Principal, authorizer: Authorizer, needed: Scope) {
    const refusal = checkScope(await effectiveScopes(p, authorizer), needed)
    return refusal ? { status: refusal.status, error: refusal.error } : { status: 200 }
  }

  it('demotion narrows a live credential', async () => {
    const { state, authorizer } = members({ ed: 'editor' })
    const token = principal('ed', ['docket:read', 'docket:write'])
    expect(await call(token, authorizer, 'docket:write')).toEqual({ status: 200 })

    state.roles.ed = 'viewer'

    expect(await call(token, authorizer, 'docket:write')).toEqual({ status: 403, error: 'insufficient_scope' })
    expect(await call(token, authorizer, 'docket:read')).toEqual({ status: 200 })
  })

  it('ontology:write follows the workspace setting and the role, on every call', async () => {
    const { state, authorizer } = members({ own: 'owner' }, ['owner', 'editor'])
    const token = principal('own', ['docket:read', 'ontology:write'])
    expect(await effectiveScopes(token, authorizer)).toEqual(['docket:read', 'ontology:read', 'ontology:write'])
    expect(state.askedFor).toEqual(['ws1'])
    // The owner turns it off, or leaves only editors on: the owner's own token loses it at once.
    state.writers = ['editor']
    expect(await effectiveScopes(token, authorizer)).toEqual(['docket:read', 'ontology:read'])
    state.writers = []
    expect(await effectiveScopes(token, authorizer)).toEqual(['docket:read', 'ontology:read'])
    // An authorizer that does not read the setting never grants it.
    state.writers = ['owner']
    expect(await effectiveScopes(token, { role: authorizer.role })).toEqual(['docket:read', 'ontology:read'])
  })

  it('reads the setting only for a credential that carries ontology:write', async () => {
    const { state, authorizer } = members({ own: 'owner' }, ['owner'])
    expect(await effectiveScopes(principal('own', ['docket:read', 'docket:write']), authorizer)).toEqual([
      'docket:read',
      'docket:write',
      'ontology:read'
    ])
    expect(state.askedFor).toEqual([])
  })

  it('removal leaves the credential nothing', async () => {
    const { state, authorizer } = members({ gone: 'editor' })
    const token = principal('gone', ['docket:read'])
    expect(await call(token, authorizer, 'docket:read')).toEqual({ status: 200 })
    delete state.roles.gone
    expect(await call(token, authorizer, 'docket:read')).toEqual({ status: 401, error: 'invalid_token' })
  })

  it("never grants more than the credential carries, whatever the role", async () => {
    const { authorizer } = members({ own: 'owner' }, ['owner'])
    expect(await effectiveScopes(principal('own', ['ontology:read']), authorizer)).toEqual(['ontology:read'])
  })

  it("passes a deployment's own principal type through to its authorizer", async () => {
    interface OrgPrincipal extends Principal {
      orgId: string
    }
    const seen: string[] = []
    const authorizer: Authorizer<OrgPrincipal> = {
      role: async (p) => {
        seen.push(p.orgId)
        return 'editor'
      }
    }
    const token: OrgPrincipal = { ...principal('ed', ['docket:read']), orgId: 'orga' }
    expect(await effectiveScopes(token, authorizer)).toEqual(['docket:read', 'ontology:read'])
    expect(seen).toEqual(['orga'])
  })
})
