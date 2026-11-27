// SPDX-License-Identifier: AGPL-3.0-only
import type { webcrypto } from 'node:crypto'

/** Unwrapped data keys stay in memory for at most this long (§7.3). */
export const DEK_TTL_MS = 10 * 60 * 1000

/**
 * Caches each org's unwrapped data key for at most `ttlMs`. Keys are
 * non-extractable `CryptoKey`s, so the cache never holds raw key bytes.
 */
export function dekCache(options: {
  load: (orgId: string, version: number) => Promise<webcrypto.CryptoKey>
  ttlMs?: number
  now?: () => number
}) {
  const ttl = options.ttlMs ?? DEK_TTL_MS
  const now = options.now ?? Date.now
  const entries = new Map<string, { key: Promise<webcrypto.CryptoKey>; loadedAt: number }>()

  return {
    get(orgId: string, version: number): Promise<webcrypto.CryptoKey> {
      const id = `${orgId}#${version}`
      const hit = entries.get(id)
      if (hit && now() - hit.loadedAt < ttl) return hit.key
      const key = options.load(orgId, version)
      entries.set(id, { key, loadedAt: now() })
      key.catch(() => entries.delete(id))
      return key
    },
    /** Drops every cached key of an org, for example after it is deprovisioned. */
    forget(orgId: string): void {
      for (const id of entries.keys()) if (id.startsWith(`${orgId}#`)) entries.delete(id)
    },
  }
}
