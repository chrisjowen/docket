// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { audit, listAudit, type AuditEventInput, type Outcome } from '@docket/platform-audit'
import { ApiTokenError, issueApiToken, listApiTokens, mcpResourceUrl, revokeApiToken, revokeWorkspaceCredentials, TokenRevocationError } from '@docket/platform-auth'
import { hashContent, lockOntologyHead, WorkspaceError, workspaceSlugProblem, type StoreContext } from '@docket/platform-canonical-store'
import { perMinute, rateLimitMessage, type Limit } from '@docket/platform-limits'
import {
  createDraft, createWorkspace, headOf, importYaml, isTemplateId, OntologyBreakingChange, OntologyInvalid,
  OntologyNarrowingChange, parseDraft, publish, StaleDraft, template, TEMPLATE_IDS, type OntologyStart,
} from '@docket/platform-ontology-service'
import { databaseAccount, lookupMasterKey, type MasterKeyPrincipal, type Tx } from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'

import { bearerOf, credentialInUrl, refusedCredentials } from './bearer'
import { CliError, cliJson } from './cli-api'
import { clientAddress } from './request'
import { getRuntime, type Runtime } from './runtime'

/** Public org admin records deliberately use the wire format, including timestamps. */
interface Database {
  id: string
  slug: string
  name: string
  owner_ref: string | null
  created_at: Date
  deleted_at: Date | null
  created_by: string
  ontology_version: number | null
}

interface AdminCall {
  event: RequestEvent
  runtime: Runtime
  principal: MasterKeyPrincipal
  tx: Tx
  action: string
  workspaceId?: string
  target: string[]
  tenant<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T>
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function invalid(message: string): never { throw new CliError(400, 'invalid_request', message) }
const conflict = (): never => { throw new CliError(409, 'conflict', 'The owner reference, slug or ontology conflicts with an existing database.') }
const notFound = (): never => { throw new CliError(404, 'not_found', 'No such database or key.') }

async function json(event: RequestEvent): Promise<Record<string, unknown>> {
  if (!/^application\/json(\s*;|$)/i.test(event.request.headers.get('content-type') ?? '')) invalid('Send content-type: application/json.')
  let value: unknown
  try { value = await event.request.json() } catch { invalid('The body is not JSON.') }
  if (!object(value)) invalid('The body is a JSON object.')
  return value
}

/** Exactly one generic template or inline YAML. Comparison uses the stored, header-stripped text hash. */
export function adminOntology(value: unknown): { start: OntologyStart; yaml: string } {
  if (!object(value) || Object.keys(value).length !== 1) invalid('ontology has exactly one of template or inline_yaml.')
  if ('template' in value && isTemplateId(value.template)) {
    const yaml = template(value.template).yaml
    return { start: { template: value.template }, yaml }
  }
  if ('inline_yaml' in value && typeof value.inline_yaml === 'string') {
    const { yaml } = importYaml(value.inline_yaml)
    parseDraft(yaml)
    return { start: { importYaml: yaml }, yaml }
  }
  return invalid(`Use template ${TEMPLATE_IDS.slice(0, -1).join(', ')} or ${TEMPLATE_IDS.at(-1)}, or inline_yaml.`)
}

const databaseView = (row: Database) => ({
  id: row.id, slug: row.slug, name: row.name, owner_ref: row.owner_ref,
  status: row.deleted_at ? 'deleted' : 'active', created_at: row.created_at,
  deleted_at: row.deleted_at, ontology_version: row.ontology_version,
})

const DATABASE_SELECT = `SELECT w.*, (SELECT number FROM ontology_versions v
  WHERE v.workspace_id = w.id AND v.status = 'published' ORDER BY number DESC LIMIT 1) AS ontology_version FROM workspaces w`

async function database(call: AdminCall, slug: string, includeDeleted = false): Promise<Database> {
  const row = await call.tenant(async (ctx) => {
    const sql = `${DATABASE_SELECT} WHERE w.slug = $1${includeDeleted ? '' : ' AND w.deleted_at IS NULL'}`
    const first = (await ctx.tx.query<Database>(sql, [slug])).rows[0]
    if (!first) return undefined
    // Publish and document writes lock the ontology head before the workspace. Keep that order.
    await lockOntologyHead(ctx, first.id, 'update')
    return (await ctx.tx.query<Database>(`${sql} FOR UPDATE OF w`, [slug])).rows[0]
  })
  if (!row) return notFound()
  call.workspaceId = row.id
  call.target = [`database:${row.slug}`]
  return row
}

async function createDatabase(call: AdminCall): Promise<Response> {
  const body = await json(call.event)
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) invalid('name is 1-80 characters.')
  if (typeof body.owner_ref !== 'string' || !body.owner_ref.trim() || body.owner_ref.length > 512) invalid('owner_ref is a non-empty string of at most 512 characters.')
  if (body.slug !== undefined && (typeof body.slug !== 'string' || workspaceSlugProblem(body.slug))) invalid('slug must follow the workspace slug rules (2-40 lowercase letters, digits and single hyphens).')
  const ontology = body.ontology === undefined ? undefined : adminOntology(body.ontology)
  const name = body.name.trim()
  const ownerRef = body.owner_ref
  const askedSlug = body.slug as string | undefined
  return call.tenant(async (ctx) => {
    const { tx } = ctx
    // Same lock as insertWorkspace: idempotency, conflicts and the limit are checked in one serial order.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:workspace-create:' || current_schema()))")
    const { rows } = await tx.query<Database>(`${DATABASE_SELECT} WHERE w.owner_ref = $1 OR w.slug = $2`, [ownerRef, askedSlug ?? null])
    const existing = rows.find((row) => row.owner_ref === ownerRef)
    if (rows.some((row) => row.owner_ref !== ownerRef) || existing?.deleted_at) conflict()
    if (existing) {
      if (askedSlug !== undefined && askedSlug !== existing.slug) conflict()
      await lockOntologyHead(ctx, existing.id, 'update')
      const current = (await tx.query<Database>(`${DATABASE_SELECT} WHERE w.id = $1 FOR UPDATE OF w`, [existing.id])).rows[0]
      if (!current || current.deleted_at) conflict()
      const head = await headOf(tx, existing.id)
      if (ontology && (!head || head.yamlHash !== hashContent(ontology.yaml))) conflict()
      call.workspaceId = existing.id
      call.target = [`database:${existing.slug}`]
      return cliJson(200, databaseView({ ...existing, ontology_version: head?.number ?? null }))
    }
    if (!ontology) invalid('ontology is required for a new database.')
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28).replace(/-$/, '') || 'database'
    const slug = askedSlug ?? `${base}-${randomUUID().slice(0, 8)}`
    const { workspace, version } = await createWorkspace(ctx, {
      name, slug, start: ontology.start, maxWorkspaces: call.principal.databaseLimit,
      publisher: { actor: `token:${call.principal.id}`, login: 'org-admin' }, requestId: call.event.locals.requestId,
    })
    await tx.query('UPDATE workspaces SET owner_ref = $2 WHERE id = $1', [workspace.id, ownerRef])
    call.workspaceId = workspace.id
    call.target = [`database:${slug}`]
    return cliJson(201, databaseView({ id: workspace.id, slug, name: workspace.name, owner_ref: ownerRef, created_at: workspace.createdAt,
      created_by: workspace.createdBy, deleted_at: null, ontology_version: version.number }))
  })
}

async function listDatabases(call: AdminCall): Promise<Response> {
  const status = call.event.url.searchParams.get('status') ?? 'active'
  if (!['active', 'deleted', 'all'].includes(status)) invalid('status is active, deleted or all.')
  const rows = await call.tenant(async ({ tx }) => (await tx.query<Database>(`${DATABASE_SELECT}${status === 'all' ? '' : ` WHERE w.deleted_at IS ${status === 'deleted' ? 'NOT ' : ''}NULL`} ORDER BY w.created_at, w.id`)).rows)
  return cliJson(200, { databases: rows.map(databaseView) })
}

async function getDatabase(call: AdminCall, slug: string): Promise<Response> {
  const row = await database(call, slug)
  const head = await call.tenant(({ tx }) => headOf(tx, row.id))
  const { rows } = await call.tx.query<{ count: string }>(
    'SELECT count(*) FROM platform.api_tokens WHERE org_id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND expires_at > now()', [call.principal.orgId, row.id],
  )
  return cliJson(200, { ...databaseView(row), created_by: row.created_by, ontology: head ? { version: head.number, yaml: head.yaml, published_at: head.publishedAt } : null, key_count: Number(rows[0]?.count ?? 0) })
}

async function deleteDatabase(call: AdminCall, slug: string): Promise<Response> {
  const row = await database(call, slug, true)
  if (!row.deleted_at) {
    await revokeWorkspaceCredentials(call.tx, { orgId: call.principal.orgId, workspaceId: row.id,
      resource: mcpResourceUrl(call.runtime.origin, call.principal.orgSlug, slug), by: call.principal.adminId })
    await call.tenant(async ({ tx }) => {
      await tx.query('UPDATE workspaces SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [row.id, `token:${call.principal.id}`])
    })
  }
  return new Response(null, { status: 204 })
}

async function setOntology(call: AdminCall, slug: string): Promise<Response> {
  const body = await json(call.event)
  const ontology = adminOntology(body)
  const row = await database(call, slug)
  const published = await call.tenant(async (ctx) => {
    const draft = await createDraft(ctx.tx, row.id, { yaml: ontology.yaml, source: 'import', author: `token:${call.principal.id}` })
    const head = await headOf(ctx.tx, row.id)
    return publish(ctx, row.id, draft.id, { expectedHead: head?.number ?? 0,
      publisher: { actor: `token:${call.principal.id}`, login: 'org-admin' }, requestId: call.event.locals.requestId })
  })
  return cliJson(200, { version: published.number, published_at: published.publishedAt })
}

async function keys(call: AdminCall, slug: string, keyId?: string): Promise<Response> {
  const row = await database(call, slug)
  const { tx, principal } = call
  if (call.event.request.method === 'GET') {
    const records = await listApiTokens(tx, { orgId: principal.orgId, workspaceId: row.id, all: true })
    return cliJson(200, { keys: records.map((key) => ({ id: key.id, prefix: key.prefix, scopes: key.scopes, description: key.description,
      created_at: key.createdAt, expires_at: key.expiresAt, last_used_at: key.lastUsedAt, revoked_at: key.revokedAt })) })
  }
  if (keyId) {
    await revokeApiToken(tx, { orgId: principal.orgId, workspaceId: row.id, tokenId: keyId, by: principal.adminId })
    call.target.push(`key:${keyId}`)
    return new Response(null, { status: 204 })
  }
  // A master key reaches only the databases it made: one made in Docket Cloud has no owner_ref.
  if (row.owner_ref === null) throw new CliError(403, 'forbidden', 'This database was made in Docket Cloud, not through this API, so this API issues no keys for it.')
  const body = await json(call.event)
  const days = body.ttl_days ?? 90
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 90) invalid('ttl_days is a whole number from 1 to 90.')
  const scopes = body.scopes ?? ['docket:read', 'docket:write']
  if (!Array.isArray(scopes) || !scopes.length || !scopes.every((scope) => scope === 'docket:read' || scope === 'docket:write')) invalid('scopes is a non-empty subset of docket:read and docket:write.')
  if (body.description !== undefined && typeof body.description !== 'string') invalid('description is a string.')
  const now = new Date()
  // The key belongs to this database's account at its level, never to org-admin, which holds no grant.
  const ownerId = await databaseAccount(tx, { orgId: principal.orgId, workspaceId: row.id, permission: scopes.includes('docket:write') ? 'write' : 'read' })
  const issued = await issueApiToken(tx, { orgId: principal.orgId, workspaceId: row.id, ownerId, createdBy: principal.adminId,
    scopes, expiresInDays: days, description: body.description as string | undefined, now })
  call.target.push(`key:${issued.id}`)
  return cliJson(201, { id: issued.id, prefix: issued.prefix, key: issued.token, created_at: now, expires_at: issued.expiresAt })
}

async function usage(call: AdminCall): Promise<Response> {
  const tenant = await call.tenant(async ({ tx }) => {
    const { rows } = await tx.query<{ databases: string; calls_30d: string; storage_bytes: string }>(`SELECT
      (SELECT count(*) FROM workspaces) AS databases,
      (SELECT count(*) FROM audit_event WHERE at >= now() - interval '30 days') AS calls_30d,
      ((SELECT coalesce(sum(octet_length(raw_ciphertext) + octet_length(raw_nonce)), 0) FROM documents) +
       (SELECT coalesce(sum(octet_length(raw_ciphertext) + octet_length(raw_nonce)), 0) FROM document_revisions) +
       (SELECT coalesce(sum(octet_length(yaml)), 0) FROM ontology_versions)) AS storage_bytes`)
    return rows[0]
  })
  const { rows } = await call.tx.query<{ count: string }>('SELECT count(*) FROM platform.api_tokens WHERE org_id = $1 AND revoked_at IS NULL AND expires_at > now()', [call.principal.orgId])
  return cliJson(200, { databases: Number(tenant?.databases ?? 0), calls_30d: Number(tenant?.calls_30d ?? 0), storage_bytes: Number(tenant?.storage_bytes ?? 0),
    active_keys: Number(rows[0]?.count ?? 0), database_limit: call.principal.databaseLimit })
}

async function auditLog(call: AdminCall): Promise<Response> {
  const params = call.event.url.searchParams
  const entity = params.get('entity')
  if (entity !== null && entity !== 'database') invalid('entity is database.')
  const since = params.get('since')
  if (since !== null && !Number.isFinite(Date.parse(since))) invalid('since is an ISO timestamp.')
  const action = params.get('action')
  const slug = params.get('slug')
  const events = await call.tenant(async ({ tx }) => {
    const identities = slug === null ? [] : (await tx.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE slug = $1 UNION SELECT workspace_id AS id FROM workspace_deletions WHERE slug = $1', [slug],
    )).rows.map((row) => row.id)
    return listAudit(tx, {
      ...(action !== null ? { action } : {}), ...(since !== null ? { since: new Date(since) } : {}),
      ...(slug !== null ? { target: `database:${slug}`, workspaceIds: identities } : {}),
      ...(entity !== null ? { workspaceOnly: true } : {}),
    })
  })
  return cliJson(200, { events })
}

type AdminRoute = { action: string; run: (call: AdminCall) => Promise<Response> }
function routeOf(event: RequestEvent): AdminRoute {
  const path = event.params.path ?? ''
  const method = event.request.method
  if (path === 'databases' && method === 'POST') return { action: 'database.create', run: createDatabase }
  if (path === 'databases' && method === 'GET') return { action: 'database.list', run: listDatabases }
  if (path === 'usage' && method === 'GET') return { action: 'usage', run: usage }
  if (path === 'audit' && method === 'GET') return { action: 'audit', run: auditLog }
  const match = /^databases\/([^/]+)(?:\/(ontology|keys)(?:\/([^/]+))?)?$/.exec(path)
  if (match) {
    const slug = match[1] as string
    if (!match[2] && method === 'GET') return { action: 'database.get', run: (call) => getDatabase(call, slug) }
    if (!match[2] && method === 'DELETE') return { action: 'database.delete', run: (call) => deleteDatabase(call, slug) }
    if (match[2] === 'ontology' && !match[3] && method === 'PUT') return { action: 'ontology.replace', run: (call) => setOntology(call, slug) }
    if (match[2] === 'keys' && ((!match[3] && ['GET', 'POST'].includes(method)) || (match[3] && method === 'DELETE'))) {
      return { action: method === 'GET' ? 'key.list' : method === 'POST' ? 'key.issue' : 'key.revoke', run: (call) => keys(call, slug, match[3]) }
    }
  }
  return { action: 'unknown', run: async () => notFound() }
}

function errorOf(cause: unknown): CliError {
  if (cause instanceof CliError) return cause
  if (cause instanceof WorkspaceError) return new CliError(cause.code === 'limit' ? 403 : cause.code === 'conflict' ? 409 : cause.code === 'not-found' ? 404 : 400, cause.code.replace('not-found', 'not_found'), cause.message)
  if (cause instanceof ApiTokenError) return new CliError(cause.code === 'forbidden' ? 403 : 400, cause.code === 'forbidden' ? 'insufficient_scope' : 'invalid_request', cause.message)
  if (cause instanceof TokenRevocationError) return new CliError(404, 'not_found', 'No such live key.')
  if (cause instanceof OntologyInvalid) return new CliError(400, 'invalid_request', 'The ontology is not valid.')
  if (cause instanceof OntologyBreakingChange || cause instanceof OntologyNarrowingChange || cause instanceof StaleDraft) return new CliError(409, 'conflict', 'The ontology change fails the publish checks. Resolve it through the ontology editor.')
  return new CliError(500, 'server_error', 'The server failed to answer.')
}

function outcome(status: number): Outcome {
  return status < 400 ? 'ok' : status === 401 || status === 403 || status === 404 || status === 429 ? 'denied' : status < 500 ? 'invalid' : 'error'
}

/**
 * One platform transaction owns auth, platform credentials, tenant changes and the audit append.
 * The tenant callback temporarily drops privileges to the org role, then restores the request role.
 * Errors roll back all changes and are audited in a fresh transaction; no body or bearer is logged.
 * Refusals before authentication are limited per client address and recorded as platform bursts.
 */
export async function handleOrgAdmin(event: RequestEvent): Promise<Response> {
  const runtime = getRuntime()
  const route = routeOf(event)
  const recordRefused = refusedCredentials(event, runtime, `${runtime.origin}/api/admin/o/${event.params.org ?? ''}`)
  const state: { principal: MasterKeyPrincipal | null } = { principal: null }
  let workspaceId: string | undefined
  let target: string[] = []
  const fields = (principal: MasterKeyPrincipal, status: number): AuditEventInput => ({
    orgId: principal.orgId, actor: `token:${principal.id}`,
    action: `org.admin.${route.action}`, outcome: outcome(status), ...(workspaceId ? { workspaceId } : {}), target,
    requestId: event.locals.requestId, latencyMs: performance.now() - event.locals.startedAt,
    ip: clientAddress(event), userAgent: event.request.headers.get('user-agent'),
  })
  let response: Response
  const blocked = runtime.refusedAuth.check(clientAddress(event) ?? 'unknown')
  if (!blocked.ok) {
    response = cliJson(429, { error: 'rate_limited', error_description: 'Too many refused credentials from this address; try again later.' }, { 'retry-after': String(blocked.retryAfterSeconds) })
  } else {
    try {
      if (credentialInUrl(event.url)) invalid('Send credentials only in the Authorization header.')
      response = await runtime.router.withPlatform(async (tx) => {
        const bearer = bearerOf(event.request)
        const found = bearer ? await lookupMasterKey(tx, bearer) : null
        if (!found || found.orgSlug !== event.params.org) throw new CliError(401, 'invalid_token', 'This master key is not valid for this organisation.')
        state.principal = found
        const limits: Limit[] = [{ scope: 'master key', key: `org-admin:${found.id}`, rule: perMinute(60) }]
        if (route.action === 'key.issue') limits.push({ scope: 'master key', what: 'new keys', key: `org-admin-key-create:${found.id}`, rule: perMinute(10) })
        const decision = await runtime.limiter.check(limits)
        if (!decision.allowed) {
          const limited = cliJson(429, { error: 'rate_limited', error_description: rateLimitMessage(decision) }, { 'retry-after': String(decision.retryAfterSeconds) })
          await runtime.router.enterTenant(tx, found.orgId)
          await audit(tx, fields(found, 429))
          return limited
        }
        const call: AdminCall = {
          event, runtime, principal: found, tx, action: route.action, target: [],
          async tenant(fn) {
            const keys = await runtime.keyring.forOrg(found.orgId)
            await runtime.router.enterTenant(tx, found.orgId)
            try { return await fn({ tx, keys }) } finally {
              await tx.query('SET LOCAL ROLE NONE')
              await tx.query('SET LOCAL search_path = platform')
            }
          },
        }
        let result: Response
        try { result = await route.run(call) } finally {
          workspaceId = call.workspaceId
          target = call.target
        }
        await tx.query('UPDATE platform.org_master_keys SET last_used_at = now() WHERE id = $1', [found.id])
        await runtime.router.enterTenant(tx, found.orgId)
        await audit(tx, fields(found, result.status))
        return result
      })
    } catch (cause) {
      const error = errorOf(cause)
      // Avoid printing exception text: drivers and parsers can include caller content or credentials.
      if (error.status === 500) console.error(`[${event.locals.requestId}] org admin request failed`)
      response = cliJson(error.status, { error: error.code, error_description: error.message }, error.status === 401 ? { 'www-authenticate': 'Bearer error="invalid_token"' } : {})
      const principal = state.principal
      if (principal) await runtime.router.withTenant(principal.orgId, (tx) => audit(tx, fields(principal, error.status)))
      else await recordRefused('org.admin.auth', outcome(error.status))
    }
  }
  response.headers.set('x-request-id', event.locals.requestId)
  response.headers.set('cache-control', 'no-store')
  if (response.status !== 204) {
    const body = await response.json()
    response = cliJson(response.status, { ...body, request_id: event.locals.requestId }, Object.fromEntries(response.headers))
  }
  event.locals.audited = true
  return response
}
