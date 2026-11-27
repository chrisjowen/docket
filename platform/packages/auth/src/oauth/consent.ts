// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from 'node:crypto'

import type Provider from 'oidc-provider'

import { SCOPES, parseScopeString, type Scope } from '../scopes.js'
import { isLocalRedirect, isMetadataClientId, redirectHost } from './cimd.js'
import { CLI_CLIENT_ID } from './provider.js'

/**
 * The consent step of the MCP OAuth flow (§8.2 step 4). The authorization
 * server sends the browser to `/oauth/consent/{uid}`; the web app shows who
 * is asking (the client's name and, prominently, the host its redirect goes
 * to) and for which docket. Approving makes a named connection: the user
 * names it, picks the dockets it reaches and whether it only reads.
 */

/** The interaction cookie `oidc-provider` sets for `/oauth/consent/{uid}`, and its signature cookie. */
export const INTERACTION_COOKIE = '_interaction'

/**
 * Whether this browser started the interaction: it holds the provider's
 * signed `_interaction` cookie naming `uid` (Keygrip's HMAC-SHA1, as Koa signs
 * cookies). A link to someone else's consent page shows nothing.
 */
export function interactionCookieValid(
  cookies: { get(name: string): string | undefined },
  uid: string,
  keys: readonly string[],
): boolean {
  const value = cookies.get(INTERACTION_COOKIE)
  const signature = cookies.get(`${INTERACTION_COOKIE}.sig`)
  if (value !== uid || !signature) return false
  const given = Buffer.from(signature)
  return keys.some((key) => {
    const expected = Buffer.from(
      createHmac('sha1', key).update(`${INTERACTION_COOKIE}=${value}`).digest('base64').replace(/\/|\+|=/g, (c) => ({ '/': '_', '+': '-', '=': '' })[c] ?? ''),
    )
    return expected.length === given.length && timingSafeEqual(expected, given)
  })
}

export interface ConsentRequest {
  uid: string
  clientId: string
  clientName: string
  /**
   * A device sign-in (RFC 8628): nothing is redirected, the device that
   * showed the user a code polls for the token.
   */
  device: boolean
  /** One of the server's own clients (the docket CLI), not one that registered itself. */
  preRegistered: boolean
  /** The client's id is a metadata document URL (CIMD), not a registration. */
  metadataDocument: boolean
  /** The host its id's metadata document lives on, for a CIMD client. */
  clientIdHost: string | null
  redirectUri: string
  /** Where the code goes: shown prominently (§8.2). */
  redirectHost: string
  /** The redirect goes to this machine: any local program could be asking. */
  localApp: boolean
  /** The MCP URL the token will be bound to. */
  resource: string | null
  /** The docket scopes the client asked for. */
  requested: Scope[]
}

export class ConsentError extends Error {
  override name = 'ConsentError'
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

/** What the consent screen shows for an interaction, or null when it expired or never was. */
export async function describeConsent(provider: Provider, uid: string): Promise<ConsentRequest | null> {
  const interaction = await provider.Interaction.find(uid)
  if (!interaction) return null
  const params = interaction.params as Record<string, unknown>
  const clientId = typeof params.client_id === 'string' ? params.client_id : null
  if (!clientId) return null
  const client = await provider.Client.find(clientId)
  if (!client) return null
  const redirectUri = typeof params.redirect_uri === 'string' ? params.redirect_uri : (client.redirectUris?.[0] ?? '')
  const metadataDocument = isMetadataClientId(clientId)
  return {
    uid,
    clientId,
    clientName: typeof client.clientName === 'string' && client.clientName.trim() ? client.clientName.trim().slice(0, 80) : 'An unnamed MCP client',
    device: typeof interaction.deviceCode === 'string',
    preRegistered: clientId === CLI_CLIENT_ID,
    metadataDocument,
    clientIdHost: metadataDocument ? new URL(clientId).host : null,
    redirectUri,
    redirectHost: redirectHost(redirectUri),
    localApp: isLocalRedirect(redirectUri),
    resource: firstString(params.resource),
    requested: parseScopeString(typeof params.scope === 'string' ? params.scope : ''),
  }
}

const epochTime = () => Math.floor(Date.now() / 1000)

/**
 * Approves: a fresh grant on the resource, signed in as `accountId`. The
 * grant carries every docket scope; what the client may do is the named
 * connection the caller records for `grantId` (tenancy v2 §3.4): its owner's
 * access, narrowed to read-only or some dockets. Returns where the browser
 * goes next (the provider's resume URL, which only the browser holding the
 * interaction's resume cookie can use) and the grant's id.
 */
export async function approveConsent(
  provider: Provider,
  uid: string,
  input: { accountId: string; resource: string },
): Promise<{ continueTo: string; grantId: string }> {
  const interaction = await provider.Interaction.find(uid)
  if (!interaction) throw new ConsentError('This sign-in request expired. Start again from your MCP client.')
  const params = interaction.params as Record<string, unknown>
  if (typeof params.client_id !== 'string') throw new ConsentError('This sign-in request has no client.')
  const grant = new provider.Grant({ accountId: input.accountId, clientId: params.client_id })
  const oidc = parseOidcScopes(typeof params.scope === 'string' ? params.scope : '')
  if (oidc) grant.addOIDCScope(oidc)
  grant.addResourceScope(input.resource, SCOPES.join(' '))
  const grantId = await grant.save()
  interaction.result = { login: { accountId: input.accountId }, consent: { grantId } }
  await interaction.save(Math.max(1, interaction.exp - epochTime()))
  return { continueTo: interaction.returnTo, grantId }
}

/** Denies: the client gets `access_denied`. */
export async function denyConsent(provider: Provider, uid: string): Promise<string> {
  const interaction = await provider.Interaction.find(uid)
  if (!interaction) throw new ConsentError('This sign-in request expired. Start again from your MCP client.')
  interaction.result = { error: 'access_denied', error_description: 'The user denied the request.' }
  await interaction.save(Math.max(1, interaction.exp - epochTime()))
  return interaction.returnTo
}

function parseOidcScopes(scope: string): string {
  return scope
    .split(/\s+/)
    .filter((value) => value === 'openid' || value === 'offline_access')
    .join(' ')
}
