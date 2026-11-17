import type { DocumentCodec, DocumentRef } from '../ports.js'

/** A sealed text as its row holds it: the ciphertext, the nonce and the key version. */
export interface SealedColumns {
  ciphertext: Buffer
  nonce: Buffer
  keyVersion: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Seals a text for the row and revision `ref` names, with the store's codec. */
export async function sealText(codec: DocumentCodec, text: string, ref: DocumentRef): Promise<SealedColumns> {
  const sealed = await codec.seal(encoder.encode(text), codec.aad(ref))
  return { ciphertext: Buffer.from(sealed.ciphertext), nonce: Buffer.from(sealed.nonce), keyVersion: sealed.keyVersion ?? 0 }
}

/** Opens what `sealText` sealed for `ref`; throws when it does not open. */
export async function openText(codec: DocumentCodec, row: { ciphertext: Buffer; nonce: Buffer; keyVersion: number }, ref: DocumentRef): Promise<string> {
  const plain = await codec.open({ ciphertext: new Uint8Array(row.ciphertext), nonce: new Uint8Array(row.nonce), keyVersion: row.keyVersion }, codec.aad(ref))
  return decoder.decode(plain)
}
