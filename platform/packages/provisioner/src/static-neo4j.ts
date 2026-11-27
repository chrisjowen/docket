// SPDX-License-Identifier: AGPL-3.0-only
import type { OrgRef } from '@docket/platform-tenancy'

import type { Neo4jPodProvisioner } from './neo4j-pod.js'

/**
 * One Neo4j server for every org, for local previews and CI only: there is no
 * per-org process, so it does not meet §5.2 and the worker refuses it in
 * production. Workspaces are still separated by `scope`.
 */
export function staticNeo4jProvisioner(options: { url: string; username?: string; password: string }): Neo4jPodProvisioner {
  const binding = { store: 'neo4j' as const, target: options.url }
  return {
    provision: async (_org: OrgRef) => binding,
    bind: async () => binding,
    credentials: async () => ({ url: options.url, username: options.username ?? 'neo4j', password: options.password }),
    wake: async () => undefined,
    suspend: async () => undefined,
    deprovision: async () => undefined,
    health: async () => 'ok',
  }
}
