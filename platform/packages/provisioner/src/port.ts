// SPDX-License-Identifier: AGPL-3.0-only
import type { OrgRef } from '@docket/platform-tenancy'

/** Connection details one store hands back for an org (§16). */
export interface StoreBinding {
  store: 'postgres' | 'neo4j' | 'qdrant'
  /** Where to connect, for example a `bolt+s://` URL or a schema name. */
  target: string
  /** The name of the k8s Secret that holds this org's credentials, never the credentials. */
  credentialsSecret?: string
  /**
   * `provision` had to make the store's data anew (a first provision, or one
   * whose volume or collection was lost): whatever was projected into it
   * before is gone, and the org's projections need a rebuild.
   */
  created?: boolean
}

export type StoreHealth = 'ok' | 'degraded' | 'down'

/**
 * One implementation per store. Moving a store to a managed service is a new
 * implementation of this port plus a data move; nothing else changes.
 * Deprovisioning goes through `deprovision` only.
 */
export interface TenantProvisioner {
  /** Creates the org's schema, database or collection and its credentials. Safe to repeat. */
  provision(org: OrgRef): Promise<StoreBinding>
  /** Connection details for a request. */
  bind(org: OrgRef): Promise<StoreBinding>
  /** Scales to zero where the store can; refuses requests where it cannot. */
  suspend(org: OrgRef): Promise<void>
  /** `soft` stops serving the org; `shred` also destroys its keys and data. */
  deprovision(org: OrgRef, mode: 'soft' | 'shred'): Promise<void>
  health(org: OrgRef): Promise<StoreHealth>
}
