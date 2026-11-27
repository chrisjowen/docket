// SPDX-License-Identifier: AGPL-3.0-only
import { enqueue, listWorkspaces } from '@docket/platform-canonical-store'
import type { EmbedderConfig, StoreAccess } from '@docket/platform-projections'
import type { Neo4jPodProvisioner, QdrantProvisioner } from '@docket/platform-provisioner'
import type { TenantRouter, Tx } from '@docket/platform-tenancy'

import type { Logger } from './outbox.js'

/**
 * Each org's projection stores (§5.2, §5.3): its Neo4j pod and Qdrant
 * collections, provisioned by the worker (the API pods hold no Kubernetes
 * rights), woken on use, and suspended after a day idle (§15.1).
 */
export interface OrgStores {
  /** Provisions both stores for the org; safe to repeat. Records the outcome in `platform.org_stores`. */
  ensure(orgId: string): Promise<void>
  /** Credentials for one pass, waking a suspended Neo4j pod first. */
  access(orgId: string): Promise<StoreAccess>
  /** Scales down the Neo4j pods no projection or query has used for `idleMs`. */
  sweepIdle(): Promise<string[]>
}

export interface OrgStoresOptions {
  router: TenantRouter
  neo4j: Neo4jPodProvisioner
  qdrant: QdrantProvisioner
  embedder: EmbedderConfig
  log: Logger
  idleMs?: number
  now?: () => Date
}

type StoreRow = { store: 'neo4j' | 'qdrant'; status: string }

async function record(
  tx: Tx,
  orgId: string,
  store: 'neo4j' | 'qdrant',
  fields: { status: string; target?: string | null; credentialsSecret?: string | null; lastError?: string | null; used?: boolean },
): Promise<void> {
  await tx.query(
    `INSERT INTO platform.org_stores (org_id, store, status, target, credentials_secret, last_error, used_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END)
     ON CONFLICT (org_id, store) DO UPDATE SET status = EXCLUDED.status,
       target = coalesce(EXCLUDED.target, platform.org_stores.target),
       credentials_secret = coalesce(EXCLUDED.credentials_secret, platform.org_stores.credentials_secret),
       last_error = EXCLUDED.last_error,
       used_at = coalesce(EXCLUDED.used_at, platform.org_stores.used_at),
       updated_at = now()`,
    [orgId, store, fields.status, fields.target ?? null, fields.credentialsSecret ?? null, fields.lastError ?? null, fields.used === true],
  )
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export function orgStores(options: OrgStoresOptions): OrgStores {
  const { router } = options
  const idleMs = options.idleMs ?? 24 * 60 * 60 * 1000
  const now = options.now ?? (() => new Date())
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => router.withPlatform(fn)

  const statuses = (orgId: string) =>
    platform(async (tx) => {
      const { rows } = await tx.query<StoreRow>('SELECT store, status FROM platform.org_stores WHERE org_id = $1', [orgId])
      return new Map(rows.map((row) => [row.store, row.status]))
    })

  const stores: OrgStores = {
    async ensure(orgId) {
      const org = { orgId }
      for (const [store, provisioner] of [
        ['neo4j', options.neo4j],
        ['qdrant', options.qdrant],
      ] as const) {
        try {
          const before = (await statuses(orgId)).get(store)
          const binding = await provisioner.provision(org)
          if (binding.created && before !== undefined) {
            // The store lost what was projected into it (a volume or collection gone):
            // the manifests vouch for nothing there now, so every workspace is rebuilt (§6.2).
            options.log.info(`org ${orgId}'s ${store} was made anew; rebuilding its workspaces`)
            await router.withTenant(orgId, async (tx) => {
              for (const workspace of await listWorkspaces(tx)) await enqueue(tx, workspace.id, 'rebuild')
            })
          }
          // A suspended pod stays suspended: provisioning does not wake it.
          const suspended = store === 'neo4j' && before === 'suspended'
          await platform((tx) =>
            record(tx, orgId, store, {
              status: suspended ? 'suspended' : 'ready',
              target: binding.target,
              credentialsSecret: binding.credentialsSecret ?? null,
            }),
          )
        } catch (error) {
          options.log.error(`provision ${store} for org ${orgId}: ${messageOf(error)}`)
          await platform((tx) => record(tx, orgId, store, { status: 'failed', lastError: messageOf(error).slice(0, 2_000) }))
          throw error
        }
      }
    },

    async access(orgId) {
      const org = { orgId }
      const known = await statuses(orgId)
      if (known.get('neo4j') !== 'ready' && known.get('neo4j') !== 'suspended') await stores.ensure(orgId)
      if (known.get('qdrant') !== 'ready') await stores.ensure(orgId)
      if ((await statuses(orgId)).get('neo4j') === 'suspended' || (await options.neo4j.health(org)) !== 'ok') {
        options.log.info(`waking org ${orgId}'s Neo4j`)
        await options.neo4j.wake(org)
      }
      const [neo4j, qdrant] = await Promise.all([options.neo4j.credentials(org), options.qdrant.access(org, 3_600)])
      await platform(async (tx) => {
        await record(tx, orgId, 'neo4j', { status: 'ready', used: true })
        await record(tx, orgId, 'qdrant', { status: 'ready', used: true })
      })
      return { neo4j, qdrant, embedder: options.embedder }
    },

    async sweepIdle() {
      const idle = await platform(async (tx) => {
        const { rows } = await tx.query<{ org_id: string }>(
          `SELECT org_id FROM platform.org_stores
            WHERE store = 'neo4j' AND status = 'ready' AND coalesce(used_at, updated_at) < $1`,
          [new Date(now().getTime() - idleMs)],
        )
        return rows.map((row) => row.org_id)
      })
      for (const orgId of idle) {
        try {
          await options.neo4j.suspend({ orgId })
          await platform((tx) => record(tx, orgId, 'neo4j', { status: 'suspended' }))
          options.log.info(`suspended org ${orgId}'s Neo4j after ${Math.round(idleMs / 3_600_000)}h idle`)
        } catch (error) {
          options.log.error(`suspend org ${orgId}'s Neo4j: ${messageOf(error)}`)
        }
      }
      return idle
    },
  }
  return stores
}
