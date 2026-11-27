// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomInt } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { verifySignature, type WebhookDelivery } from './webhooks.js'

const SECRET = 'webhook-secret-for-tests'

function delivery(event: string, payload: unknown, secret = SECRET): WebhookDelivery {
  const body = Buffer.from(JSON.stringify(payload))
  return {
    event,
    deliveryId: String(randomInt(1, 2 ** 31)),
    signature: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    body,
  }
}

describe('verifySignature', () => {
  it('accepts the HMAC of the exact body and nothing else', () => {
    const { body, signature } = delivery('ping', { zen: 'hi' })
    expect(verifySignature(SECRET, body, signature)).toBe(true)
    expect(verifySignature(SECRET, Buffer.concat([body, Buffer.from(' ')]), signature)).toBe(false)
    expect(verifySignature('another-secret', body, signature)).toBe(false)
    expect(verifySignature(SECRET, body, signature?.replace('sha256=', 'sha1='))).toBe(false)
    expect(verifySignature(SECRET, body, 'sha256=00')).toBe(false)
    expect(verifySignature('', body, signature)).toBe(false)
    expect(verifySignature(SECRET, body, null)).toBe(false)
  })
})
