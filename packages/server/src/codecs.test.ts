import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { CodecError, defaultAad, localKeyCodec, plaintextCodec } from './codecs.js'

const text = new TextEncoder().encode('---\nid: service.orders\n---\n')
const ref = { workspaceId: 'ws1', documentId: 'doc-1', revision: 2 }

describe('the codecs a self-hosted server stores bodies with', () => {
  it('binds a body to its workspace, document and revision', () => {
    expect(defaultAad(ref)).toBe('ws1|doc-1|2')
    expect(plaintextCodec().aad(ref)).toBe('ws1|doc-1|2')
  })

  it('stores plaintext as it is, with no nonce and no key version', async () => {
    const codec = plaintextCodec()
    const sealed = await codec.seal(text, codec.aad(ref))
    expect(sealed).toEqual({ ciphertext: text, nonce: new Uint8Array(0) })
    expect(await codec.open(sealed, codec.aad(ref))).toEqual(text)
  })

  it('seals with a local key that opens only with the same key, associated data and key version', async () => {
    const key = randomBytes(32)
    const codec = localKeyCodec({ key, keyVersion: 2 })
    const sealed = await codec.seal(text, codec.aad(ref))
    expect(sealed.keyVersion).toBe(2)
    expect(sealed.nonce).toHaveLength(12)
    expect(Buffer.from(sealed.ciphertext).toString('utf8')).not.toContain('service.orders')
    expect(await codec.open(sealed, codec.aad(ref))).toEqual(text)
    // A fresh nonce every time.
    expect((await codec.seal(text, codec.aad(ref))).nonce).not.toEqual(sealed.nonce)

    await expect(codec.open(sealed, codec.aad({ ...ref, revision: 3 }))).rejects.toThrow(/does not open/)
    await expect(localKeyCodec({ key: randomBytes(32), keyVersion: 2 }).open(sealed, codec.aad(ref))).rejects.toBeInstanceOf(CodecError)
    await expect(codec.open({ ...sealed, keyVersion: 1 }, codec.aad(ref))).rejects.toThrow(/key version 1/)
    await expect(codec.open({ ...sealed, nonce: new Uint8Array(4) }, codec.aad(ref))).rejects.toThrow(/nonce/)
  })

  it('keeps a deployment’s own associated data, and refuses a key that is not 32 bytes', async () => {
    const codec = localKeyCodec({ key: randomBytes(32), aad: (at) => `org|${defaultAad(at)}` })
    expect(codec.aad(ref)).toBe('org|ws1|doc-1|2')
    expect((await codec.seal(text, codec.aad(ref))).keyVersion).toBe(1)
    expect(() => localKeyCodec({ key: randomBytes(16) })).toThrow(/32 bytes/)
  })
})
