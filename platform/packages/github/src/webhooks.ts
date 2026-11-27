// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from 'node:crypto'

import type { Tx } from '@docket/platform-tenancy'

/**
 * GitHub webhooks (§14.1): `push` queues a sync of every connection that
 * tracks the pushed branch, and `installation` / `installation_repositories`
 * keep the installations and routes current. Every function runs inside a
 * `withPlatform` transaction: a delivery names no org, so it is routed through
 * `platform.repo_routes`, and only the worker enters an org.
 */

/** Pushes to one connection within this window are one sync. */
export const PUSH_DEBOUNCE_MS = 10_000

/** Checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw body under the webhook secret), in constant time. */
export function verifySignature(secret: string, body: string | Uint8Array, header: string | null | undefined): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false
  const given = Buffer.from(header.slice('sha256='.length), 'hex')
  const expected = createHmac('sha256', secret).update(body).digest()
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export type RepoJobKind = 'sync' | 'export'

export interface EnqueueInput {
  orgId: string
  connectionId: string
  kind: RepoJobKind
  /** Every file, not only changed blobs: the initial import and "Resync now". */
  full?: boolean
  /** `github:push`, `user:<id>`. */
  requestedBy: string
  /** How long the job waits for more pushes to join it. */
  delayMs?: number
}

/**
 * Queues a job, or joins the one already waiting for the connection: it
 * runs no later than either asked, and becomes full if either was. A job
 * syncs the branch head when it runs, never the commit a delivery named, so
 * deliveries out of order cannot take a connection back to an older commit.
 * The worker is woken on commit (`docket_repo_jobs`).
 */
export async function enqueueRepoJob(tx: Tx, input: EnqueueInput): Promise<{ id: number; joined: boolean }> {
  const { rows } = await tx.query<{ id: string; joined: boolean }>(
    `INSERT INTO platform.repo_jobs (org_id, connection_id, kind, full_sync, requested_by, run_after)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6::double precision / 1000))
     ON CONFLICT (connection_id, kind) WHERE started_at IS NULL DO UPDATE
        SET full_sync = platform.repo_jobs.full_sync OR excluded.full_sync,
            run_after = LEAST(platform.repo_jobs.run_after, excluded.run_after),
            requests = platform.repo_jobs.requests + 1
     RETURNING id, (xmax <> 0) AS joined`,
    [input.orgId, input.connectionId, input.kind, input.full ?? false, input.requestedBy, input.delayMs ?? 0],
  )
  await tx.query("SELECT pg_notify('docket_repo_jobs', $1)", [input.orgId])
  const row = rows[0] as { id: string; joined: boolean }
  return { id: Number(row.id), joined: row.joined }
}

export interface WebhookResult {
  /** `queued`: sync jobs were queued or joined; `recorded`: installation state changed; `ignored`: nothing to do. */
  status: 'queued' | 'recorded' | 'ignored'
  reason: string
  /** The orgs the delivery touched. */
  orgIds: string[]
  jobs: { orgId: string; connectionId: string; jobId: number; joined: boolean }[]
}

type PushPayload = {
  ref?: unknown
  deleted?: unknown
  repository?: { id?: unknown; full_name?: unknown }
  installation?: { id?: unknown }
}

type InstallationPayload = {
  action?: unknown
  installation?: { id?: unknown }
  repositories_added?: { id?: unknown }[]
  repositories_removed?: { id?: unknown }[]
}

const ignored = (reason: string): WebhookResult => ({ status: 'ignored', reason, orgIds: [], jobs: [] })
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

async function handlePush(tx: Tx, payload: PushPayload, debounceMs: number): Promise<WebhookResult> {
  const ref = typeof payload.ref === 'string' ? payload.ref : ''
  if (!ref.startsWith('refs/heads/')) return ignored(`not a branch: ${ref || 'no ref'}`)
  if (payload.deleted === true) return ignored(`branch deleted: ${ref}`)
  const installationId = payload.installation?.id
  const repoId = payload.repository?.id
  if (!isId(installationId) || !isId(repoId)) return ignored('push without an installation or repository id')
  const branch = ref.slice('refs/heads/'.length)
  const { rows } = await tx.query<{ connection_id: string; org_id: string }>(
    `SELECT r.connection_id, r.org_id FROM platform.repo_routes r
       JOIN platform.github_installations i ON i.installation_id = r.installation_id
       JOIN platform.orgs o ON o.id = r.org_id
      WHERE r.installation_id = $1 AND r.repo_id = $2 AND r.branch = $3 AND r.removed_at IS NULL
        AND i.deleted_at IS NULL AND i.suspended_at IS NULL AND o.status = 'active'
      ORDER BY r.connection_id`,
    [installationId, repoId, branch],
  )
  const repo = typeof payload.repository?.full_name === 'string' ? payload.repository.full_name : `repo ${repoId}`
  if (!rows.length) return ignored(`no connection tracks ${repo}@${branch}`)
  const jobs: WebhookResult['jobs'] = []
  for (const row of rows) {
    const job = await enqueueRepoJob(tx, {
      orgId: row.org_id,
      connectionId: row.connection_id,
      kind: 'sync',
      requestedBy: 'github:push',
      delayMs: debounceMs,
    })
    jobs.push({ orgId: row.org_id, connectionId: row.connection_id, jobId: job.id, joined: job.joined })
  }
  return {
    status: 'queued',
    reason: `push to ${repo}@${branch}`,
    orgIds: [...new Set(rows.map((row) => row.org_id))],
    jobs,
  }
}

async function orgsOf(tx: Tx, installationId: number): Promise<string[]> {
  const { rows } = await tx.query<{ org_id: string }>(
    'SELECT org_id FROM platform.github_installations WHERE installation_id = $1',
    [installationId],
  )
  return rows.map((row) => row.org_id)
}

async function handleInstallation(tx: Tx, payload: InstallationPayload): Promise<WebhookResult> {
  const installationId = payload.installation?.id
  if (!isId(installationId)) return ignored('installation event without an id')
  const action = typeof payload.action === 'string' ? payload.action : ''
  const updates: Record<string, string> = {
    deleted: 'deleted_at = now()',
    suspend: 'suspended_at = now()',
    unsuspend: 'suspended_at = NULL',
  }
  const update = updates[action]
  if (!update) return ignored(`installation ${action || 'event'}`)
  const { rowCount } = await tx.query(
    `UPDATE platform.github_installations SET ${update} WHERE installation_id = $1`,
    [installationId],
  )
  if (!rowCount) return ignored(`installation ${installationId} is not linked to an org`)
  return { status: 'recorded', reason: `installation ${action}`, orgIds: await orgsOf(tx, installationId), jobs: [] }
}

async function handleInstallationRepositories(tx: Tx, payload: InstallationPayload): Promise<WebhookResult> {
  const installationId = payload.installation?.id
  if (!isId(installationId)) return ignored('installation_repositories event without an id')
  const ids = (list: { id?: unknown }[] | undefined) => (list ?? []).map((repo) => repo.id).filter(isId)
  const removed = ids(payload.repositories_removed)
  const added = ids(payload.repositories_added)
  let changed = 0
  if (removed.length) {
    const result = await tx.query(
      'UPDATE platform.repo_routes SET removed_at = now() WHERE installation_id = $1 AND repo_id = ANY($2) AND removed_at IS NULL',
      [installationId, removed],
    )
    changed += result.rowCount ?? 0
  }
  if (added.length) {
    const result = await tx.query(
      'UPDATE platform.repo_routes SET removed_at = NULL WHERE installation_id = $1 AND repo_id = ANY($2) AND removed_at IS NOT NULL',
      [installationId, added],
    )
    changed += result.rowCount ?? 0
  }
  if (!changed) return ignored('no connected repo changed access')
  return { status: 'recorded', reason: `${changed} connection(s) changed access`, orgIds: await orgsOf(tx, installationId), jobs: [] }
}

/** Acts on one verified delivery. Unknown events are ignored, so subscribing to more never breaks anything. */
export async function handleWebhook(
  tx: Tx,
  input: { event: string; payload: unknown; debounceMs?: number },
): Promise<WebhookResult> {
  const payload = (input.payload && typeof input.payload === 'object' ? input.payload : {}) as Record<string, unknown>
  switch (input.event) {
    case 'ping':
      return ignored('ping')
    case 'push':
      return handlePush(tx, payload as PushPayload, input.debounceMs ?? PUSH_DEBOUNCE_MS)
    case 'installation':
      return handleInstallation(tx, payload as InstallationPayload)
    case 'installation_repositories':
      return handleInstallationRepositories(tx, payload as InstallationPayload)
    default:
      return ignored(`event ${input.event || 'unnamed'} is not handled`)
  }
}

/** One webhook request as it arrived: its GitHub headers and raw body. */
export interface WebhookDelivery {
  /** `X-GitHub-Event`. */
  event: string | null
  /** `X-GitHub-Delivery`. */
  deliveryId: string | null
  /** `X-Hub-Signature-256`. */
  signature: string | null
  body: Uint8Array
}

export interface WebhookResponse {
  status: 202 | 200 | 400 | 401
  message: string
  result?: WebhookResult
}

/**
 * The webhook endpoint's whole job, apart from HTTP: refuse a delivery whose
 * signature does not verify (401) before reading it, then handle it in one
 * platform transaction, in which `record` writes its audit event (§10).
 */
export async function receiveWebhook(options: {
  secret: string
  delivery: WebhookDelivery
  withPlatform: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
  record?: (tx: Tx, result: WebhookResult) => Promise<void>
  debounceMs?: number
}): Promise<WebhookResponse> {
  const { delivery } = options
  if (!verifySignature(options.secret, delivery.body, delivery.signature)) {
    return { status: 401, message: 'The signature does not match.' }
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(delivery.body).toString('utf8'))
  } catch {
    return { status: 400, message: 'The body is not JSON.' }
  }
  const result = await options.withPlatform(async (tx) => {
    const handled = await handleWebhook(tx, {
      event: delivery.event ?? '',
      payload,
      ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    })
    await options.record?.(tx, handled)
    return handled
  })
  return { status: result.status === 'queued' ? 202 : 200, message: result.reason, result }
}
