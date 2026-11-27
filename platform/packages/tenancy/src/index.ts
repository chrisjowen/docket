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
  ACCOUNT,
  BUILTIN_ROLES,
  CAPABILITIES,
  CAPABILITY_INFO,
  CONTENT_CAPABILITIES,
  appliesTo,
  because,
  builtinRole,
  can,
  capsAt,
  covers,
  docketPlace,
  GENERAL_SPACE_ID,
  grantCaps,
  grantRoleLabel,
  isAccountAdmin,
  isCapability,
  mayCreateSpace,
  mayEditRoles,
  mayGrant,
  placeFromRow,
  placeIdOf,
  placeKey,
  samePlace,
  seesDocket,
  seesSpace,
  spacePlace,
  summarise,
} from './roles.js'
export type { Access, BuiltinRoleId, Capability, CapabilityInfo, DocketSpaces, Grant, Grantee, Place, Role } from './roles.js'
export { accessOf, deleteRole, docketSpaces, listGrants, listRoles, ownerCount, removeGrant, rolesOf, saveRole, setGrant, setOwner } from './access.js'
export type { GrantView, RoleUse } from './access.js'
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
export * from './identity.js'
export { lookupMasterKey } from './master-key.js'
export type { MasterKeyPrincipal } from './master-key.js'

/** A reference to the isolation unit: the org and, where it matters, its workspace. */
export interface OrgRef {
  orgId: string
}
