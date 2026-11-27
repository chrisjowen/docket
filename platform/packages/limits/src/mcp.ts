// SPDX-License-Identifier: AGPL-3.0-only
import { callsPerMinute, rateLimitMessage, type RateLimiter, type Refusal } from './limiter.js'
import { mcpLimits, writeLimits, type Caller } from './quotas.js'

/** The parts of a JSON-RPC request the limits look at. */
export interface McpMessage {
  /** Absent on a notification. */
  id?: string | number | null
  method: string
  params?: unknown
}

/** A refused MCP call, for the route's audit event (outcome `denied`, §12). */
export interface McpRefusal<C extends Caller> {
  caller: C
  /** `mcp.tools/call docket_search`, `mcp.initialize`: the action the audit event records. */
  action: string
  refusal: Refusal
}

/** The tool a `tools/call` names, if any. */
export function toolName(message: McpMessage): string | undefined {
  if (message.method !== 'tools/call') return undefined
  const name = (message.params as { name?: unknown } | undefined)?.name
  return typeof name === 'string' ? name : undefined
}

/** The audit action of an MCP message, as §10 names it: `mcp.tools/call docket_remember`. */
export function mcpAction(message: McpMessage): string {
  const tool = toolName(message)
  return tool ? `mcp.tools/call ${tool}` : `mcp.${message.method}`
}

/**
 * The 429 a refused MCP call answers (§12): `Retry-After`, and a JSON-RPC
 * body the client can hand to the model. A `tools/call` gets a tool result
 * with `isError`, so the model reads why its tool failed and when to retry;
 * any other request gets a JSON-RPC error.
 */
export function mcpRateLimitedResponse(message: McpMessage, refusal: Refusal): Response {
  const text = rateLimitMessage(refusal)
  const detail = {
    error: 'rate_limited',
    scope: refusal.limit.scope,
    limitPerMinute: callsPerMinute(refusal.limit.rule),
    retryAfterSeconds: refusal.retryAfterSeconds,
  }
  const id = message.id ?? null
  const body =
    message.method === 'tools/call'
      ? { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }], structuredContent: detail } }
      : { jsonrpc: '2.0', id, error: { code: -32029, message: text, data: detail } }
  return Response.json(body, {
    status: 429,
    headers: { 'retry-after': String(refusal.retryAfterSeconds), 'cache-control': 'no-store' },
  })
}

export interface McpRateLimitOptions<C extends Caller> {
  limiter: RateLimiter
  /** Write tools also count against the per-token write limit (§12). */
  isWriteTool?: (name: string) => boolean
  /**
   * Records the refusal as the request's audit event, outcome `denied`. Every
   * refused call is audited: each one authenticated (§10).
   */
  audit: (refused: McpRefusal<C>) => Promise<void>
}

/**
 * Pipeline step 5 for `/mcp/{org}/{workspace}` (§3, §12), as
 * `apps/server/src/lib/server/mcp.ts` calls it: after the bearer token resolves
 * to a caller and before the tool runs:
 *
 *     const refused = await limitMcp(principal, message)
 *     if (refused) return refused
 *
 * It answers `null` when the call may go ahead, else the 429 to send, having
 * audited it.
 */
export function mcpRateLimit<C extends Caller>(
  options: McpRateLimitOptions<C>,
): (caller: C, message: McpMessage) => Promise<Response | null> {
  return async (caller, message) => {
    const tool = toolName(message)
    const limits = mcpLimits(caller)
    if (tool && options.isWriteTool?.(tool)) limits.push(...writeLimits(caller))
    const decision = await options.limiter.check(limits)
    if (decision.allowed) return null
    await options.audit({ caller, action: mcpAction(message), refusal: decision })
    return mcpRateLimitedResponse(message, decision)
  }
}
