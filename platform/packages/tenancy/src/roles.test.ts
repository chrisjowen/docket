// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_ACTIONS,
  ACCOUNT_ROLES,
  ACTIONS,
  NAMESPACE_ACTIONS,
  NAMESPACE_PERMISSIONS,
  ROLES,
  accountRoleOf,
  assignableAccountRoles,
  assignableRoles,
  can,
  canChangeAccountRole,
  canChangeRole,
  canInAccount,
  canInNamespace,
  canSetGrant,
  creatorGrant,
  isAccountRole,
  isNamespacePermission,
  namespacePermission,
  namespaceVisible,
  permissionIncludes,
  type AccountAction,
  type AccountRole,
  type Action,
  type NamespaceAction,
  type NamespacePermission,
  type Role,
} from './roles.js'

/** The §4 role table, one row per action, columns owner / admin / editor / viewer. */
const TABLE: Record<Action, [owner: boolean, admin: boolean, editor: boolean, viewer: boolean]> = {
  'graph.read': [true, true, true, true],
  'knowledge.write': [true, true, true, false],
  'ontology.propose': [true, true, true, false],
  'ontology.publish': [true, true, false, false],
  'repos.connect': [true, true, false, false],
  'workspaces.delete': [true, true, false, false],
  'enrichment.manage': [true, true, false, false],
  'projections.manage': [true, true, false, false],
  'tokens.create-own': [true, true, true, true],
  'tokens.manage': [true, true, false, false],
  'members.manage': [true, true, false, false],
  'trust.manage': [true, true, false, false],
  'templates.manage': [true, true, false, false],
  'proposals.override': [true, true, false, false],
  'audit.view-full': [true, true, false, false],
  'audit.view-own': [true, true, true, true],
  'org.administer': [true, false, false, false],
}

const cells = ACTIONS.flatMap((action) =>
  ROLES.map((role, column) => ({ role, action, expected: TABLE[action][column] as boolean })),
)

describe('can', () => {
  it('covers every row of the §4 table', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...ACTIONS].sort())
  })

  it.each(cells)('can($role, $action) === $expected', ({ role, action, expected }) => {
    expect(can(role as Role, action)).toBe(expected)
  })

  it("matches the plan's example: an editor cannot publish the ontology", () => {
    expect(can('editor', 'ontology.publish')).toBe(false)
    expect(can('editor', 'knowledge.write')).toBe(true)
  })
})

describe('role changes', () => {
  it('lets only an owner give or take the owner role', () => {
    expect(assignableRoles('owner')).toContain('owner')
    expect(assignableRoles('admin')).not.toContain('owner')
    expect(canChangeRole('admin', 'owner', 'viewer')).toBe(false)
    expect(canChangeRole('admin', 'editor', 'owner')).toBe(false)
    expect(canChangeRole('owner', 'editor', 'owner')).toBe(true)
  })

  it('lets admins manage admins, editors and viewers', () => {
    expect(canChangeRole('admin', 'viewer', 'admin')).toBe(true)
    expect(canChangeRole('admin', 'admin', null)).toBe(true)
  })

  it('lets editors and viewers change no one', () => {
    expect(canChangeRole('editor', 'viewer', 'editor')).toBe(false)
    expect(canChangeRole('viewer', 'viewer', null)).toBe(false)
  })
})

/** The §4.2 account table, columns owner / admin / developer / read-only / guest / provisioner. */
const ACCOUNT_TABLE: Record<AccountAction, [boolean, boolean, boolean, boolean, boolean, boolean]> = {
  'account.view': [true, true, true, true, false, false],
  'namespaces.list': [true, true, true, true, false, true],
  'namespaces.create': [true, true, true, false, false, true],
  'namespaces.manage': [true, true, false, false, false, true],
  'grants.manage': [true, true, false, false, false, true],
  'namespace-service-accounts.manage': [true, true, false, false, false, true],
  'members.manage': [true, true, false, false, false, false],
  'service-accounts.manage': [true, true, false, false, false, false],
  'keys.manage': [true, true, false, false, false, false],
  'trust.manage': [true, true, false, false, false, false],
  'usage.view': [true, true, false, false, false, true],
  'limits.manage': [true, true, false, false, false, false],
  'audit.view-control-plane': [true, true, false, false, false, true],
  'audit.view-full': [true, true, false, false, false, false],
  'account.administer': [true, false, false, false, false, false],
}

/** The §4.2 namespace table, columns admin / write / read / no permission. */
const NAMESPACE_TABLE: Record<NamespaceAction, [boolean, boolean, boolean, boolean]> = {
  'graph.read': [true, true, true, false],
  'knowledge.write': [true, true, false, false],
  'ontology.propose': [true, true, false, false],
  'ontology.publish': [true, false, false, false],
  'repos.connect': [true, false, false, false],
  'enrichment.manage': [true, false, false, false],
  'projections.manage': [true, false, false, false],
  'tokens.create-own': [true, true, true, false],
  'tokens.manage': [true, false, false, false],
  'grants.manage': [true, false, false, false],
  'service-accounts.manage': [true, false, false, false],
  'proposals.override': [true, false, false, false],
  'audit.view-full': [true, false, false, false],
  'audit.view-own': [true, true, true, false],
  'namespace.delete': [true, false, false, false],
}

const PERMISSION_OR_NONE = [...NAMESPACE_PERMISSIONS, null] as const

/** Every set of grants a principal can hold on one namespace. */
const GRANT_SETS: NamespacePermission[][] = [[], ['admin'], ['write'], ['read'], ['admin', 'write'], ['admin', 'read'], ['write', 'read'], ['admin', 'write', 'read']]

/** The strongest of a set of grants, by hand. */
function strongest(grants: readonly NamespacePermission[]): NamespacePermission | null {
  if (grants.includes('admin')) return 'admin'
  if (grants.includes('write')) return 'write'
  if (grants.includes('read')) return 'read'
  return null
}

describe('account roles and namespace permissions', () => {
  it('recognise only their own values', () => {
    for (const role of ACCOUNT_ROLES) expect(isAccountRole(role)).toBe(true)
    for (const permission of NAMESPACE_PERMISSIONS) expect(isNamespacePermission(permission)).toBe(true)
    for (const value of ['editor', 'viewer', 'read-only', 'Owner', '', null, 1]) expect(isAccountRole(value)).toBe(false)
    for (const value of ['editor', 'viewer', 'owner', 'Admin', '', null, 1]) expect(isNamespacePermission(value)).toBe(false)
  })

  it('derive from per-org roles as the migration does', () => {
    expect(ROLES.map(accountRoleOf)).toEqual(['owner', 'admin', 'developer', 'read_only'])
  })
})

describe('canInAccount', () => {
  it('covers every row of the account table', () => {
    expect(Object.keys(ACCOUNT_TABLE).sort()).toEqual([...ACCOUNT_ACTIONS].sort())
  })

  it.each(
    ACCOUNT_ACTIONS.flatMap((action) =>
      ACCOUNT_ROLES.map((role, column) => ({ role, action, expected: ACCOUNT_TABLE[action][column] as boolean })),
    ),
  )('canInAccount($role, $action) === $expected', ({ role, action, expected }) => {
    expect(canInAccount(role, action)).toBe(expected)
  })
})

describe('canInNamespace', () => {
  it('covers every row of the namespace table', () => {
    expect(Object.keys(NAMESPACE_TABLE).sort()).toEqual([...NAMESPACE_ACTIONS].sort())
  })

  it.each(
    NAMESPACE_ACTIONS.flatMap((action) =>
      PERMISSION_OR_NONE.map((permission, column) => ({ permission, action, expected: NAMESPACE_TABLE[action][column] as boolean })),
    ),
  )('canInNamespace($permission, $action) === $expected', ({ permission, action, expected }) => {
    expect(canInNamespace(permission, action)).toBe(expected)
  })

  it("gives admin, write and read exactly today's admin, editor and viewer in that namespace", () => {
    const today = { admin: 'admin', write: 'editor', read: 'viewer' } as const
    const shared = NAMESPACE_ACTIONS.filter((action): action is NamespaceAction & Action => (ACTIONS as readonly string[]).includes(action))
    expect(shared.length).toBeGreaterThan(10)
    for (const permission of NAMESPACE_PERMISSIONS) {
      for (const action of shared) expect(canInNamespace(permission, action)).toBe(can(today[permission], action))
    }
  })
})

describe('permissionIncludes', () => {
  it.each(
    PERMISSION_OR_NONE.flatMap((have) =>
      NAMESPACE_PERMISSIONS.map((need) => ({
        have,
        need,
        expected: have !== null && NAMESPACE_PERMISSIONS.indexOf(have) <= NAMESPACE_PERMISSIONS.indexOf(need),
      })),
    ),
  )('permissionIncludes($have, $need) === $expected', ({ have, need, expected }) => {
    expect(permissionIncludes(have, need)).toBe(expected)
  })

  it('orders admin over write over read', () => {
    expect(permissionIncludes('admin', 'read')).toBe(true)
    expect(permissionIncludes('write', 'admin')).toBe(false)
    expect(permissionIncludes('read', 'write')).toBe(false)
  })
})

describe('namespacePermission', () => {
  const cases = ACCOUNT_ROLES.flatMap((role) => GRANT_SETS.map((grants) => ({ role, grants })))

  it.each(cases)('namespacePermission($role, $grants)', ({ role, grants }) => {
    const expected: Record<AccountRole, NamespacePermission | null> = {
      owner: 'admin',
      admin: 'admin',
      developer: strongest(grants),
      read_only: strongest(grants),
      guest: strongest(grants),
      provisioner: null,
    }
    expect(namespacePermission(role, grants)).toBe(expected[role])
  })

  it('keeps owners and admins admin with no grant at all', () => {
    expect(namespacePermission('owner', [])).toBe('admin')
    expect(namespacePermission('admin', ['read'])).toBe('admin')
  })

  it('gives a provisioner no content, even on a namespace it was granted', () => {
    for (const grants of GRANT_SETS) expect(namespacePermission('provisioner', grants)).toBeNull()
  })
})

describe('namespaceVisible', () => {
  it.each(ACCOUNT_ROLES.flatMap((role) => GRANT_SETS.map((grants) => ({ role, grants }))))(
    'namespaceVisible($role, $grants)',
    ({ role, grants }) => {
      const listsAll = role !== 'guest'
      expect(namespaceVisible(role, grants)).toBe(listsAll || grants.length > 0)
    },
  )

  it("hides another team's Docket from a guest", () => {
    expect(namespaceVisible('guest', [])).toBe(false)
    expect(namespaceVisible('guest', ['read'])).toBe(true)
  })
})

describe('creatorGrant', () => {
  it.each([
    { role: 'owner', expected: null },
    { role: 'admin', expected: null },
    { role: 'developer', expected: 'admin' },
    { role: 'read_only', expected: null },
    { role: 'guest', expected: null },
    { role: 'provisioner', expected: null },
  ] satisfies { role: AccountRole; expected: NamespacePermission | null }[])('creatorGrant($role) === $expected', ({ role, expected }) => {
    expect(creatorGrant(role)).toBe(expected)
  })

  it('makes a developer admin of a namespace they create', () => {
    expect(canInAccount('developer', 'namespaces.create')).toBe(true)
    expect(namespacePermission('developer', [creatorGrant('developer') as NamespacePermission])).toBe('admin')
  })
})

describe('account role changes', () => {
  const ASSIGNABLE: Record<AccountRole, Record<'human' | 'service', readonly AccountRole[]>> = {
    owner: {
      human: ['owner', 'admin', 'developer', 'read_only', 'guest'],
      service: ['owner', 'admin', 'developer', 'read_only', 'guest', 'provisioner'],
    },
    admin: {
      human: ['admin', 'developer', 'read_only', 'guest'],
      service: ['admin', 'developer', 'read_only', 'guest', 'provisioner'],
    },
    developer: { human: [], service: [] },
    read_only: { human: [], service: [] },
    guest: { human: [], service: [] },
    provisioner: { human: [], service: [] },
  }
  const KINDS = ['human', 'service'] as const

  it.each(ACCOUNT_ROLES.flatMap((actor) => KINDS.map((kind) => ({ actor, kind }))))(
    'assignableAccountRoles($actor, $kind)',
    ({ actor, kind }) => {
      expect(assignableAccountRoles(actor, kind)).toEqual(ASSIGNABLE[actor][kind])
    },
  )

  it('allows exactly the changes between assignable roles, for every actor, kind, from and to', () => {
    for (const actor of ACCOUNT_ROLES) {
      for (const kind of KINDS) {
        const allowed = ASSIGNABLE[actor][kind]
        for (const from of ACCOUNT_ROLES) {
          for (const to of [...ACCOUNT_ROLES, null]) {
            const expected = allowed.includes(from) && (to === null || allowed.includes(to))
            expect(canChangeAccountRole(actor, kind, from, to), `${actor} ${kind} ${from}→${to}`).toBe(expected)
          }
        }
      }
    }
  })

  it('lets only an owner give or take the owner role', () => {
    expect(canChangeAccountRole('owner', 'human', 'admin', 'owner')).toBe(true)
    expect(canChangeAccountRole('admin', 'human', 'admin', 'owner')).toBe(false)
    expect(canChangeAccountRole('admin', 'human', 'owner', null)).toBe(false)
  })

  it('never makes a person a provisioner', () => {
    expect(canChangeAccountRole('owner', 'human', 'developer', 'provisioner')).toBe(false)
    expect(canChangeAccountRole('admin', 'service', 'developer', 'provisioner')).toBe(true)
  })

  it('lets a provisioner change no one, not even itself', () => {
    expect(canChangeAccountRole('provisioner', 'service', 'provisioner', 'admin')).toBe(false)
    expect(canChangeAccountRole('provisioner', 'human', 'guest', 'developer')).toBe(false)
  })
})

describe('canSetGrant', () => {
  const MANAGES_ACROSS_ACCOUNT: readonly AccountRole[] = ['owner', 'admin', 'provisioner']
  const HOLDS_GRANTS: readonly AccountRole[] = ['developer', 'read_only', 'guest']

  it.each(
    ACCOUNT_ROLES.flatMap((role) =>
      PERMISSION_OR_NONE.flatMap((permission) => ACCOUNT_ROLES.map((grantee) => ({ role, permission, grantee }))),
    ),
  )('canSetGrant({ $role, $permission }, $grantee)', ({ role, permission, grantee }) => {
    const manages = MANAGES_ACROSS_ACCOUNT.includes(role) || permission === 'admin'
    expect(canSetGrant({ role, permission }, grantee)).toBe(manages && HOLDS_GRANTS.includes(grantee))
  })

  it("lets a namespace admin manage that namespace's grants without any account power", () => {
    expect(canSetGrant({ role: 'guest', permission: 'admin' }, 'guest')).toBe(true)
    expect(canSetGrant({ role: 'developer', permission: 'write' }, 'guest')).toBe(false)
  })

  it('lets a provisioner grant people but never a provisioner, itself included', () => {
    expect(canSetGrant({ role: 'provisioner', permission: null }, 'guest')).toBe(true)
    expect(canSetGrant({ role: 'provisioner', permission: null }, 'provisioner')).toBe(false)
  })

  it('gives no grants to owners and admins, who are admin everywhere already', () => {
    expect(canSetGrant({ role: 'owner', permission: null }, 'owner')).toBe(false)
    expect(canSetGrant({ role: 'owner', permission: null }, 'admin')).toBe(false)
  })
})
