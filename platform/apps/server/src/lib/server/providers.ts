// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'

import type { OidcProviderConfig, PasswordUser } from '@docket/platform-auth'
import { signinAllowEntry, type SigninAllowEntry } from '@docket/platform-tenancy'

/*
 * The sign-in providers beside GitHub, from the environment `docket serve`
 * sets from docket-server.yaml (or a container sets itself):
 *
 * - `DOCKET_OIDC_PROVIDERS`: a JSON list of OpenID Connect providers,
 *   `[{ name, label, issuer, clientId, clientSecret | clientSecretFile, scopes }]`.
 * - `DOCKET_PASSWORD_USERS`: a JSON list of password users,
 *   `[{ login, name, email, password | passwordFile }]`.
 * - `DOCKET_SIGNIN_ALLOW`: comma-separated emails, `@domain`s and non-GitHub
 *   logins that may sign in and create accounts (GitHub logins stay in
 *   `DOCKET_BETA_ALLOWLIST`).
 *
 * Anything malformed stops the server starting, with what is wrong.
 */

const NAME = /^[a-z][a-z0-9-]{0,19}$/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function jsonList(name: string, raw: string | undefined): Record<string, unknown>[] {
  if (!raw?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${name} is a JSON list`)
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))) {
    throw new Error(`${name} is a JSON list of objects`)
  }
  return parsed as Record<string, unknown>[]
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** A secret given inline or as a mounted file's path, read once here. */
function secretOf(name: string, entry: Record<string, unknown>, key: string): string {
  const inline = text(entry[key])
  const file = text(entry[`${key}File`])
  if (inline && file) throw new Error(`${name}: give ${key} or ${key}File, not both`)
  if (file) {
    const value = readFileSync(file, 'utf8').replace(/\r?\n$/, '')
    if (!value) throw new Error(`${name}: ${key}File ${file} is empty`)
    return value
  }
  if (!inline) throw new Error(`${name}: ${key} or ${key}File is needed`)
  return entry[key] as string
}

/** The OIDC providers people may sign in with, by name. */
export function oidcProviders(raw: string | undefined, input: { origin: string; production: boolean }): Map<string, OidcProviderConfig> {
  const providers = new Map<string, OidcProviderConfig>()
  for (const [index, entry] of jsonList('DOCKET_OIDC_PROVIDERS', raw).entries()) {
    const where = `DOCKET_OIDC_PROVIDERS[${index}]`
    const name = text(entry.name)
    if (!name || !NAME.test(name)) throw new Error(`${where}.name is a short lowercase name, like okta`)
    if (name === 'github') throw new Error(`${where}.name: github is GitHub sign-in's own`)
    if (providers.has(name)) throw new Error(`${where}.name: ${name} is listed twice`)
    const issuer = text(entry.issuer)
    let url: URL
    try {
      url = new URL(issuer ?? '')
    } catch {
      throw new Error(`${where}.issuer is the provider's issuer URL`)
    }
    // Plain HTTP only for a provider on this machine, outside production: a local preview or a test.
    const allowHttp = !input.production && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.host.replace(/:\d+$/, ''))
    if (url.protocol !== 'https:' && !allowHttp) throw new Error(`${where}.issuer is https:// (plain http:// only for a provider on this machine, outside production)`)
    const clientId = text(entry.clientId)
    if (!clientId) throw new Error(`${where}.clientId is needed`)
    const scopes = entry.scopes === undefined ? ['profile', 'email'] : entry.scopes
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string' && /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope))) {
      throw new Error(`${where}.scopes is a list of scope names`)
    }
    providers.set(name, {
      name,
      label: text(entry.label) ?? name,
      issuer: issuer as string,
      clientId,
      clientSecret: secretOf(where, entry, 'clientSecret'),
      redirectUri: new URL(`/auth/oidc/${name}/callback`, input.origin).toString(),
      scopes: scopes as string[],
      ...(allowHttp ? { allowHttp } : {}),
    })
  }
  return providers
}

/** The password users the operator lists. */
export function passwordUsers(raw: string | undefined): PasswordUser[] {
  return jsonList('DOCKET_PASSWORD_USERS', raw).map((entry, index) => {
    const where = `DOCKET_PASSWORD_USERS[${index}]`
    const login = text(entry.login)
    if (!login) throw new Error(`${where}.login is needed`)
    return { login, name: text(entry.name), email: text(entry.email), password: secretOf(where, entry, 'password') }
  })
}

/** The sign-in allowlist's entries beside GitHub logins. */
export function signinAllowList(raw: string | undefined): SigninAllowEntry[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parsed = signinAllowEntry(entry)
      if (!parsed) throw new Error(`DOCKET_SIGNIN_ALLOW lists emails, @domains and non-GitHub logins, and ${JSON.stringify(entry)} is none of these`)
      return parsed
    })
}
