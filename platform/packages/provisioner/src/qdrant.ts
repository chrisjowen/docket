// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from 'node:crypto'

import type { OrgRef } from '@docket/platform-tenancy'
// The names module alone: no SQL, so the e2e suite can load this file as it is.
import { qdrantCollectionPrefix } from '@docket/platform-tenancy/names'

import type { StoreBinding, StoreHealth, TenantProvisioner } from './port.js'

/**
 * Qdrant for an org (§5.3): its collections, named `org_<id>__*`, made with
 * the platform's API key, and short-lived JWTs that reach only those
 * collections (Qdrant's JWT RBAC). A token for org A cannot read
 * `org_B__mem0`, even if a collection name were mixed up.
 */
export interface QdrantOptions {
  /** For example `https://docket-qdrant.docket-cloud.svc:6333`. */
  url: string
  /** The platform's Qdrant API key: makes collections, and signs the JWTs. Never leaves the worker. */
  apiKey: string
  /** The embedder's vector size (`nomic-embed-text`: 768). */
  dimension: number
  fetch?: typeof fetch
}

/** Where an org's mem0 memories go, and what to authenticate with. */
export interface QdrantAccess {
  url: string
  /** mem0's collection; mem0 keeps its entity index in `<collection>_entities`. */
  collection: string
  /** A JWT for the org's collections only. */
  token: string
  dimension: number
}

export interface QdrantProvisioner extends TenantProvisioner {
  /** A JWT for the org's collections, valid for `ttlSeconds`. */
  access(org: OrgRef, ttlSeconds?: number): Promise<QdrantAccess>
}

export class QdrantError extends Error {
  override name = 'QdrantError'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** mem0's collection for the org: `org_<id>__mem0`. */
export function mem0Collection(org: OrgRef): string {
  return `${qdrantCollectionPrefix(org.orgId)}mem0`
}

/** The collections an org owns: mem0's memories and its entity index. */
export function orgCollections(org: OrgRef): string[] {
  const memories = mem0Collection(org)
  return [memories, `${memories}_entities`]
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

/**
 * A Qdrant JWT (HS256, signed with the API key) granting read-write on
 * exactly `collections` until `exp`. Qdrant checks the signature, the expiry
 * and the collection on every request.
 */
export function qdrantToken(apiKey: string, collections: readonly string[], ttlSeconds: number, now = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      exp: Math.floor(now / 1000) + ttlSeconds,
      access: collections.map((collection) => ({ collection, access: 'rw' })),
    }),
  )
  const signature = createHmac('sha256', apiKey).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${signature}`
}

/** The payload fields mem0 filters on: Qdrant refuses to filter on an unindexed field. */
const FILTER_FIELDS = ['user_id', 'agent_id', 'run_id', 'actor_id']

export function qdrantProvisioner(options: QdrantOptions): QdrantProvisioner {
  const fetchImpl = options.fetch ?? fetch
  const base = options.url.replace(/\/+$/, '')

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { 'api-key': options.apiKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    return { status: response.status, json }
  }

  const fail = (what: string, response: { status: number; json: unknown }) => {
    const reason = (response.json as { status?: { error?: string } } | null)?.status?.error ?? JSON.stringify(response.json)
    return new QdrantError(response.status, `qdrant ${what}: ${response.status} ${String(reason).slice(0, 300)}`)
  }

  /** Makes the collection when it is missing; true when it had to. */
  async function ensureCollection(name: string): Promise<boolean> {
    const found = await call('GET', `/collections/${name}`)
    if (found.status === 200) {
      const size = (found.json as { result?: { config?: { params?: { vectors?: { size?: number } } } } })?.result?.config?.params?.vectors?.size
      if (size !== undefined && size !== options.dimension) {
        throw new QdrantError(409, `qdrant collection ${name} holds ${size}-dimensional vectors, not ${options.dimension}`)
      }
    } else if (found.status === 404) {
      // The shape mem0 makes itself: cosine vectors and the BM25 sparse slot for hybrid search.
      const created = await call('PUT', `/collections/${name}`, {
        vectors: { size: options.dimension, distance: 'Cosine', on_disk: true },
        sparse_vectors: { bm25: { modifier: 'idf' } },
        on_disk_payload: true,
      })
      if (created.status !== 200 && created.status !== 409) throw fail(`create ${name}`, created)
    } else {
      throw fail(`read ${name}`, found)
    }
    for (const field of FILTER_FIELDS) {
      const indexed = await call('PUT', `/collections/${name}/index?wait=true`, { field_name: field, field_schema: 'keyword' })
      if (indexed.status !== 200) throw fail(`index ${name}.${field}`, indexed)
    }
    return found.status === 404
  }

  const provisioner: QdrantProvisioner = {
    async provision(org) {
      let created = false
      for (const name of orgCollections(org)) created = (await ensureCollection(name)) || created
      return { ...(await provisioner.bind(org)), created }
    },

    async bind(org): Promise<StoreBinding> {
      return { store: 'qdrant', target: `${base}/collections/${mem0Collection(org)}` }
    },

    async access(org, ttlSeconds = 3_600) {
      return {
        url: base,
        collection: mem0Collection(org),
        token: qdrantToken(options.apiKey, orgCollections(org), ttlSeconds),
        dimension: options.dimension,
      }
    },

    // One Qdrant serves every org; there is nothing of an org's own to scale down.
    async suspend() {},

    async deprovision(org, mode) {
      // The vectors are a projection: rebuilt from Postgres, so even a soft deprovision drops them.
      void mode
      for (const name of orgCollections(org)) {
        const deleted = await call('DELETE', `/collections/${name}`)
        if (deleted.status !== 200 && deleted.status !== 404) throw fail(`delete ${name}`, deleted)
      }
    },

    async health(org): Promise<StoreHealth> {
      try {
        const found = await call('GET', `/collections/${mem0Collection(org)}`)
        return found.status === 200 ? 'ok' : 'down'
      } catch {
        return 'down'
      }
    },
  }
  return provisioner
}
