// SPDX-License-Identifier: AGPL-3.0-only
// The `?raw` module type, for packages that typecheck this file without Vite's client types.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./sql.d.ts" />
import org0001 from '../migrations/org/0001_workspaces_documents_audit.sql?raw'
import org0002 from '../migrations/org/0002_ontology_manifests_outbox.sql?raw'
import org0003 from '../migrations/org/0003_projections.sql?raw'
import org0004 from '../migrations/org/0004_repo_sync.sql?raw'
import org0005 from '../migrations/org/0005_write_ingest_events.sql?raw'
import org0006 from '../migrations/org/0006_workspace_deletions.sql?raw'
import org0007 from '../migrations/org/0007_ontology_mcp_publish.sql?raw'
import org0008 from '../migrations/org/0008_enrichment.sql?raw'
import org0009 from '../migrations/org/0009_saved_chats.sql?raw'
import org0010 from '../migrations/org/0010_sync_runs_query_traces.sql?raw'
import org0011 from '../migrations/org/0011_admin_databases.sql?raw'
import org0012 from '../migrations/org/0012_consolidation.sql?raw'
import org0013 from '../migrations/org/0013_supersession.sql?raw'
import org0014 from '../migrations/org/0014_cognee.sql?raw'
import org0015 from '../migrations/org/0015_trust.sql?raw'
import org0016 from '../migrations/org/0016_namespace_grants.sql?raw'
import org0017 from '../migrations/org/0017_namespace_access.sql?raw'
import org0018 from '../migrations/org/0018_ontology_templates.sql?raw'
import org0019 from '../migrations/org/0019_docket_grants.sql?raw'
import org0020 from '../migrations/org/0020_spaces.sql?raw'
import platform0001 from '../migrations/platform/0001_identity_orgs_audit.sql?raw'
import platform0002 from '../migrations/platform/0002_ai_and_stores.sql?raw'
import platform0003 from '../migrations/platform/0003_mcp_auth.sql?raw'
import platform0004 from '../migrations/platform/0004_rate_limits_and_chain_checks.sql?raw'
import platform0005 from '../migrations/platform/0005_github_repo_sync.sql?raw'
import platform0006 from '../migrations/platform/0006_beta_waitlist.sql?raw'
import platform0007 from '../migrations/platform/0007_ontology_write_scope.sql?raw'
import platform0008 from '../migrations/platform/0008_beta_allowlist_github_id.sql?raw'
import platform0009 from '../migrations/platform/0009_org_admin.sql?raw'
import platform0010 from '../migrations/platform/0010_cognify_lease.sql?raw'
import platform0011 from '../migrations/platform/0011_service_accountable_user.sql?raw'
import platform0012 from '../migrations/platform/0012_namespace_grants.sql?raw'
import platform0013 from '../migrations/platform/0013_namespace_access.sql?raw'
import platform0014 from '../migrations/platform/0014_database_accounts.sql?raw'
import platform0015 from '../migrations/platform/0015_identities.sql?raw'
import platform0016 from '../migrations/platform/0016_tokens_and_connections.sql?raw'
import platform0017 from '../migrations/platform/0017_capabilities_and_grants.sql?raw'
import platform0018 from '../migrations/platform/0018_spaces.sql?raw'
import platform0019 from '../migrations/platform/0019_place_settings_and_stores.sql?raw'
import platform0020 from '../migrations/platform/0020_ai_usage_paid_by.sql?raw'
import platform0021 from '../migrations/platform/0021_invite_links.sql?raw'
import platform0022 from '../migrations/platform/0022_account_limits.sql?raw'

export interface Migration {
  version: number
  name: string
  sql: string
  /**
   * A later migration that replaced what this one set up. A schema that
   * already has it keeps it; one that does not records it as applied, with
   * its checksum, without running it.
   */
  supersededBy?: string
}

/**
 * The migrations, in order. Each is SQL with `{{placeholders}}` the runner
 * fills with checked identifiers. They are imported as text so the server
 * bundle carries them.
 */
export const PLATFORM_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_identity_orgs_audit', sql: platform0001 },
  { version: 2, name: '0002_ai_and_stores', sql: platform0002 },
  { version: 3, name: '0003_mcp_auth', sql: platform0003 },
  { version: 4, name: '0004_rate_limits_and_chain_checks', sql: platform0004 },
  { version: 5, name: '0005_github_repo_sync', sql: platform0005 },
  { version: 6, name: '0006_beta_waitlist', sql: platform0006 },
  { version: 7, name: '0007_ontology_write_scope', sql: platform0007 },
  { version: 8, name: '0008_beta_allowlist_github_id', sql: platform0008 },
  { version: 9, name: '0009_org_admin', sql: platform0009 },
  { version: 10, name: '0010_cognify_lease', sql: platform0010 },
  { version: 11, name: '0011_service_accountable_user', sql: platform0011 },
  { version: 12, name: '0012_namespace_grants', sql: platform0012 },
  { version: 13, name: '0013_namespace_access', sql: platform0013 },
  { version: 14, name: '0014_database_accounts', sql: platform0014 },
  { version: 15, name: '0015_identities', sql: platform0015 },
  { version: 16, name: '0016_tokens_and_connections', sql: platform0016 },
  { version: 17, name: '0017_capabilities_and_grants', sql: platform0017 },
  { version: 18, name: '0018_spaces', sql: platform0018 },
  { version: 19, name: '0019_place_settings_and_stores', sql: platform0019 },
  { version: 20, name: '0020_ai_usage_paid_by', sql: platform0020 },
  { version: 21, name: '0021_invite_links', sql: platform0021 },
  { version: 22, name: '0022_account_limits', sql: platform0022 },
]

export const ORG_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_workspaces_documents_audit', sql: org0001 },
  { version: 2, name: '0002_ontology_manifests_outbox', sql: org0002 },
  { version: 3, name: '0003_projections', sql: org0003 },
  { version: 4, name: '0004_repo_sync', sql: org0004 },
  { version: 5, name: '0005_write_ingest_events', sql: org0005 },
  { version: 6, name: '0006_workspace_deletions', sql: org0006 },
  { version: 7, name: '0007_ontology_mcp_publish', sql: org0007 },
  { version: 8, name: '0008_enrichment', sql: org0008 },
  { version: 9, name: '0009_saved_chats', sql: org0009 },
  { version: 10, name: '0010_sync_runs_query_traces', sql: org0010 },
  { version: 11, name: '0011_admin_databases', sql: org0011 },
  { version: 12, name: '0012_consolidation', sql: org0012 },
  { version: 13, name: '0013_supersession', sql: org0013 },
  { version: 14, name: '0014_cognee', sql: org0014 },
  { version: 15, name: '0015_trust', sql: org0015 },
  { version: 16, name: '0016_namespace_grants', sql: org0016, supersededBy: 'platform 0017_capabilities_and_grants' },
  { version: 17, name: '0017_namespace_access', sql: org0017, supersededBy: 'platform 0017_capabilities_and_grants' },
  { version: 18, name: '0018_ontology_templates', sql: org0018 },
  { version: 19, name: '0019_docket_grants', sql: org0019 },
  { version: 20, name: '0020_spaces', sql: org0020 },
]

/** The org schema version this build serves. An org behind it is migrated before it is served. */
export const ORG_SCHEMA_VERSION = ORG_MIGRATIONS.at(-1)?.version ?? 0
