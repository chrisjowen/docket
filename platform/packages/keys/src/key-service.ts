// SPDX-License-Identifier: AGPL-3.0-only
import type { webcrypto } from 'node:crypto'

/**
 * Wraps and unwraps per-org data keys (DEKs) under a key-encryption key (KEK).
 *
 * The beta has one platform KEK. Each org records the `kekId` its DEKs are
 * wrapped under, so moving one org to its own KEK, or to a customer-held one,
 * means re-wrapping only that org's DEKs.
 */
export interface KeyService {
  /** The KEK new keys are wrapped under. */
  readonly kekId: string
  /** The other KEKs keys may be wrapped under during a rotation: they unwrap, and `rewrap` moves them. Empty otherwise. */
  readonly otherKekIds: readonly string[]
  /** Wraps a fresh data key for an org under the KEK this org is configured to use. */
  wrapNewKey(orgId: string): Promise<{ wrapped: Uint8Array; kekId: string }>
  unwrap(orgId: string, wrapped: Uint8Array, kekId: string): Promise<webcrypto.CryptoKey>
  /** Re-wraps an org's data key under the current KEK; the key itself does not change. */
  rewrap(orgId: string, wrapped: Uint8Array, kekId: string): Promise<{ wrapped: Uint8Array; kekId: string }>
}
