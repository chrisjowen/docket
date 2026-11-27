// SPDX-License-Identifier: AGPL-3.0-only
import type { webcrypto } from 'node:crypto'

import { dekCache, type KeyService } from '@docket/platform-keys'
import type { Tx } from '@docket/platform-tenancy'

/** One org's data keys for the length of a request: the current one encrypts, any version decrypts. */
export interface OrgKeyring {
  orgId: string
  /** The version new writes are encrypted with (§7.3 rotation). */
  version: number
  /** The key of a version; throws for one the org does not have. */
  key(version?: number): webcrypto.CryptoKey
}

export class KeyringError extends Error {
  override name = 'KeyringError'
}

export interface Keyring {
  /**
   * Unwraps the org's data keys. Call it before `withTenant`: the wrapped keys
   * live in `platform.org_keys`, which an org role cannot read, and the
   * unwrapped ones stay cached for at most 10 minutes.
   */
  forOrg(orgId: string): Promise<OrgKeyring>
  /** Drops the org's cached keys, for example after it is deprovisioned. */
  forget(orgId: string): void
}

type WrappedRow = { version: number; wrapped: Buffer; kek_id: string }

/**
 * The data keys of every org, unwrapped through the `KeyService` and cached.
 * `platform` runs a query as the request role, with `search_path = platform`.
 */
export function keyring(options: {
  keys: KeyService
  platform: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
  ttlMs?: number
  now?: () => number
}): Keyring {
  const cache = dekCache({
    async load(orgId, version) {
      const rows = await options.platform(async (tx) => {
        const { rows } = await tx.query<WrappedRow>(
          'SELECT version, wrapped, kek_id FROM platform.org_keys WHERE org_id = $1 AND version = $2',
          [orgId, version],
        )
        return rows
      })
      const row = rows[0]
      if (!row) throw new KeyringError(`org ${orgId} has no data key version ${version}`)
      return options.keys.unwrap(orgId, new Uint8Array(row.wrapped), row.kek_id)
    },
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.now ? { now: options.now } : {}),
  })

  return {
    async forOrg(orgId) {
      const versions = await options.platform(async (tx) => {
        const { rows } = await tx.query<{ version: number }>(
          'SELECT version FROM platform.org_keys WHERE org_id = $1 ORDER BY version',
          [orgId],
        )
        return rows.map((row) => row.version)
      })
      const current = versions.at(-1)
      if (current === undefined) throw new KeyringError(`org ${orgId} has no data key`)
      const keys = new Map(await Promise.all(versions.map(async (v) => [v, await cache.get(orgId, v)] as const)))
      return {
        orgId,
        version: current,
        key(version = current) {
          const key = keys.get(version)
          if (!key) throw new KeyringError(`org ${orgId} has no data key version ${version}`)
          return key
        },
      }
    },
    forget: (orgId) => cache.forget(orgId),
  }
}
