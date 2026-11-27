// SPDX-License-Identifier: AGPL-3.0-only
import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'

import { AiCapReached, OPENROUTER_API, PRIVACY_ROUTING, actorMonthSpend, modelChoices, monthOf, recordUsage, type AiDeps, type UsageRecord } from '@docket/platform-ai'
import { cogneeAiActor } from '@docket/platform-canonical-store'
import type { TenantRouter } from '@docket/platform-tenancy'

import { currentLease, type CognifyLease } from './cognify-lease.js'
import type { Logger } from './outbox.js'

/**
 * The cognify gateway: the OpenAI-compatible chat endpoint the cognee service
 * is configured to call its model through (`LLM_PROVIDER=custom`), so that
 * cognify - the one cognee step that runs a model - spends only what the org
 * may. Each call is counted to the workspace holding the cognify lease
 * (`cognify-lease.ts`), refused at the org's cap or the workspace's cognee
 * limit, sent to OpenRouter on the platform's own key (`OPENROUTER_API_KEY`,
 * never an org's) with the privacy routing every call asks for and the org's
 * small model, and metered like any other call (purpose `cognify`). With no
 * lease held, cognee has no reason to call a model, and the call is refused.
 * Bodies are never logged.
 */
export const GATEWAY_PATHS = ['/v1/chat/completions', '/chat/completions'] as const
const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface GatewayDeps {
  /** The shared key cognee sends as its `LLM_API_KEY`. */
  key: string
  lease(): Promise<CognifyLease | null>
  /** The org's metered, capped AI on the platform's key; null when AI is off or the platform has no key of its own. */
  ai: {
    assertWithinCap(orgId: string): Promise<void>
    spent(orgId: string, actor: string): Promise<number>
    /** The platform's OpenRouter key, which every cognee model call goes on. */
    apiKey: string
    /** The org's small model, the one Cypher and enrichment use. */
    model(orgId: string): Promise<string>
    record(usage: UsageRecord): Promise<void>
  } | null
  fetch?: typeof fetch
  apiBase?: string
  appUrl?: string
  timeoutMs?: number
}

export interface GatewayReply {
  status: number
  body: string
}

const refuse = (status: number, message: string): GatewayReply => ({ status, body: JSON.stringify({ error: { message, type: 'docket_cognify_gateway' } }) })

const authorised = (header: string | undefined, key: string) => {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(key)
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected)
}

type Completion = { id?: string; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } }

/** One call through the gateway, as the HTTP server hands it over. */
export async function gatewayCall(deps: GatewayDeps, call: { method: string; path: string; authorization: string | undefined; body: string }): Promise<GatewayReply> {
  if (call.method !== 'POST' || !(GATEWAY_PATHS as readonly string[]).includes(call.path)) return refuse(404, 'Not found.')
  if (!authorised(call.authorization, deps.key)) return refuse(401, 'Not authorised.')
  const lease = await deps.lease()
  if (!lease) return refuse(403, 'No cognify is running: cognee calls its model only while the worker cognifies a workspace.')
  const { ai } = deps
  if (!ai) return refuse(503, "AI is not set up on this server: cognee's model calls go on the platform's OpenRouter key, OPENROUTER_API_KEY, which is not configured.")
  try {
    await ai.assertWithinCap(lease.orgId)
  } catch (cause) {
    if (cause instanceof AiCapReached) return refuse(429, cause.message)
    throw cause
  }
  const actor = cogneeAiActor(lease.workspaceId)
  if ((await ai.spent(lease.orgId, actor)) >= lease.monthlyLimitUsd) {
    return refuse(429, `cognee's monthly AI limit of $${lease.monthlyLimitUsd.toFixed(2)} for this workspace is spent.`)
  }
  let request: Record<string, unknown>
  try {
    const parsed = JSON.parse(call.body) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse(400, 'Send one JSON object.')
    request = parsed as Record<string, unknown>
  } catch {
    return refuse(400, 'Send one JSON object.')
  }
  const model = await ai.model(lease.orgId)
  // Whatever model cognee names, the org's own is used, on the platform's key, never streamed so every call is metered.
  const forwarded = { ...request, model, stream: false, provider: PRIVACY_ROUTING, usage: { include: true } }
  const response = await (deps.fetch ?? fetch)(`${(deps.apiBase ?? OPENROUTER_API).replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ai.apiKey}`,
      'content-type': 'application/json',
      ...(deps.appUrl ? { 'http-referer': deps.appUrl, 'x-title': 'Docket Cloud' } : {}),
    },
    body: JSON.stringify(forwarded),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 300_000),
  })
  const text = await response.text()
  let completion: Completion | null = null
  try {
    completion = text ? (JSON.parse(text) as Completion) : null
  } catch {
    completion = null
  }
  if (!response.ok || !completion || completion.error) {
    // OpenRouter's own message, never the request: it holds customer content.
    return refuse(response.ok ? 502 : response.status, `OpenRouter: ${completion?.error?.message ?? response.statusText}`)
  }
  await ai.record({
    orgId: lease.orgId,
    workspaceId: lease.workspaceId,
    actor,
    purpose: 'cognify',
    model: completion.model ?? model,
    generationId: completion.id ?? null,
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
    costUsd: completion.usage?.cost ?? 0,
  })
  return { status: 200, body: text }
}

/** The gateway's dependencies over Postgres, the org's AI caps and the platform's OpenRouter key. */
export function gatewayDeps(
  router: TenantRouter,
  ai: AiDeps | null,
  key: string,
  options: { platformKey: string | undefined; appUrl?: string | undefined; now?: () => Date },
): GatewayDeps {
  const now = options.now ?? (() => new Date())
  const { platformKey } = options
  return {
    key,
    lease: () => router.withPlatform((tx) => currentLease(tx)),
    ai: ai && platformKey ? {
      assertWithinCap: (orgId) => ai.caps.assertWithinCap(orgId),
      spent: (orgId, actor) => router.withPlatform((tx) => actorMonthSpend(tx, orgId, actor, monthOf(now()))),
      apiKey: platformKey,
      model: async (orgId) => (await router.withPlatform((tx) => modelChoices(tx, orgId))).cypher,
      record: (usage) => router.withPlatform((tx) => recordUsage(tx, usage)),
    } : null,
    ...(options.appUrl ? { appUrl: options.appUrl } : {}),
  }
}

/**
 * Serves the gateway: HTTPS with the internal CA's certificate in the
 * cluster, admitted only from the cognee pod; plain HTTP on loopback only,
 * and never in production.
 */
export function startGatewayServer(options: {
  deps: GatewayDeps
  port: number
  host: string
  tls: { certFile: string; keyFile: string } | null
  production: boolean
  log: Logger
}): Server {
  if (!options.tls && (options.production || !['127.0.0.1', '::1', 'localhost'].includes(options.host))) {
    throw new Error('the cognify gateway needs DOCKET_QUERY_TLS_CERT and DOCKET_QUERY_TLS_KEY outside a loopback preview')
  }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > MAX_BODY_BYTES) {
          const reply = refuse(413, 'The request is too large.')
          res.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body)
          return
        }
        chunks.push(chunk as Buffer)
      }
      const reply = await gatewayCall(options.deps, {
        method: req.method ?? '',
        path: (req.url ?? '').split('?')[0] ?? '',
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body)
    } catch (cause) {
      options.log.error(`cognify gateway: ${cause instanceof Error ? cause.message : String(cause)}`)
      const reply = refuse(502, 'The cognify gateway failed to answer.')
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body)
    }
  }
  const listener = (req: IncomingMessage, res: ServerResponse) => void handle(req, res)
  const tls = options.tls
  const server = tls ? createHttpsServer({ cert: readFileSync(tls.certFile), key: readFileSync(tls.keyFile), minVersion: 'TLSv1.2' }, listener) : createHttpServer(listener)
  if (tls && 'setSecureContext' in server) {
    // cert-manager renews the certificate in place: pick the new one up within the hour.
    const timer = setInterval(() => {
      try {
        server.setSecureContext({ cert: readFileSync(tls.certFile), key: readFileSync(tls.keyFile), minVersion: 'TLSv1.2' })
      } catch (cause) {
        options.log.error(`cognify gateway: reloading its certificate: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }, 60 * 60_000)
    timer.unref()
    server.on('close', () => clearInterval(timer))
  }
  server.listen(options.port, options.host)
  options.log.info(`cognify gateway on ${tls ? 'https' : 'http'}://${options.host}:${options.port}`)
  return server
}
