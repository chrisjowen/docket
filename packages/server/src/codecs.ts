import { webcrypto } from 'node:crypto'

import type { DocumentCodec, DocumentRef, SealedBody } from './ports.js'

/**
 * Codecs a self-hosted server stores document bodies with. Docket Cloud
 * brings its own, sealing with each organisation's data key.
 */

/** `workspaceId|documentId|revision`: binds a sealed body to the row and revision it belongs to. */
export const defaultAad = (ref: DocumentRef): string => `${ref.workspaceId}|${ref.documentId}|${ref.revision}`

/** Stores bodies as they are: for a server whose operator owns the disk it runs on. */
export function plaintextCodec(): DocumentCodec {
  return {
    async seal(plain) {
      return { ciphertext: plain, nonce: new Uint8Array(0) }
    },
    async open(sealed) {
      return sealed.ciphertext
    },
    aad: defaultAad
  }
}

export class CodecError extends Error {
  override name = 'CodecError'
}

const NONCE_BYTES = 12

/**
 * Seals bodies with one local key: AES-256-GCM, a fresh 96-bit nonce each
 * time, and associated data that binds each body to its row and revision, so
 * a ciphertext moved to another row does not open. `key` is the 32 raw bytes
 * (keep them in a file, never in the database); `keyVersion` is recorded
 * beside each body.
 */
export function localKeyCodec(options: { key: Uint8Array; keyVersion?: number; aad?: (ref: DocumentRef) => string }): DocumentCodec {
  if (options.key.length !== 32) throw new CodecError('a local key is 32 bytes (AES-256)')
  const keyVersion = options.keyVersion ?? 1
  let imported: Promise<webcrypto.CryptoKey> | undefined
  const key = () => (imported ??= webcrypto.subtle.importKey('raw', options.key, 'AES-GCM', false, ['encrypt', 'decrypt']))
  const encoder = new TextEncoder()
  return {
    async seal(plain, aad): Promise<SealedBody> {
      const nonce = webcrypto.getRandomValues(new Uint8Array(NONCE_BYTES))
      const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(aad) }, await key(), plain))
      return { ciphertext, nonce, keyVersion }
    },
    async open(sealed, aad) {
      if (sealed.keyVersion !== undefined && sealed.keyVersion !== keyVersion) {
        throw new CodecError(`sealed with key version ${sealed.keyVersion}, not this key's ${keyVersion}`)
      }
      if (sealed.nonce.length !== NONCE_BYTES) throw new CodecError(`nonce must be ${NONCE_BYTES} bytes`)
      try {
        return new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.nonce, additionalData: encoder.encode(aad) }, await key(), sealed.ciphertext))
      } catch {
        throw new CodecError('ciphertext does not open with this key and associated data')
      }
    },
    aad: options.aad ?? defaultAad
  }
}
