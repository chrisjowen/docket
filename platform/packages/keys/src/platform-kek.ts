// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { KeyService } from './key-service.js'

const KEY_BYTES = 32
const NONCE_BYTES = 12
const subtle = webcrypto.subtle

export class KekError extends Error {
  override name = 'KekError'
}

/**
 * Parses a 256-bit KEK from its base64 text, as it is stored in the k8s Secret.
 * Surrounding whitespace (a trailing newline from `kubectl create secret`) is ignored.
 */
export function parseKek(text: string): Uint8Array {
  const trimmed = text.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new KekError('KEK is not base64')
  }
  const bytes = new Uint8Array(Buffer.from(trimmed, 'base64'))
  if (bytes.length !== KEY_BYTES) {
    throw new KekError(`KEK must be ${KEY_BYTES} bytes, got ${bytes.length}`)
  }
  return bytes
}

/** Reads the KEK from the file the Secret is mounted at. */
export async function readKekFile(path: string): Promise<Uint8Array> {
  return parseKek(await readFile(path, 'utf8'))
}

function aad(orgId: string, kekId: string): Uint8Array {
  return new TextEncoder().encode(`${orgId}|${kekId}`)
}

/** A KEK and the id the wrapped keys record for it. */
export interface Kek {
  kek: Uint8Array
  kekId: string
}

async function importKek(entry: Kek): Promise<webcrypto.CryptoKey> {
  if (entry.kek.length !== KEY_BYTES) {
    throw new KekError(`KEK must be ${KEY_BYTES} bytes, got ${entry.kek.length}`)
  }
  return subtle.importKey('raw', entry.kek, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * The beta KeyService: one platform KEK held in memory only.
 *
 * A wrapped DEK is `nonce (12 bytes) || AES-256-GCM(KEK, DEK)` with AAD
 * `orgId|kekId`, so one org's wrapped key cannot be unwrapped as another's.
 * Unwrapped DEKs are non-extractable AES-GCM keys.
 *
 * During a KEK rotation (ops/runbooks/rotate-kek.md) the other KEK, first
 * the incoming one and then the outgoing one, is passed in `others`: keys
 * wrapped under it unwrap, and `rewrap` moves each one under the current KEK.
 * New keys are only ever wrapped under the current one.
 */
export async function platformKeyService(options: Kek & { others?: readonly Kek[] }): Promise<KeyService> {
  const { kekId } = options
  const keks = new Map<string, webcrypto.CryptoKey>()
  for (const entry of options.others ?? []) {
    if (entry.kekId === kekId) throw new KekError(`other KEK ${entry.kekId} has the current KEK's id`)
    keks.set(entry.kekId, await importKek(entry))
  }
  const current = await importKek(options)
  keks.set(kekId, current)

  async function seal(orgId: string, dek: Uint8Array): Promise<Uint8Array> {
    const nonce = webcrypto.getRandomValues(new Uint8Array(NONCE_BYTES))
    const sealed = new Uint8Array(
      await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(orgId, kekId) }, current, dek),
    )
    const wrapped = new Uint8Array(NONCE_BYTES + sealed.length)
    wrapped.set(nonce, 0)
    wrapped.set(sealed, NONCE_BYTES)
    return wrapped
  }

  /** The raw DEK; the caller zeroes it. */
  async function open(orgId: string, wrapped: Uint8Array, wrappedKekId: string): Promise<Uint8Array> {
    const kek = keks.get(wrappedKekId)
    if (!kek) {
      throw new KekError(`unknown KEK ${wrappedKekId}`)
    }
    if (wrapped.length <= NONCE_BYTES) {
      throw new KekError('wrapped key is too short')
    }
    const nonce = wrapped.subarray(0, NONCE_BYTES)
    const sealed = wrapped.subarray(NONCE_BYTES)
    try {
      return new Uint8Array(
        await subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(orgId, wrappedKekId) }, kek, sealed),
      )
    } catch {
      throw new KekError('wrapped key does not belong to this org or KEK')
    }
  }

  return {
    kekId,
    otherKekIds: [...keks.keys()].filter((id) => id !== kekId),

    async wrapNewKey(orgId) {
      const dek = webcrypto.getRandomValues(new Uint8Array(KEY_BYTES))
      try {
        return { wrapped: await seal(orgId, dek), kekId }
      } finally {
        dek.fill(0)
      }
    },

    async unwrap(orgId, wrapped, wrappedKekId) {
      const dek = await open(orgId, wrapped, wrappedKekId)
      try {
        return await subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt', 'decrypt'])
      } finally {
        dek.fill(0)
      }
    },

    async rewrap(orgId, wrapped, wrappedKekId) {
      const dek = await open(orgId, wrapped, wrappedKekId)
      try {
        return { wrapped: await seal(orgId, dek), kekId }
      } finally {
        dek.fill(0)
      }
    },
  }
}
