// SPDX-License-Identifier: AGPL-3.0-only
export {
  SLUG,
  TenantIdError,
  newTenantId,
  orgRole,
  orgSchema,
  qdrantCollectionPrefix,
  slugProblem,
  workspaceScope,
} from './names.js'
export {
  ACCOUNT_ACTIONS,
  ACCOUNT_ACTION_LABELS,
  ACCOUNT_ROLES,
  ACTIONS,
  ACTION_LABELS,
  NAMESPACE_ACTIONS,
  NAMESPACE_ACTION_LABELS,
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
  isRole,
  namespacePermission,
  namespaceVisible,
  permissionIncludes,
} from './roles.js'
export type { AccountAction, AccountRole, Action, NamespaceAction, NamespacePermission, Role } from './roles.js'
export { ident, transaction } from './db.js'
export type { Tx } from './db.js'
export { MigrationError, migrateBehindOrgs, migrateOrg, migratePlatform } from './migrate.js'
export type { MigrateOptions } from './migrate.js'
export { ORG_MIGRATIONS, ORG_SCHEMA_VERSION, PLATFORM_MIGRATIONS } from './migrations.js'
export { OrgUnavailable, tenantRouter } from './router.js'
export type { TenantRouter } from './router.js'
export { INVITE_TTL_MS, LIMITS, PROVISIONING_TIMEOUT_MS } from './limits.js'
export * from './model.js'
export * from './waitlist.js'
export { lookupMasterKey } from './master-key.js'
export type { MasterKeyPrincipal } from './master-key.js'

/** A reference to the isolation unit: the org and, where it matters, its workspace. */
export interface OrgRef {
  orgId: string
}
