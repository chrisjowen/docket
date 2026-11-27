// SPDX-License-Identifier: AGPL-3.0-only
import type { webcrypto } from 'node:crypto'

import { decryptText, encrypt } from '@docket/platform-keys'
import type { Tx } from '@docket/platform-tenancy'

import { capOf } from './caps.js'
import type { OpenRouterClient } from './openrouter-client.js'

/** The slice of the canonical store's keyring this needs: an org's data keys. */
export interface OrgKeys {
  orgId: string
  version: number
  key(version?: number): webcrypto.CryptoKey
}

export interface OrgAiKeysDeps {
  platform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  /** Unwraps an org's data keys (the canonical store's keyring). */
  keysFor(orgId: string): Promise<OrgKeys>
  client: OpenRouterClient
  /**
   * The platform's own key, for orgs with no key of their own: when no
   * provisioning key is configured, every org shares it and only the cloud's
   * metering enforces the cap.
   */
  sharedKey?: string | undefined
}

export class AiNotConfigured extends Error {
  override name = 'AiNotConfigured'
  constructor(readonly orgId: string) {
    super('AI is not set up for this organisation yet — search still works')
  }
}

/** What `ensure` did to the org's key: with only a shared key there is nothing to provision. */
export type KeyOutcome = 'created' | 'limit-updated' | 'current' | 'shared'

/** Binds the sealed key to its org and OpenRouter id, so one org's ciphertext cannot stand in for another's. */
const aad = (orgId: string, hash: string) => `${orgId}|openrouter|${hash}`

type KeyRow = { key_hash: string; ciphertext: Buffer; nonce: Buffer; dek_version: number; limit_usd: string }

export interface OrgAiKeys {
  /**
   * Gives the org its own OpenRouter key with a credit limit equal to its
   * monthly cap, or brings the limit in line after the cap changed (§11).
   */
  ensure(orgId: string): Promise<KeyOutcome>
  /** The org's key, unsealed for one call. */
  key(orgId: string): Promise<string>
  /** Deletes the org's key at OpenRouter and here (org deletion). */
  revoke(orgId: string): Promise<void>
}

export function orgAiKeys(deps: OrgAiKeysDeps): OrgAiKeys {
  const read = (tx: Tx, orgId: string) =>
    tx
      .query<KeyRow>('SELECT key_hash, ciphertext, nonce, dek_version, limit_usd FROM platform.ai_keys WHERE org_id = $1', [orgId])
      .then(({ rows }) => rows[0])

  return {
    async ensure(orgId) {
      const keys = await deps.keysFor(orgId)
      return deps.platform(async (tx) => {
        // One provisioning at a time per org, so a race never makes two upstream keys.
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:ai-key:' || $1))", [orgId])
        const cap = await capOf(tx, orgId)
        const existing = await read(tx, orgId)
        if (existing) {
          if (Number(existing.limit_usd) === cap) return 'current'
          await deps.client.updateKeyLimit(existing.key_hash, cap)
          await tx.query('UPDATE platform.ai_keys SET limit_usd = $2, updated_at = now() WHERE org_id = $1', [orgId, cap])
          return 'limit-updated'
        }
        const created = await deps.client.createKey({ name: `docket-cloud org_${orgId}`, limitUsd: cap })
        try {
          const sealed = await encrypt(keys.key(), created.key, aad(orgId, created.hash))
          await tx.query(
            `INSERT INTO platform.ai_keys (org_id, key_hash, ciphertext, nonce, dek_version, limit_usd)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [orgId, created.hash, Buffer.from(sealed.ciphertext), Buffer.from(sealed.nonce), keys.version, cap],
          )
        } catch (error) {
          // Never leave a key upstream that nothing here can find again.
          await deps.client.deleteKey(created.hash).catch(() => undefined)
          throw error
        }
        return 'created'
      })
    },

    async key(orgId) {
      const row = await deps.platform((tx) => read(tx, orgId))
      if (!row && deps.sharedKey) return deps.sharedKey
      if (!row) throw new AiNotConfigured(orgId)
      const keys = await deps.keysFor(orgId)
      return decryptText(
        keys.key(row.dek_version),
        { ciphertext: new Uint8Array(row.ciphertext), nonce: new Uint8Array(row.nonce) },
        aad(orgId, row.key_hash),
      )
    },

    async revoke(orgId) {
      await deps.platform(async (tx) => {
        const row = await read(tx, orgId)
        if (!row) return
        await deps.client.deleteKey(row.key_hash)
        await tx.query('DELETE FROM platform.ai_keys WHERE org_id = $1', [orgId])
      })
    },
  }
}

/** How the platform reaches OpenRouter, from what is configured (§11). */
export type AiKeyMode = 'per-org' | 'shared' | 'off'

/**
 * The org keys for the platform's configuration: with a provisioning key,
 * each org gets its own key with a credit limit equal to its cap (enforced
 * upstream and by metering); with only an API key, every org shares it and
 * the cap is enforced from recorded usage alone (`assertWithinCap`); with
 * neither, AI is off and search still works.
 */
export function openRouterKeys(
  deps: Omit<OrgAiKeysDeps, 'client' | 'sharedKey'>,
  config: { provisioningKey?: string | undefined; apiKey?: string | undefined; appUrl?: string | undefined },
  makeClient: (options: { provisioningKey?: string | undefined; appUrl?: string | undefined }) => OpenRouterClient,
): { mode: AiKeyMode; keys: OrgAiKeys | null } {
  if (config.provisioningKey) {
    return {
      mode: 'per-org',
      keys: orgAiKeys({ ...deps, client: makeClient({ provisioningKey: config.provisioningKey, appUrl: config.appUrl }) }),
    }
  }
  if (config.apiKey) {
    const shared = orgAiKeys({ ...deps, client: makeClient({ appUrl: config.appUrl }), sharedKey: config.apiKey })
    // Nothing to provision: every org uses the shared key, capped by metering.
    return { mode: 'shared', keys: { ...shared, ensure: async () => 'shared', revoke: async () => undefined } }
  }
  return { mode: 'off', keys: null }
}
