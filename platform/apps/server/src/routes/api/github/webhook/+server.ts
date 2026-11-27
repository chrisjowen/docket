// SPDX-License-Identifier: AGPL-3.0-only
import { env } from '$env/dynamic/private'
import { audit } from '@docket/platform-audit'
import { receiveWebhook } from '@docket/platform-github'
import { json } from '@sveltejs/kit'

import { auditInput, recordStandalone } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

/**
 * GitHub's webhook deliveries for the Docket Cloud App (§14.1): `push`
 * queues a sync of each connection tracking the branch; `installation` and
 * `installation_repositories` keep installations and routes current. A
 * delivery is authenticated by its `X-Hub-Signature-256` alone: the body,
 * up to GitHub's 25 MB cap, is read first, and refused with 401 when the
 * signature does not verify. Each one writes an
 * audit event as `system:github`, in the platform log, with its delivery id.
 */
export const POST: RequestHandler = async (event) => {
  const { router, webhookSecret } = getRuntime()
  const headers = event.request.headers
  const deliveryId = headers.get('x-github-delivery')
  const action = `github.webhook ${headers.get('x-github-event') ?? 'unknown'}`
  if (!webhookSecret) {
    await recordStandalone(event, { action, outcome: 'error', orgId: null, target: ['unconfigured'] })
    return json({ message: 'Repo sync is not configured.' }, { status: 503 })
  }
  const response = await receiveWebhook({
    secret: webhookSecret,
    delivery: {
      event: headers.get('x-github-event'),
      deliveryId,
      signature: headers.get('x-hub-signature-256'),
      body: new Uint8Array(await event.request.arrayBuffer()),
    },
    withPlatform: (fn) => router.withPlatform(fn),
    // A burst of pushes is one sync; 10 s unless a local preview shortens it.
    ...(env.DOCKET_PUSH_DEBOUNCE_MS ? { debounceMs: Number(env.DOCKET_PUSH_DEBOUNCE_MS) } : {}),
    async record(tx, result) {
      await audit(tx, {
        ...auditInput(event, { action, outcome: 'ok', orgId: null }),
        actor: 'system:github',
        target: [`delivery:${deliveryId ?? 'none'}`, ...result.orgIds.map((orgId) => `org:${orgId}`)],
        args: { status: result.status, reason: result.reason, jobs: result.jobs.length },
      })
      event.locals.audited = true
    },
  })
  if (response.status === 401 || response.status === 400) {
    await recordStandalone(event, {
      action,
      outcome: response.status === 401 ? 'denied' : 'invalid',
      orgId: null,
      target: [`delivery:${deliveryId ?? 'none'}`],
    })
  }
  return json({ message: response.message }, { status: response.status })
}
