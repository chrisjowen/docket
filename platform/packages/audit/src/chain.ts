// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

/** The hash before an org's first event. */
export const GENESIS_HASH = '0'.repeat(64)

/**
 * Canonical JSON: object keys sorted, no whitespace, `undefined` members
 * dropped. Two equal values always give the same text, so a digest over it is
 * stable across processes and versions.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonical JSON has no non-finite numbers')
    if (typeof value === 'bigint') return JSON.stringify(value.toString())
    return JSON.stringify(value) ?? 'null'
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`).join(',')}}`
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The SHA-256 of canonicalised arguments: what an audit event keeps instead of the arguments (§10). */
export function argsDigest(args: unknown): string {
  return `sha256:${sha256(canonical(args))}`
}

/** The fields an event's hash covers: everything but the chain links themselves. */
export interface ChainedFields {
  id: string
  at: Date
  orgId: string | null
  workspaceId: string | null
  actor: string
  ip: string | null
  userAgent: string | null
  action: string
  target: readonly string[]
  argsDigest: string | null
  outcome: string
  latencyMs: number
  requestId: string
}

/** `hash = sha256(prev_hash || canonical(event))` (§10). */
export function eventHash(prevHash: string, event: ChainedFields): string {
  return sha256(
    prevHash +
      canonical({
        id: event.id,
        at: event.at.toISOString(),
        orgId: event.orgId,
        workspaceId: event.workspaceId,
        actor: event.actor,
        ip: event.ip,
        userAgent: event.userAgent,
        action: event.action,
        target: [...event.target],
        argsDigest: event.argsDigest,
        outcome: event.outcome,
        latencyMs: event.latencyMs,
        requestId: event.requestId,
      }),
  )
}

export interface ChainLink extends ChainedFields {
  prevHash: string
  hash: string
}

export interface ChainVerdict {
  ok: boolean
  /** The id of the first event whose link does not hold; `head` when only the head pointer disagrees. */
  brokenAt?: string
  events: number
}

/**
 * Walks a chain in order. A changed row breaks its own hash; a deleted row
 * breaks the next row's `prev_hash`; a deleted tail breaks the head.
 */
export function verifyLinks(links: Iterable<ChainLink>, headHash: string): ChainVerdict {
  let prev = GENESIS_HASH
  let events = 0
  for (const link of links) {
    events += 1
    if (link.prevHash !== prev || eventHash(link.prevHash, link) !== link.hash) {
      return { ok: false, brokenAt: link.id, events }
    }
    prev = link.hash
  }
  if (prev !== headHash) return { ok: false, brokenAt: 'head', events }
  return { ok: true, events }
}
