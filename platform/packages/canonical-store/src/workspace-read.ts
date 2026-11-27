// SPDX-License-Identifier: AGPL-3.0-only
import type { webcrypto } from 'node:crypto'

import type { ValidateResult } from './docket.js'
import { TRUST_FINGERPRINT_SQL, validate } from './trust.js'
import type { StoreContext } from './documents.js'
import { postgresSource } from './postgres-source.js'

type Stamp = { fingerprint: string; versions: number[] }
type Entry = {
  fingerprint: string
  keys: webcrypto.CryptoKey[]
  read: ValidateResult
  bytes: number
  expires: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * A cheap, tenant-scoped read of canonical revisions and index checkpoints.
 * Document revisions matter too: a write must be visible before the worker
 * acknowledges it. xmin also detects replacement/corruption of a sealed row.
 * What the org attests about sources is in it too: it changes every score.
 */
async function stamp(ctx: StoreContext, workspaceId: string): Promise<Stamp> {
  const { rows } = await ctx.tx.query<Stamp>(
    `SELECT md5(json_build_array(
       (SELECT json_build_array(number, yaml_hash, xmin::text) FROM ontology_versions
         WHERE workspace_id = $1 AND status = 'published' ORDER BY number DESC LIMIT 1),
       (SELECT json_agg(json_build_array(id, path, hash, revision, dek_version, xmin::text) ORDER BY path)
         FROM documents WHERE workspace_id = $1 AND retired_at IS NULL),
       (SELECT json_agg(json_build_array(instance_id, checkpoint) ORDER BY instance_id)
         FROM projection_status WHERE workspace_id = $1),
       ${TRUST_FINGERPRINT_SQL}
     )::text) AS fingerprint,
     ARRAY(SELECT DISTINCT dek_version FROM documents
       WHERE workspace_id = $1 AND retired_at IS NULL ORDER BY dek_version) AS versions`,
    [workspaceId],
  )
  return rows[0]!
}

/** Bounded process-local cache; no transaction or in-flight read is shared between callers. */
export function createWorkspaceReadCache(options: { maxBytes?: number; maxEntries?: number; ttlMs?: number; now?: () => number } = {}) {
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024
  const maxEntries = options.maxEntries ?? 8
  const ttlMs = options.ttlMs ?? 60_000
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry>()
  let bytes = 0
  const remove = (id: string) => {
    const entry = entries.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    bytes -= entry.bytes
    entries.delete(id)
  }

  return async (ctx: StoreContext, workspaceId: string): Promise<ValidateResult> => {
    // Authorization and key loading happen before this call on every request.
    const id = `${ctx.keys.orgId}/${workspaceId}`
    const before = await stamp(ctx, workspaceId)
    let keys: webcrypto.CryptoKey[]
    try {
      keys = [ctx.keys.key(), ...before.versions.map((version) => ctx.keys.key(version))]
    } catch {
      // Preserve the canonical reader's per-document diagnostics for missing
      // historical keys instead of failing the entire query at cache lookup.
      remove(id)
      return validate({ source: postgresSource(ctx, workspaceId) })
    }
    const held = entries.get(id)
    if (held && held.expires > now() && held.fingerprint === before.fingerprint &&
        held.keys.length === keys.length && held.keys.every((key, index) => key === keys[index])) {
      entries.delete(id)
      entries.set(id, held)
      return structuredClone(held.read)
    }
    remove(id)
    const read = await validate({ source: postgresSource(ctx, workspaceId) })
    const after = await stamp(ctx, workspaceId)
    // Never cache a read straddling concurrent commits, nor a failed decryption.
    if (before.fingerprint !== after.fingerprint || read.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return read
    const size = Buffer.byteLength(JSON.stringify(read, (_key, value: unknown) =>
      value instanceof Map || value instanceof Set ? [...value] : value))
    if (size > maxBytes || maxEntries < 1) return read
    // Another caller may have completed a miss while this one was reading.
    remove(id)
    while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value!)
    const timer = setTimeout(() => remove(id), ttlMs)
    timer.unref()
    entries.set(id, { fingerprint: before.fingerprint, keys, read: structuredClone(read), bytes: size, expires: now() + ttlMs, timer })
    bytes += size
    return read
  }
}

/** Reuses canonical reads across worker queries; projection standing is computed afresh. */
export const readWorkspace = createWorkspaceReadCache()
