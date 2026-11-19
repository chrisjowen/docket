import { hashContent, memoryConfigSchema, ONTOLOGY_PATH, type AdapterManifest, type CanonicalSource, type ManifestStore, type ResolvedConfig } from '../docket.js'
import type { StoreContext, Tx } from '../ports.js'
import { readDocuments } from './documents.js'

export class NoPublishedOntology extends Error {
  override name = 'NoPublishedOntology'
  constructor(readonly workspaceId: string) {
    super(`workspace ${workspaceId} has no published ontology`)
  }
}

/**
 * The configuration a workspace is read under. It names no adapters: a
 * server never loads adapter modules named in a workspace's config; it
 * registers its own instances.
 */
export function workspaceResolvedConfig(workspaceId: string): ResolvedConfig {
  const projectRoot = `/workspaces/${workspaceId}`
  return {
    config: memoryConfigSchema.parse({ version: 2, adapters: [] }),
    projectRoot,
    memoryRoot: `${projectRoot}/.docket`,
    ontologyPath: ONTOLOGY_PATH
  }
}

/** The text of the workspace's published head and its revision (`sha256:` of the text), or null. */
export async function publishedOntology(ctx: Pick<StoreContext, 'tx'>, workspaceId: string): Promise<{ text: string; revision: string; number: number } | null> {
  const { rows } = await ctx.tx.query<{ yaml: string; yaml_hash: string; number: number }>(
    `SELECT yaml, yaml_hash, number FROM ontology_versions
      WHERE workspace_id = $1 AND status = 'published' ORDER BY number DESC LIMIT 1`,
    [workspaceId]
  )
  const row = rows[0]
  return row ? { text: row.yaml, revision: row.yaml_hash, number: row.number } : null
}

/**
 * Docket's `CanonicalSource` over Postgres: the workspace's live documents,
 * opened with the store's codec and hash-checked, and its published ontology
 * head. `ontology` overrides the head, for checking a draft against the same
 * documents. Reads inside the caller's transaction, so one pass sees one
 * snapshot, one query at a time on its connection whatever order docket asks.
 */
export function postgresSource(ctx: StoreContext, workspaceId: string, options: { ontology?: string } = {}): CanonicalSource {
  let pending: Promise<unknown> = Promise.resolve()
  const serial = <T>(read: () => Promise<T>): Promise<T> => {
    const result = pending.then(read)
    pending = result.catch(() => undefined)
    return result
  }
  return {
    resolved: workspaceResolvedConfig(workspaceId),
    async ontology() {
      if (options.ontology !== undefined) return { text: options.ontology, revision: hashContent(options.ontology) }
      const head = await serial(() => publishedOntology(ctx, workspaceId))
      if (!head) throw new NoPublishedOntology(workspaceId)
      return { text: head.text, revision: head.revision }
    },
    async people() {
      return ctx.people ?? null
    },
    async *documents() {
      for (const document of await serial(() => readDocuments(ctx, workspaceId))) {
        if (document.raw === undefined) yield { path: document.path, error: document.error ?? 'unreadable' }
        else yield { path: document.path, raw: document.raw, hash: document.hash }
      }
    }
  }
}

/**
 * Docket's `ManifestStore` over Postgres: one row per adapter instance of the
 * workspace. A manifest holds ids, hashes and the checkpoint, never document
 * text, so it is stored as it is.
 */
export function postgresManifests(tx: Tx, workspaceId: string): ManifestStore {
  return {
    async read(instanceId) {
      const { rows } = await tx.query<{ manifest: AdapterManifest }>('SELECT manifest FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = $2', [workspaceId, instanceId])
      return rows[0]?.manifest
    },
    async write(instanceId, manifest) {
      await tx.query(
        `INSERT INTO adapter_manifests (workspace_id, instance_id, manifest) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, instance_id) DO UPDATE SET manifest = EXCLUDED.manifest, updated_at = now()`,
        [workspaceId, instanceId, JSON.stringify({ ...manifest, adapter: instanceId })]
      )
    },
    async list() {
      const { rows } = await tx.query<{ instance_id: string }>('SELECT instance_id FROM adapter_manifests WHERE workspace_id = $1 ORDER BY instance_id', [workspaceId])
      return rows.map((row) => row.instance_id)
    },
    async remove(instanceId) {
      await tx.query('DELETE FROM adapter_manifests WHERE workspace_id = $1 AND instance_id = $2', [workspaceId, instanceId])
    }
  }
}
