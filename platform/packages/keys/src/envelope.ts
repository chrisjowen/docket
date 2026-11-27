// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'

const NONCE_BYTES = 12
const subtle = webcrypto.subtle

export class EnvelopeError extends Error {
  override name = 'EnvelopeError'
}

export interface Sealed {
  ciphertext: Uint8Array
  /** 96 bits, random per encryption. */
  nonce: Uint8Array
}

const encoder = new TextEncoder()

function bytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value
}

/**
 * Encrypts with an org's data key: AES-256-GCM, a fresh 96-bit nonce every
 * time, and associated data that binds the ciphertext to its row
 * (`orgId|workspaceId|documentId|revision`, §7.3).
 */
export async function encrypt(
  key: webcrypto.CryptoKey,
  plaintext: Uint8Array | string,
  aad: string,
): Promise<Sealed> {
  const nonce = webcrypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(aad) }, key, bytes(plaintext)),
  )
  return { ciphertext, nonce }
}

/** Decrypts what `encrypt` sealed. A wrong key, nonce or associated data throws `EnvelopeError`. */
export async function decrypt(
  key: webcrypto.CryptoKey,
  sealed: Sealed,
  aad: string,
): Promise<Uint8Array> {
  if (sealed.nonce.length !== NONCE_BYTES) {
    throw new EnvelopeError(`nonce must be ${NONCE_BYTES} bytes`)
  }
  try {
    return new Uint8Array(
      await subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.nonce, additionalData: encoder.encode(aad) },
        key,
        sealed.ciphertext,
      ),
    )
  } catch {
    throw new EnvelopeError('ciphertext does not open with this key and associated data')
  }
}

/** `decrypt`, as UTF-8 text. */
export async function decryptText(key: webcrypto.CryptoKey, sealed: Sealed, aad: string): Promise<string> {
  return new TextDecoder().decode(await decrypt(key, sealed, aad))
}
