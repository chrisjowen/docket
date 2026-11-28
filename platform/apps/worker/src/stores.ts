// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'

import { enqueue, listWorkspaces } from '@docket/platform-canonical-store'
import type { EmbedderConfig, StoreAccess } from '@docket/platform-projections'
import type { Neo4jPodProvisioner, Neo4jRef, QdrantProvisioner, QdrantRef } from '@docket/platform-provisioner'
import type { TenantRouter, Tx } from '@docket/platform-tenancy'

import type { Logger } from './outbox.js'

/**
 * The stores each docket projects into (§5.2, §5.3; tenancy v2 §5): the
 * Neo4j instance and Qdrant collection `platform.docket_stores` names for it.
 * A docket gets its space's own Neo4j instance when the space has one,
 * otherwise its account's, and a Qdrant collection of its own; the dockets
 * that existed before keep the account's shared collection. Every store is
 * provisioned by the worker (the API pods hold no Kubernetes rights), woken on
 * use, and a Neo4j pod suspended after a day idle (§15.1). When a space gets
 * its own instance, or gives it up, its dockets move and are rebuilt from
 * Postgres: moving is a rebuild, not a data migration.
 */
export interface OrgStores {
  /**
   * Provisions every store the org has (the account's Neo4j, spaces' own
   * instances, dockets' collections) and moves dockets to where they belong;
   * safe to repeat. Records each outcome in `platform.stores`.
   */
  ensure(orgId: string): Promise<void>
  /** Credentials for one pass over one docket, giving a new docket its stores and waking a suspended Neo4j pod first. */
  access(orgId: string, workspaceId: string): Promise<StoreAccess>
  /** After a deleted docket's purge: drops its own collection, and forgets which stores it used. */
  release(orgId: string, workspaceId: string): Promise<void>
  /** Scales down the Neo4j pods no projection or query has used for `idleMs`; the stores it suspended, as `<org>/<store>`. */
  sweepIdle(): Promise<string[]>
}

export interface OrgStoresOptions {
  router: TenantRouter
  neo4j: Neo4jPodProvisioner
  qdrant: QdrantProvisioner
  embedder: EmbedderConfig
  log: Logger
  /**
   * Clears a docket's scope from the Neo4j it is moving off, so its records
   * are left only where it projects now. Best effort: a failure is logged.
   */
  clearScope?(neo4j: StoreAccess['neo4j'], workspaceId: string): Promise<void>
  idleMs?: number
  now?: () => Date
}

type Kind = 'neo4j' | 'qdrant'
type Status = 'requested' | 'provisioning' | 'ready' | 'suspended' | 'failed' | 'retiring'

export interface StoreRow {
  id: string
  kind: Kind
  spaceId: string | null
  docketId: string | null
  status: Status
  target: string | null
}

type Row = { id: string; kind: Kind; space_id: string | null; docket_id: string | null; status: Status; target: string | null }
const toStore = (row: Row): StoreRow => ({ id: row.id, kind: row.kind, spaceId: row.space_id, docketId: row.docket_id, status: row.status, target: row.target })

/** A new store's id: `st` and 16 lowercase hex digits, safe in a Kubernetes name. */
export const newStoreId = () => `st${randomBytes(8).toString('hex')}`

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** The provisioner's name for a store: a space's own Neo4j by its id, a docket's collection by the docket. */
const neo4jRef = (orgId: string, store: StoreRow): Neo4jRef => (store.spaceId ? { orgId, storeId: store.id } : { orgId })
const qdrantRef = (orgId: string, store: StoreRow): QdrantRef => (store.docketId ? { orgId, docketId: store.docketId } : { orgId })

/** A Neo4j instance a docket may be given: provisioned, awake or asleep. */
const usable = (store: StoreRow | undefined) => store !== undefined && (store.status === 'ready' || store.status === 'suspended')

async function storesOf(tx: Tx, orgId: string): Promise<StoreRow[]> {
  const { rows } = await tx.query<Row>(
    'SELECT id, kind, space_id, docket_id, status, target FROM platform.stores WHERE org_id = $1 ORDER BY created_at, id',
    [orgId],
  )
  return rows.map(toStore)
}

async function assignmentsOf(tx: Tx, orgId: string, docketId?: string): Promise<Map<string, Map<Kind, string>>> {
  const { rows } = await tx.query<{ docket_id: string; kind: Kind; store_id: string }>(
    `SELECT docket_id, kind, store_id FROM platform.docket_stores WHERE org_id = $1 ${docketId ? 'AND docket_id = $2' : ''}`,
    docketId ? [orgId, docketId] : [orgId],
  )
  const out = new Map<string, Map<Kind, string>>()
  for (const row of rows) {
    const each = out.get(row.docket_id) ?? new Map<Kind, string>()
    each.set(row.kind, row.store_id)
    out.set(row.docket_id, each)
  }
  return out
}

async function record(
  tx: Tx,
  storeId: string,
  fields: { status: Status; target?: string | null; credentialsSecret?: string | null; lastError?: string | null; used?: boolean },
): Promise<void> {
  await tx.query(
    `UPDATE platform.stores SET status = CASE WHEN status = 'retiring' THEN status ELSE $2 END,
       target = coalesce($3, target),
       credentials_secret = coalesce($4, credentials_secret),
       last_error = $5,
       used_at = CASE WHEN $6 THEN now() ELSE used_at END,
       updated_at = now()
     WHERE id = $1`,
    [storeId, fields.status, fields.target ?? null, fields.credentialsSecret ?? null, fields.lastError ?? null, fields.used === true],
  )
}

/** The account's store of a kind, made (to be provisioned) when the org has none yet. */
async function accountStore(tx: Tx, orgId: string, kind: Kind): Promise<StoreRow> {
  await tx.query(
    `INSERT INTO platform.stores (id, org_id, kind, status) VALUES ($1, $2, $3, 'provisioning')
     ON CONFLICT (org_id, kind, coalesce(space_id, ''), coalesce(docket_id, '')) DO NOTHING`,
    [newStoreId(), orgId, kind],
  )
  const { rows } = await tx.query<Row>(
    'SELECT id, kind, space_id, docket_id, status, target FROM platform.stores WHERE org_id = $1 AND kind = $2 AND space_id IS NULL AND docket_id IS NULL',
    [orgId, kind],
  )
  return toStore(rows[0] as Row)
}

/** Where a docket in `spaceId` belongs in Neo4j: its space's own instance once that is up, else the account's. */
function neo4jFor(stores: readonly StoreRow[], spaceId: string | null): StoreRow | undefined {
  const own = spaceId ? stores.find((store) => store.kind === 'neo4j' && store.spaceId === spaceId) : undefined
  if (usable(own)) return own
  return stores.find((store) => store.kind === 'neo4j' && !store.spaceId && !store.docketId)
}

export function orgStores(options: OrgStoresOptions): OrgStores {
  const { router } = options
  const idleMs = options.idleMs ?? 24 * 60 * 60 * 1000
  const now = options.now ?? (() => new Date())
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => router.withPlatform(fn)

  /** Queues a rebuild of the live dockets among `docketIds`: what they projected is gone, or they moved. */
  const rebuild = (orgId: string, docketIds: readonly string[]) =>
    router.withTenant(orgId, async (tx) => {
      const live = new Set((await listWorkspaces(tx)).map((workspace) => workspace.id))
      for (const id of docketIds) if (live.has(id)) await enqueue(tx, id, 'rebuild')
    })

  /** Provisions one store; safe to repeat. A store made anew has lost whatever was projected into it. */
  async function provision(orgId: string, store: StoreRow): Promise<void> {
    if (store.status === 'retiring') return
    try {
      if (store.status === 'requested') await platform((tx) => record(tx, store.id, { status: 'provisioning' }))
      const binding = store.kind === 'neo4j' ? await options.neo4j.provision(neo4jRef(orgId, store)) : await options.qdrant.provision(qdrantRef(orgId, store))
      if (binding.created && store.target !== null) {
        // The store lost what was projected into it (a volume or collection gone): the manifests
        // vouch for nothing there now, so every docket that uses it is rebuilt (§6.2).
        options.log.info(`org ${orgId}'s ${store.kind} store ${store.id} was made anew; rebuilding its dockets`)
        const using = await platform(async (tx) => {
          const { rows } = await tx.query<{ docket_id: string }>('SELECT docket_id FROM platform.docket_stores WHERE store_id = $1', [store.id])
          return rows.map((row) => row.docket_id)
        })
        await rebuild(orgId, using)
      }
      // A suspended pod stays suspended: provisioning does not wake it.
      await platform((tx) =>
        record(tx, store.id, {
          status: store.status === 'suspended' ? 'suspended' : 'ready',
          target: binding.target,
          credentialsSecret: binding.credentialsSecret ?? null,
        }),
      )
    } catch (error) {
      options.log.error(`provision ${store.kind} store ${store.id} for org ${orgId}: ${messageOf(error)}`)
      await platform((tx) => record(tx, store.id, { status: 'failed', lastError: messageOf(error).slice(0, 2_000) }))
      throw error
    }
  }

  /** Wakes a Neo4j instance when it sleeps, then hands back its credentials. */
  async function neo4jCredentials(orgId: string, store: StoreRow): Promise<StoreAccess['neo4j']> {
    const ref = neo4jRef(orgId, store)
    if (store.status === 'suspended' || (await options.neo4j.health(ref)) !== 'ok') {
      options.log.info(`waking org ${orgId}'s Neo4j ${store.spaceId ? `store ${store.id}` : ''}`.trim())
      await options.neo4j.wake(ref)
    }
    return options.neo4j.credentials(ref)
  }

  /**
   * Moves every live docket whose space's Neo4j changed (the space's own
   * instance came up, or is retiring; not one that failed to provision) to
   * where it belongs now, queues its rebuild there and clears it from where it
   * was; then removes a retiring instance nothing uses any more.
   */
  async function converge(orgId: string): Promise<void> {
    const workspaces = await router.withTenant(orgId, listWorkspaces)
    const moves = await platform(async (tx) => {
      const stores = await storesOf(tx, orgId)
      const assigned = await assignmentsOf(tx, orgId)
      const moved: { docketId: string; from: StoreRow }[] = []
      for (const workspace of workspaces) {
        const current = assigned.get(workspace.id)?.get('neo4j')
        if (!current) continue
        const from = stores.find((store) => store.id === current)
        if (from?.spaceId && from.spaceId === workspace.spaceId && from.status !== 'retiring') continue
        const want = neo4jFor(stores, workspace.spaceId)
        if (!want || want.id === current) continue
        await tx.query('UPDATE platform.docket_stores SET store_id = $4, assigned_at = now() WHERE org_id = $1 AND docket_id = $2 AND kind = $3', [
          orgId,
          workspace.id,
          'neo4j',
          want.id,
        ])
        if (from) moved.push({ docketId: workspace.id, from })
      }
      return moved
    })
    if (moves.length) {
      options.log.info(`org ${orgId}: ${moves.length} docket(s) moved to another Neo4j; rebuilding them there`)
      // Cleared from where they were first, then rebuilt where they are: where both are one server (a local
      // preview's), a clear after the rebuild would wipe it.
      for (const move of moves) {
        // A retiring instance is removed whole; nothing to clear in it first.
        if (!options.clearScope || move.from.status === 'retiring') continue
        try {
          await options.clearScope(await neo4jCredentials(orgId, move.from), move.docketId)
        } catch (error) {
          options.log.error(`clear docket ${move.docketId} from org ${orgId}'s Neo4j ${move.from.id}: ${messageOf(error)}`)
        }
      }
      await rebuild(
        orgId,
        moves.map((move) => move.docketId),
      )
    }

    // A retiring instance nothing uses any more is removed: its pod, volume and Secret.
    const retired = await platform(async (tx) => {
      const { rows } = await tx.query<Row>(
        `SELECT id, kind, space_id, docket_id, status, target FROM platform.stores s
          WHERE s.org_id = $1 AND s.status = 'retiring'
            AND NOT EXISTS (SELECT 1 FROM platform.docket_stores d WHERE d.store_id = s.id)`,
        [orgId],
      )
      return rows.map(toStore)
    })
    for (const store of retired) {
      try {
        await options.neo4j.deprovision(neo4jRef(orgId, store), 'shred')
        await platform((tx) => tx.query('DELETE FROM platform.stores WHERE id = $1 AND status = $2', [store.id, 'retiring']))
        options.log.info(`removed org ${orgId}'s Neo4j store ${store.id}`)
      } catch (error) {
        options.log.error(`remove org ${orgId}'s Neo4j store ${store.id}: ${messageOf(error)}`)
      }
    }
  }

  /** The docket's stores, giving a new docket its own: its space's Neo4j or the account's, and a collection of its own. */
  async function docketStores(orgId: string, workspaceId: string): Promise<{ neo4j: StoreRow; qdrant: StoreRow }> {
    return platform(async (tx) => {
      let assigned = (await assignmentsOf(tx, orgId, workspaceId)).get(workspaceId)
      if (!assigned?.get('neo4j') || !assigned.get('qdrant')) {
        const { rows } = await tx.query<{ space_id: string }>('SELECT space_id FROM platform.docket_spaces($1) WHERE docket_id = $2', [orgId, workspaceId])
        const spaceId = rows[0]?.space_id ?? null
        if (!assigned?.get('neo4j')) {
          await accountStore(tx, orgId, 'neo4j')
          const want = neo4jFor(await storesOf(tx, orgId), spaceId) as StoreRow
          await tx.query(
            `INSERT INTO platform.docket_stores (org_id, docket_id, kind, store_id) VALUES ($1, $2, 'neo4j', $3)
             ON CONFLICT (org_id, docket_id, kind) DO NOTHING`,
            [orgId, workspaceId, want.id],
          )
        }
        if (!assigned?.get('qdrant')) {
          await tx.query(
            `INSERT INTO platform.stores (id, org_id, kind, docket_id, status) VALUES ($1, $2, 'qdrant', $3, 'provisioning')
             ON CONFLICT (org_id, kind, coalesce(space_id, ''), coalesce(docket_id, '')) DO NOTHING`,
            [newStoreId(), orgId, workspaceId],
          )
          await tx.query(
            `INSERT INTO platform.docket_stores (org_id, docket_id, kind, store_id)
             SELECT $1, $2, 'qdrant', id FROM platform.stores WHERE org_id = $1 AND kind = 'qdrant' AND docket_id = $2
             ON CONFLICT (org_id, docket_id, kind) DO NOTHING`,
            [orgId, workspaceId],
          )
        }
        assigned = (await assignmentsOf(tx, orgId, workspaceId)).get(workspaceId)
      }
      const stores = await storesOf(tx, orgId)
      const byId = (id: string | undefined) => stores.find((store) => store.id === id) as StoreRow
      return { neo4j: byId(assigned?.get('neo4j')), qdrant: byId(assigned?.get('qdrant')) }
    })
  }

  const stores: OrgStores = {
    async ensure(orgId) {
      let first: unknown
      const all = await platform(async (tx) => {
        await accountStore(tx, orgId, 'neo4j')
        return storesOf(tx, orgId)
      })
      for (const store of all) {
        // Each store on its own: one failing never holds up the others.
        await provision(orgId, store).catch((error: unknown) => {
          first ??= error
        })
      }
      await converge(orgId).catch((error: unknown) => {
        options.log.error(`move dockets between org ${orgId}'s stores: ${messageOf(error)}`)
        first ??= error
      })
      if (first !== undefined) throw first
    },

    async access(orgId, workspaceId) {
      let mine = await docketStores(orgId, workspaceId)
      if (!usable(mine.neo4j) || mine.qdrant.status !== 'ready') {
        if (!usable(mine.neo4j)) await provision(orgId, mine.neo4j)
        if (mine.qdrant.status !== 'ready') await provision(orgId, mine.qdrant)
        mine = await docketStores(orgId, workspaceId)
      }
      const [neo4j, qdrant] = await Promise.all([neo4jCredentials(orgId, mine.neo4j), options.qdrant.access(qdrantRef(orgId, mine.qdrant), 3_600)])
      await platform(async (tx) => {
        await record(tx, mine.neo4j.id, { status: 'ready', used: true })
        await record(tx, mine.qdrant.id, { status: 'ready', used: true })
      })
      return { neo4j, qdrant, embedder: options.embedder }
    },

    async release(orgId, workspaceId) {
      const own = await platform(async (tx) => {
        const { rows } = await tx.query<Row>(
          `SELECT id, kind, space_id, docket_id, status, target FROM platform.stores WHERE org_id = $1 AND kind = 'qdrant' AND docket_id = $2`,
          [orgId, workspaceId],
        )
        return rows.map(toStore)
      })
      for (const store of own) await options.qdrant.deprovision(qdrantRef(orgId, store), 'shred')
      await platform(async (tx) => {
        await tx.query('DELETE FROM platform.docket_stores WHERE org_id = $1 AND docket_id = $2', [orgId, workspaceId])
        await tx.query("DELETE FROM platform.stores WHERE org_id = $1 AND kind = 'qdrant' AND docket_id = $2", [orgId, workspaceId])
      })
    },

    async sweepIdle() {
      const idle = await platform(async (tx) => {
        const { rows } = await tx.query<Row & { org_id: string }>(
          `SELECT org_id, id, kind, space_id, docket_id, status, target FROM platform.stores
            WHERE kind = 'neo4j' AND status = 'ready' AND coalesce(used_at, updated_at) < $1`,
          [new Date(now().getTime() - idleMs)],
        )
        return rows.map((row) => ({ orgId: row.org_id, store: toStore(row) }))
      })
      const suspended: string[] = []
      for (const { orgId, store } of idle) {
        try {
          await options.neo4j.suspend(neo4jRef(orgId, store))
          await platform((tx) => record(tx, store.id, { status: 'suspended' }))
          options.log.info(`suspended org ${orgId}'s Neo4j ${store.id} after ${Math.round(idleMs / 3_600_000)}h idle`)
          suspended.push(`${orgId}/${store.id}`)
        } catch (error) {
          options.log.error(`suspend org ${orgId}'s Neo4j ${store.id}: ${messageOf(error)}`)
        }
      }
      return suspended
    },
  }
  return stores
}
