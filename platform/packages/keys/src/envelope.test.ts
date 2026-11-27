// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { dekCache } from './dek-cache.js'
import { EnvelopeError, decrypt, decryptText, encrypt } from './envelope.js'
import { KekError, platformKeyService } from './platform-kek.js'

const randomKek = () => webcrypto.getRandomValues(new Uint8Array(32))
const aad = 'org1|ws1|doc1|1'

async function orgKey() {
  const keys = await platformKeyService({ kek: randomKek(), kekId: 'k1' })
  const { wrapped, kekId } = await keys.wrapNewKey('org1')
  return keys.unwrap('org1', wrapped, kekId)
}

describe('envelope encryption', () => {
  it('round-trips a document', async () => {
    const key = await orgKey()
    const sealed = await encrypt(key, '---\nid: service.orders\n---\nbody', aad)
    expect(await decryptText(key, sealed, aad)).toBe('---\nid: service.orders\n---\nbody')
    expect(sealed.nonce).toHaveLength(12)
  })

  it('refuses to decrypt with the wrong associated data', async () => {
    const key = await orgKey()
    const sealed = await encrypt(key, 'secret', aad)
    await expect(decrypt(key, sealed, 'org1|ws1|doc2|1')).rejects.toThrow(EnvelopeError)
    await expect(decrypt(key, sealed, 'org1|ws1|doc1|2')).rejects.toThrow(EnvelopeError)
  })

  it('refuses to decrypt with another org key', async () => {
    const sealed = await encrypt(await orgKey(), 'secret', aad)
    await expect(decrypt(await orgKey(), sealed, aad)).rejects.toThrow(EnvelopeError)
  })

  it('uses a different nonce for two encryptions of one plaintext', async () => {
    const key = await orgKey()
    const first = await encrypt(key, 'same', aad)
    const second = await encrypt(key, 'same', aad)
    expect(first.nonce).not.toEqual(second.nonce)
    expect(first.ciphertext).not.toEqual(second.ciphertext)
  })

  it('unwraps a DEK wrapped under KEK k1 only with k1', async () => {
    const k1 = randomKek()
    const underK1 = await platformKeyService({ kek: k1, kekId: 'k1' })
    const sameK1 = await platformKeyService({ kek: k1, kekId: 'k1' })
    const otherKek = await platformKeyService({ kek: randomKek(), kekId: 'k1' })
    const named2 = await platformKeyService({ kek: k1, kekId: 'k2' })

    const { wrapped, kekId } = await underK1.wrapNewKey('org1')
    const dek = await sameK1.unwrap('org1', wrapped, kekId)
    const sealed = await encrypt(dek, 'hello', aad)
    expect(await decryptText(await underK1.unwrap('org1', wrapped, kekId), sealed, aad)).toBe('hello')

    await expect(otherKek.unwrap('org1', wrapped, kekId)).rejects.toThrow(KekError)
    await expect(named2.unwrap('org1', wrapped, kekId)).rejects.toThrow(KekError)
  })
})

describe('dekCache', () => {
  it('unwraps once per TTL and again after it', async () => {
    let clock = 0
    let loads = 0
    const key = await orgKey()
    const cache = dekCache({
      load: async () => {
        loads += 1
        return key
      },
      ttlMs: 1000,
      now: () => clock,
    })
    await cache.get('org1', 1)
    await cache.get('org1', 1)
    expect(loads).toBe(1)
    clock = 1000
    await cache.get('org1', 1)
    expect(loads).toBe(2)
    cache.forget('org1')
    await cache.get('org1', 1)
    expect(loads).toBe(3)
  })

  it('does not keep a failed load', async () => {
    let fail = true
    const key = await orgKey()
    const cache = dekCache({
      load: async () => {
        if (fail) throw new Error('no key')
        return key
      },
    })
    await expect(cache.get('org1', 1)).rejects.toThrow('no key')
    fail = false
    await expect(cache.get('org1', 1)).resolves.toBe(key)
  })
})
