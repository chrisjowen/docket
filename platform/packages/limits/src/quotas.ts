// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import type { Limit } from './limiter.js'
import { perMinute, type BucketRule } from './token-bucket.js'

/**
 * The beta's rate limits (§12, §19). Each is a token bucket: the burst equals
 * the per-minute figure, and it refills evenly over the minute.
 */
export const RATE_LIMITS = {
  /** MCP calls per token. */
  mcpPerToken: perMinute(120),
  /** MCP calls per org, across all its tokens. */
  mcpPerOrg: perMinute(600),
  /** Write tools per token, on top of the MCP limits. */
  writesPerToken: perMinute(30),
  /** Sign-in requests (the sign-in page, GitHub redirect and callback) per client address. */
  signInPerAddress: perMinute(30),
  /** Password attempts per login, from anywhere: 10, then one every 6 minutes, so guessing one person's password is slow even from many addresses. */
  passwordPerLogin: { capacity: 10, perSecond: 1 / 360 },
  /**
   * Token requests per pending device code (RFC 8628 §3.5): one every 5
   * seconds, the interval the device response advertises, with one poll of
   * slack for a timer that fires early.
   */
  devicePollPerCode: { capacity: 2, perSecond: 1 / 5 },
  /**
   * Requests to the OAuth token and revocation endpoints per known client and
   * client address: hosted MCP clients refresh every user's tokens from a few
   * shared addresses.
   */
  oauthTokenPerClient: perMinute(600),
  /** Requests to the OAuth token and revocation endpoints per client address, across every client. */
  oauthTokenPerAddress: perMinute(1200),
  /** Requests to the OAuth authorization server's other endpoints (authorize, device, jwks) per client address. */
  oauthPerAddress: perMinute(120),
  /** Dynamic client registrations per client address: each one writes a client. */
  registrationsPerAddress: perMinute(60),
  /** API tokens a person creates a minute, from the web app or the CLI. */
  tokenCreatesPerUser: perMinute(10),
  /** Questions a person asks on the Ask page a minute, however many workspaces each goes to. */
  askQuestionsPerUser: perMinute(20),
} as const

/** The calling credential an MCP request carries: the fields of the MCP `Principal` the limits need. */
export interface Caller {
  orgId: string
  tokenId: string
}

/** The limits one MCP call counts against: its token's and its org's. */
export function mcpLimits(caller: Caller): Limit[] {
  return [
    { scope: 'token', key: `mcp:token:${caller.tokenId}`, rule: RATE_LIMITS.mcpPerToken },
    { scope: 'org', key: `mcp:org:${caller.orgId}`, rule: RATE_LIMITS.mcpPerOrg },
  ]
}

/** The extra limit a write tool counts against. */
export function writeLimits(caller: Caller): Limit[] {
  return [{ scope: 'token', what: 'writes', key: `write:token:${caller.tokenId}`, rule: RATE_LIMITS.writesPerToken }]
}

/** The limit a sign-in request counts against. */
export function signInLimits(address: string, rule: BucketRule = RATE_LIMITS.signInPerAddress): Limit[] {
  return [{ scope: 'address', what: 'requests', key: `signin:${address}`, rule }]
}

/** The limit a password attempt counts against, beside its address's sign-in limit. */
export function passwordLimits(login: string): Limit[] {
  return [{ scope: 'login', what: 'password attempts', key: `password:${login.toLowerCase()}`, rule: RATE_LIMITS.passwordPerLogin }]
}

/** The OAuth limits' rules, each overridable. */
export interface OAuthRules {
  token: BucketRule
  tokenAddress: BucketRule
  other: BucketRule
  registration: BucketRule
}

const OAUTH_RULES: OAuthRules = {
  token: RATE_LIMITS.oauthTokenPerClient,
  tokenAddress: RATE_LIMITS.oauthTokenPerAddress,
  other: RATE_LIMITS.oauthPerAddress,
  registration: RATE_LIMITS.registrationsPerAddress,
}

/**
 * The limit a request to an OAuth endpoint (`registration`, `token`, ...)
 * counts against, by client address. With `clientId`, a known client's own
 * limit at that address, which a token or revocation request counts against
 * as well once its address's limit lets it through.
 */
export function oauthLimits(endpoint: string, address: string, clientId: string | null, rules: Partial<OAuthRules> = {}): Limit[] {
  const { token, tokenAddress, other, registration } = { ...OAUTH_RULES, ...rules }
  if (endpoint === 'token' || endpoint === 'revocation') {
    return clientId
      ? [{ scope: 'client and address', what: 'token requests', key: `oauth-client:${address}@${clientKey(clientId)}`, rule: token }]
      : [{ scope: 'address', what: 'token requests', key: `oauth-token:${address}`, rule: tokenAddress }]
  }
  if (endpoint === 'registration') return [{ scope: 'address', what: 'client registrations', key: `oauth-register:${address}`, rule: registration }]
  return [{ scope: 'address', what: 'OAuth requests', key: `oauth:${address}`, rule: other }]
}

/** A client id as a bucket key: client ids are the caller's to choose, so a long one is hashed. */
function clientKey(clientId: string): string {
  return clientId.length <= 128 ? clientId : `sha256:${createHash('sha256').update(clientId).digest('hex')}`
}

/** The limit creating an API token counts against: the person creating it, whichever way they ask. */
export function tokenCreateLimits(userId: string): Limit[] {
  return [{ scope: 'person', what: 'new tokens', key: `token-create:${userId}`, rule: RATE_LIMITS.tokenCreatesPerUser }]
}

/** The limit a question on the Ask page counts against: the person asking. */
export function askLimits(userId: string): Limit[] {
  return [{ scope: 'person', what: 'questions', key: `ask:${userId}`, rule: RATE_LIMITS.askQuestionsPerUser }]
}

/** The limit a device code's token request counts against, by the code's SHA-256. */
export function devicePollLimits(codeHash: string): Limit[] {
  return [{ scope: 'device code', what: 'token requests', key: `device-poll:${codeHash}`, rule: RATE_LIMITS.devicePollPerCode }]
}
