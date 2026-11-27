// SPDX-License-Identifier: AGPL-3.0-only
/** Beta limits (§12). */
export const LIMITS = {
  /** Orgs on the box, bound by one Neo4j pod per org (§15). */
  orgs: 8,
  /** Members per org, counting service accounts and open invites. */
  membersPerOrg: 25,
  workspacesPerOrg: 5,
  documentsPerWorkspace: 10_000,
  /** One canonical document's raw text, in UTF-8 bytes. */
  documentBytes: 64 * 1024,
  /** Refused MCP credentials per minute per client address, before any lookup is made. */
  refusedMcpAuthPerMinute: 30,
} as const

/** Invites expire after 7 days and work once (§8.1). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** An org still provisioning after this long is abandoned and reaped on the next org creation. */
export const PROVISIONING_TIMEOUT_MS = 15 * 60 * 1000
