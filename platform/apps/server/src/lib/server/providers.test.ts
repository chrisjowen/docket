// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { oidcProviders, passwordUsers, signinAllowList } from './providers'

const dir = mkdtempSync(join(tmpdir(), 'docket-providers-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const site = { origin: 'https://docket.example', production: true }

describe('sign-in providers from the environment', () => {
  it('reads OIDC providers, with their callback on this origin and the secret from a file', () => {
    writeFileSync(join(dir, 'okta'), 'from-a-file\n')
    const providers = oidcProviders(
      JSON.stringify([
        { name: 'okta', label: 'Okta', issuer: 'https://login.example.com', clientId: 'docket', clientSecretFile: join(dir, 'okta') },
        { name: 'keycloak', issuer: 'https://sso.example.com/realms/acme', clientId: 'docket', clientSecret: 'inline', scopes: ['profile', 'email', 'groups'] },
      ]),
      site,
    )
    expect([...providers.keys()]).toEqual(['okta', 'keycloak'])
    expect(providers.get('okta')).toEqual({
      name: 'okta',
      label: 'Okta',
      issuer: 'https://login.example.com',
      clientId: 'docket',
      clientSecret: 'from-a-file',
      redirectUri: 'https://docket.example/auth/oidc/okta/callback',
      scopes: ['profile', 'email'],
    })
    expect(providers.get('keycloak')).toMatchObject({ label: 'keycloak', clientSecret: 'inline', scopes: ['profile', 'email', 'groups'] })
    expect(oidcProviders(undefined, site).size).toBe(0)
  })

  it('takes plain http only for a provider on this machine, outside production', () => {
    const one = (issuer: string, production: boolean) =>
      oidcProviders(JSON.stringify([{ name: 'dev', issuer, clientId: 'c', clientSecret: 's' }]), { origin: 'http://127.0.0.1:4390', production })
    expect(one('http://127.0.0.1:8080/realms/dev', false).get('dev')).toMatchObject({ allowHttp: true })
    expect(() => one('http://127.0.0.1:8080/realms/dev', true)).toThrow(/https/)
    expect(() => one('http://sso.example.com', false)).toThrow(/https/)
  })

  it('refuses a malformed provider list, so the server does not start on it', () => {
    expect(() => oidcProviders('{', site)).toThrow(/JSON list/)
    expect(() => oidcProviders(JSON.stringify([{ name: 'GitHub', issuer: 'https://x.example', clientId: 'c', clientSecret: 's' }]), site)).toThrow(/name/)
    expect(() => oidcProviders(JSON.stringify([{ name: 'github', issuer: 'https://x.example', clientId: 'c', clientSecret: 's' }]), site)).toThrow(/GitHub sign-in's own/)
    expect(() => oidcProviders(JSON.stringify([{ name: 'a', issuer: 'https://x.example', clientId: 'c' }]), site)).toThrow(/clientSecret or clientSecretFile/)
    const twice = { name: 'a', issuer: 'https://x.example', clientId: 'c', clientSecret: 's' }
    expect(() => oidcProviders(JSON.stringify([twice, twice]), site)).toThrow(/twice/)
  })

  it('reads password users, each password inline or from a file', () => {
    writeFileSync(join(dir, 'pw'), 'a long passphrase\n')
    expect(passwordUsers(JSON.stringify([{ login: 'ops.admin', passwordFile: join(dir, 'pw'), email: 'ops@example.com' }, { login: 'jo.b', password: 'another passphrase', name: 'Jo' }]))).toEqual([
      { login: 'ops.admin', name: null, email: 'ops@example.com', password: 'a long passphrase' },
      { login: 'jo.b', name: 'Jo', email: null, password: 'another passphrase' },
    ])
    expect(passwordUsers('')).toEqual([])
    expect(() => passwordUsers(JSON.stringify([{ login: 'x.y' }]))).toThrow(/password or passwordFile/)
  })

  it('reads the sign-in allowlist: emails, @domains and non-GitHub logins, never a GitHub login', () => {
    expect(signinAllowList(' jo@Example.com, @example.org ,ops.admin,,')).toEqual([
      { kind: 'email', value: 'jo@example.com' },
      { kind: 'domain', value: 'example.org' },
      { kind: 'login', value: 'ops.admin' },
    ])
    expect(() => signinAllowList('ada')).toThrow(/DOCKET_SIGNIN_ALLOW lists emails/)
  })
})
