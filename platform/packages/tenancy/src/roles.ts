// SPDX-License-Identifier: AGPL-3.0-only
/** Per-org roles (§4), most to least privileged. */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** The rows of the §4 role table, in its order. */
export const ACTIONS = [
  'graph.read',
  'knowledge.write',
  'ontology.propose',
  'ontology.publish',
  'repos.connect',
  'workspaces.delete',
  'enrichment.manage',
  'projections.manage',
  'tokens.create-own',
  'tokens.manage',
  'members.manage',
  'trust.manage',
  'templates.manage',
  'proposals.override',
  'audit.view-full',
  'audit.view-own',
  'org.administer',
] as const
export type Action = (typeof ACTIONS)[number]

/** How each row reads in the UI's role matrix. */
export const ACTION_LABELS: Record<Action, string> = {
  'graph.read': 'Read graph, search, ask, view activity',
  'knowledge.write': 'Write knowledge (UI, MCP, CLI push)',
  'ontology.propose': 'Propose an ontology draft',
  'ontology.publish': 'Publish an ontology version',
  'repos.connect': 'Connect repos, enable export PRs',
  'workspaces.delete': 'Delete a workspace and everything in it',
  'enrichment.manage': 'Turn background enrichment on or off, set its schedule and limit, retire what a run added',
  'projections.manage': 'Turn optional projections (cognee) on or off, set their search floor and AI limit',
  'tokens.create-own': 'Create API tokens for themselves (viewers: read-only tokens)',
  'tokens.manage': "Create service-account tokens, revoke anyone's token",
  'members.manage': 'Invite and remove members, change roles (not Owner)',
  'trust.manage': "Set what the org attests about sources: people's roles, teams and flags, registered documents",
  'templates.manage': "Save a docket's ontology as an org template, edit and delete the org's templates",
  'proposals.override': 'Accept a supersede proposal regardless of its score',
  'audit.view-full': 'View the full audit log',
  'audit.view-own': 'View their own audit entries',
  'org.administer': 'Change caps, transfer ownership, delete the org',
}

const EVERYONE: readonly Action[] = ['graph.read', 'tokens.create-own', 'audit.view-own']
const WRITERS: readonly Action[] = [...EVERYONE, 'knowledge.write', 'ontology.propose']
const ADMINS: readonly Action[] = [
  ...WRITERS,
  'ontology.publish',
  'repos.connect',
  'workspaces.delete',
  'enrichment.manage',
  'projections.manage',
  'tokens.manage',
  'members.manage',
  'trust.manage',
  'templates.manage',
  'proposals.override',
  'audit.view-full',
]

const GRANTS: Record<Role, ReadonlySet<Action>> = {
  viewer: new Set(EVERYONE),
  editor: new Set(WRITERS),
  admin: new Set(ADMINS),
  owner: new Set([...ADMINS, 'org.administer']),
}

export function can(role: Role, action: Action): boolean {
  return GRANTS[role].has(action)
}

/** The roles an actor may give someone, or take away from them. Only an owner touches the owner role (§4). */
export function assignableRoles(actor: Role): readonly Role[] {
  if (actor === 'owner') return ROLES
  if (actor === 'admin') return ['admin', 'editor', 'viewer']
  return []
}

/**
 * Whether `actor` may change a member from role `from` to role `to`
 * (or remove them, with `to` null). Admins manage everyone but owners.
 */
export function canChangeRole(actor: Role, from: Role, to: Role | null): boolean {
  const allowed = assignableRoles(actor)
  return allowed.includes(from) && (to === null || allowed.includes(to))
}

// Accounts and namespaces (tenancy design §4.2, §4.3). An org becomes an
// account and each of its workspaces a namespace (a "Docket"). A principal
// holds one account role, plus grants on single namespaces. The web app, MCP,
// the CLI's API and OAuth consent enforce these per workspace; what the org
// does as a whole still goes by the per-org role above.

/** Account roles, as `platform.memberships.account_role` stores them. */
export const ACCOUNT_ROLES = ['owner', 'admin', 'developer', 'read_only', 'guest', 'provisioner'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value)
}

/** A permission on one namespace, most to least privileged, as `platform.namespace_grants.permission` stores it. */
export const NAMESPACE_PERMISSIONS = ['admin', 'write', 'read'] as const
export type NamespacePermission = (typeof NAMESPACE_PERMISSIONS)[number]

export function isNamespacePermission(value: unknown): value is NamespacePermission {
  return typeof value === 'string' && (NAMESPACE_PERMISSIONS as readonly string[]).includes(value)
}

/** The account role a per-org role becomes, as platform migration 0012 derives it. */
export function accountRoleOf(role: Role): AccountRole {
  return ({ owner: 'owner', admin: 'admin', editor: 'developer', viewer: 'read_only' } as const)[role]
}

/** What an account role allows across the account, whatever namespaces it is granted. */
export const ACCOUNT_ACTIONS = [
  'account.view',
  'namespaces.list',
  'namespaces.create',
  'namespaces.manage',
  'grants.manage',
  'namespace-service-accounts.manage',
  'members.manage',
  'service-accounts.manage',
  'keys.manage',
  'trust.manage',
  'usage.view',
  'limits.manage',
  'audit.view-control-plane',
  'audit.view-full',
  'account.administer',
] as const
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number]

export const ACCOUNT_ACTION_LABELS: Record<AccountAction, string> = {
  'account.view': "See the account's name and settings",
  'namespaces.list': 'List every Docket in the account, granted or not',
  'namespaces.create': 'Create a Docket',
  'namespaces.manage': 'Rename or delete any Docket',
  'grants.manage': "Give or take away people's access to any Docket",
  'namespace-service-accounts.manage': "Create any Docket's service accounts and issue their keys",
  'members.manage': 'Invite and remove people, change account roles (not Owner)',
  'service-accounts.manage': 'Create account service accounts, including provisioners',
  'keys.manage': "Revoke anyone's keys, turn off key creation",
  'trust.manage': "Set what the account attests about sources: people's roles, teams and flags, registered documents",
  'usage.view': 'View usage by Docket',
  'limits.manage': "Change the account's limits",
  'audit.view-control-plane': 'View the audit log of Dockets, access and keys',
  'audit.view-full': 'View the full audit log',
  'account.administer': 'Billing, transfer ownership, delete the account',
}

const LIST: readonly AccountAction[] = ['account.view', 'namespaces.list']
/**
 * A provisioner (Initech's server, say) runs the control plane and nothing
 * else: it makes Dockets and decides who reaches them, but sees no content.
 */
const PROVISION: readonly AccountAction[] = [
  'namespaces.list',
  'namespaces.create',
  'namespaces.manage',
  'grants.manage',
  'namespace-service-accounts.manage',
  'usage.view',
  'audit.view-control-plane',
]
const ACCOUNT_ADMINS: readonly AccountAction[] = [
  ...LIST,
  ...PROVISION,
  'members.manage',
  'service-accounts.manage',
  'keys.manage',
  'trust.manage',
  'limits.manage',
  'audit.view-full',
]

const ACCOUNT_GRANTS: Record<AccountRole, ReadonlySet<AccountAction>> = {
  guest: new Set(),
  read_only: new Set(LIST),
  developer: new Set([...LIST, 'namespaces.create']),
  provisioner: new Set(PROVISION),
  admin: new Set(ACCOUNT_ADMINS),
  owner: new Set([...ACCOUNT_ADMINS, 'account.administer']),
}

export function canInAccount(role: AccountRole, action: AccountAction): boolean {
  return ACCOUNT_GRANTS[role].has(action)
}

/** What a namespace permission allows inside that one namespace. */
export const NAMESPACE_ACTIONS = [
  'graph.read',
  'knowledge.write',
  'ontology.propose',
  'ontology.publish',
  'repos.connect',
  'enrichment.manage',
  'projections.manage',
  'tokens.create-own',
  'tokens.manage',
  'grants.manage',
  'service-accounts.manage',
  'proposals.override',
  'audit.view-full',
  'audit.view-own',
  'namespace.delete',
] as const
export type NamespaceAction = (typeof NAMESPACE_ACTIONS)[number]

export const NAMESPACE_ACTION_LABELS: Record<NamespaceAction, string> = {
  'graph.read': 'Read graph, search, ask, view activity',
  'knowledge.write': 'Write knowledge (UI, MCP, CLI push)',
  'ontology.propose': 'Propose an ontology draft',
  'ontology.publish': 'Publish an ontology version',
  'repos.connect': 'Connect repos, enable export PRs',
  'enrichment.manage': 'Turn background enrichment on or off, set its schedule and limit, retire what a run added',
  'projections.manage': 'Turn optional projections (cognee) on or off, set their search floor and AI limit',
  'tokens.create-own': 'Create API tokens for themselves (Read: read-only tokens)',
  'tokens.manage': "Revoke anyone's token for this Docket",
  'grants.manage': "Give or take away people's access to this Docket",
  'service-accounts.manage': "Create this Docket's service accounts and issue their keys",
  'proposals.override': 'Accept a supersede proposal regardless of its score',
  'audit.view-full': "View this Docket's full audit log",
  'audit.view-own': 'View their own audit entries',
  'namespace.delete': 'Delete this Docket and everything in it',
}

/** Read, Write and Admin are today's viewer, editor and admin, inside one namespace. */
const READERS: readonly NamespaceAction[] = ['graph.read', 'tokens.create-own', 'audit.view-own']
const NAMESPACE_WRITERS: readonly NamespaceAction[] = [...READERS, 'knowledge.write', 'ontology.propose']

const NAMESPACE_GRANTS: Record<NamespacePermission, ReadonlySet<NamespaceAction>> = {
  read: new Set(READERS),
  write: new Set(NAMESPACE_WRITERS),
  admin: new Set(NAMESPACE_ACTIONS),
}

/** Whether a principal holding `permission` on a namespace (null: none) may do `action` there. */
export function canInNamespace(permission: NamespacePermission | null, action: NamespaceAction): boolean {
  return permission !== null && NAMESPACE_GRANTS[permission].has(action)
}

/** Whether `have` includes everything `need` allows. */
export function permissionIncludes(have: NamespacePermission | null, need: NamespacePermission): boolean {
  return have !== null && NAMESPACE_PERMISSIONS.indexOf(have) <= NAMESPACE_PERMISSIONS.indexOf(need)
}

/**
 * A principal's permission on one namespace: its account role's, joined with
 * its grants there. Owners and admins are admin on every namespace whatever
 * their grants say. A provisioner reaches no namespace, even one it was
 * granted, so it can never give itself content.
 */
export function namespacePermission(
  role: AccountRole,
  grants: readonly NamespacePermission[],
): NamespacePermission | null {
  if (role === 'owner' || role === 'admin') return 'admin'
  if (role === 'provisioner') return null
  return NAMESPACE_PERMISSIONS.find((permission) => grants.includes(permission)) ?? null
}

/** Whether a principal sees a namespace exists: in the list, or as a 404. Guests see only what they are granted. */
export function namespaceVisible(role: AccountRole, grants: readonly NamespacePermission[]): boolean {
  return canInAccount(role, 'namespaces.list') || namespacePermission(role, grants) !== null
}

/**
 * The grant a principal gets on a namespace it creates: a developer becomes
 * its admin, revocably. Owners and admins need none, and a provisioner takes
 * none.
 */
export function creatorGrant(role: AccountRole): NamespacePermission | null {
  return role === 'developer' ? 'admin' : null
}

/**
 * The account roles an actor may give someone, or take away from them. Only
 * an owner touches the owner role; a provisioner is a service account's role,
 * never a person's.
 */
export function assignableAccountRoles(actor: AccountRole, kind: 'human' | 'service'): readonly AccountRole[] {
  const allowed: readonly AccountRole[] =
    actor === 'owner' ? ACCOUNT_ROLES : actor === 'admin' ? ACCOUNT_ROLES.filter((role) => role !== 'owner') : []
  return kind === 'human' ? allowed.filter((role) => role !== 'provisioner') : allowed
}

/** Whether `actor` may change a `kind` principal's account role from `from` to `to` (or remove them, with `to` null). */
export function canChangeAccountRole(
  actor: AccountRole,
  kind: 'human' | 'service',
  from: AccountRole,
  to: AccountRole | null,
): boolean {
  const allowed = assignableAccountRoles(actor, kind)
  return allowed.includes(from) && (to === null || allowed.includes(to))
}

/**
 * Whether an actor may give a grantee any permission on a namespace, or take
 * their grant away. The actor manages grants across the account, or is that
 * namespace's admin. Only developers, read-only members and guests hold
 * grants: owners and admins are admin everywhere already, and a provisioner
 * may hold none, so it cannot grant itself content.
 */
export function canSetGrant(
  actor: { role: AccountRole; permission: NamespacePermission | null },
  grantee: AccountRole,
): boolean {
  const manages = canInAccount(actor.role, 'grants.manage') || canInNamespace(actor.permission, 'grants.manage')
  return manages && (grantee === 'developer' || grantee === 'read_only' || grantee === 'guest')
}
