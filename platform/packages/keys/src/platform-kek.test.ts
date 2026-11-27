// SPDX-License-Identifier: AGPL-3.0-only
import { webcrypto } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { KekError, parseKek, platformKeyService } from './platform-kek.js'

const kek = () => webcrypto.getRandomValues(new Uint8Array(32))

describe('parseKek', () => {
  it('accepts 32 bytes of base64 with a trailing newline', () => {
    const bytes = kek()
    expect(parseKek(`${Buffer.from(bytes).toString('base64')}\n`)).toEqual(bytes)
  })

  it('refuses a key of the wrong length', () => {
    expect(() => parseKek(Buffer.alloc(16).toString('base64'))).toThrow(KekError)
  })

  it('refuses text that is not base64', () => {
    expect(() => parseKek('not a key!')).toThrow(KekError)
  })
})

describe('platformKeyService', () => {
  it('unwraps the data key it wrapped, for the same org', async () => {
    const keys = await platformKeyService({ kek: kek(), kekId: 'platform-v1' })
    const { wrapped, kekId } = await keys.wrapNewKey('org_a')
    const dek = await keys.unwrap('org_a', wrapped, kekId)

    const iv = webcrypto.getRandomValues(new Uint8Array(12))
    const sealed = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, new TextEncoder().encode('hi'))
    const opened = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, sealed)
    expect(new TextDecoder().decode(opened)).toBe('hi')
    expect(dek.extractable).toBe(false)
  })

  it("refuses to unwrap one org's key as another org's", async () => {
    const keys = await platformKeyService({ kek: kek(), kekId: 'platform-v1' })
    const { wrapped, kekId } = await keys.wrapNewKey('org_a')
    await expect(keys.unwrap('org_b', wrapped, kekId)).rejects.toThrow(KekError)
  })

  it('refuses a key wrapped under a different KEK', async () => {
    const a = await platformKeyService({ kek: kek(), kekId: 'platform-v1' })
    const b = await platformKeyService({ kek: kek(), kekId: 'platform-v1' })
    const { wrapped, kekId } = await a.wrapNewKey('org_a')
    await expect(b.unwrap('org_a', wrapped, kekId)).rejects.toThrow(KekError)
    await expect(a.unwrap('org_a', wrapped, 'platform-v2')).rejects.toThrow(KekError)
  })

  it('wraps a fresh key every time', async () => {
    const keys = await platformKeyService({ kek: kek(), kekId: 'platform-v1' })
    const first = await keys.wrapNewKey('org_a')
    const second = await keys.wrapNewKey('org_a')
    expect(first.wrapped).not.toEqual(second.wrapped)
  })
})

describe('KEK rotation', () => {
  it('unwraps keys under another KEK and rewraps them under the current one, keeping the data key', async () => {
    const v1 = { kek: kek(), kekId: 'platform-v1' }
    const before = await platformKeyService(v1)
    const { wrapped, kekId } = await before.wrapNewKey('org_a')
    const iv = webcrypto.getRandomValues(new Uint8Array(12))
    const sealed = await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await before.unwrap('org_a', wrapped, kekId),
      new TextEncoder().encode('kept'),
    )

    const during = await platformKeyService({ kek: kek(), kekId: 'platform-v2', others: [v1] })
    expect(during.otherKekIds).toEqual(['platform-v1'])
    await expect(during.unwrap('org_a', wrapped, 'platform-v1')).resolves.toBeDefined()
    const moved = await during.rewrap('org_a', wrapped, 'platform-v1')
    expect(moved.kekId).toBe('platform-v2')
    expect((await during.wrapNewKey('org_b')).kekId).toBe('platform-v2')
    await expect(during.rewrap('org_b', wrapped, 'platform-v1')).rejects.toThrow(KekError)

    const opened = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, await during.unwrap('org_a', moved.wrapped, moved.kekId), sealed)
    expect(new TextDecoder().decode(opened)).toBe('kept')
    await expect(before.unwrap('org_a', moved.wrapped, moved.kekId)).rejects.toThrow(KekError)
  })

  it('refuses another KEK with the current id', async () => {
    await expect(
      platformKeyService({ kek: kek(), kekId: 'platform-v1', others: [{ kek: kek(), kekId: 'platform-v1' }] }),
    ).rejects.toThrow(KekError)
  })
})
