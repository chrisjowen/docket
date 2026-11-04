import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { CredentialStore } from '@docket/adapter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { cloudFixture, type CloudFixture } from '../../../test/cloud.js'
import type { LoginIO } from '../../cloud/client.js'
import { cloudLogin, cloudLogout, cloudWhoami } from './login.js'

let fixture: CloudFixture

afterEach(async () => {
  await fixture.close()
})

/** A login's terminal and browser, recorded; time passes only as it sleeps. */
const recordingIO = (browse?: (url: string) => void) => {
  let clock = 1_800_000_000_000
  const io = {
    shown: [] as { url: string; userCode?: string }[],
    opened: [] as string[],
    slept: [] as number[],
    show: (prompt: { url: string; userCode?: string }) => void io.shown.push(prompt),
    openBrowser: (url: string) => {
      io.opened.push(url)
      browse?.(url)
    },
    sleep: async (ms: number) => {
      io.slept.push(ms)
      clock += ms
    },
    now: () => clock
  }
  return io satisfies LoginIO
}

describe('docket cloud login', () => {
  it('polls the token endpoint at the advertised interval, and writes the session file 0600 without a keychain', async () => {
    fixture = await cloudFixture({ pendingPolls: 2, interval: 7 })
    const io = recordingIO()
    const store = new CredentialStore({ file: join(fixture.root, 'config', 'credentials.json'), keychain: null })

    const result = await cloudLogin({ cwd: fixture.root, store, io })

    expect(result).toMatchObject({ method: 'device', location: 'file', file: store.file })
    expect(io.shown).toEqual([{ url: `${fixture.cloud.url}/device`, userCode: 'WDJB-MJHT' }])
    expect(io.opened).toEqual([`${fixture.cloud.url}/device?user_code=WDJB-MJHT`])
    expect(io.slept).toEqual([7000, 7000, 7000])
    expect(fixture.cloud.tokenRequests.map((form) => form.get('grant_type'))).toEqual(Array(3).fill('urn:ietf:params:oauth:grant-type:device_code'))
    expect(fixture.cloud.tokenRequests.every((form) => form.get('resource') === `${fixture.cloud.url}/mcp/acme/platform`)).toBe(true)
    expect((await stat(store.file)).mode & 0o777).toBe(0o600)
    expect(await store.read(`${fixture.cloud.url}/mcp/acme/platform`)).toMatchObject({ clientId: 'docket-cli', refreshToken: expect.any(String) })
  })

  it('signs in through the browser coming back to this machine when the cloud has no device flow', async () => {
    fixture = await cloudFixture({ deviceFlow: false })
    // The browser: follows the consent redirect back to the CLI's callback.
    const io = recordingIO((url) => void fetch(url))

    const result = await cloudLogin({ cwd: fixture.root, store: fixture.store, io })

    expect(result).toMatchObject({ method: 'browser', location: 'file' })
    const authorize = new URL(io.opened[0]!)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('resource')).toBe(`${fixture.cloud.url}/mcp/acme/platform`)
    expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(fixture.cloud.tokenRequests.map((form) => form.get('grant_type'))).toEqual(['authorization_code'])
    expect(await fixture.store.read(`${fixture.cloud.url}/mcp/acme/platform`)).toMatchObject({ accessToken: expect.any(String) })
  })

  it('refuses a cloud other than the one the project is linked to', async () => {
    fixture = await cloudFixture()

    await expect(cloudLogin({ cwd: fixture.root, url: 'https://elsewhere.example.test', store: fixture.store, io: recordingIO() })).rejects.toThrow(
      /linked to acme\/platform on http:\/\/127\.0\.0\.1:\d+, not https:\/\/elsewhere\.example\.test/
    )
  })
})

describe('docket cloud logout', () => {
  it('forgets the session and revokes it at the cloud', async () => {
    fixture = await cloudFixture()
    await fixture.signIn()

    expect(await cloudLogout({ cwd: fixture.root, store: fixture.store })).toMatchObject({ removed: true, revoked: true })
    expect(await fixture.store.read(`${fixture.cloud.url}/mcp/acme/platform`)).toBeUndefined()
    expect(await cloudLogout({ cwd: fixture.root, store: fixture.store })).toMatchObject({ removed: false, revoked: false })
  })
})

describe('docket cloud whoami', () => {
  it('says who the cloud knows the session as', async () => {
    fixture = await cloudFixture()
    await fixture.signIn()

    expect((await cloudWhoami({ cwd: fixture.root, store: fixture.store })).identity).toMatchObject({ login: 'octocat', role: 'member' })
  })

  it('falls back to what the session records, proven by the tools it may call, when the cloud has no whoami', async () => {
    fixture = await cloudFixture({ restApi: false })
    await fixture.signIn()

    const result = await cloudWhoami({ cwd: fixture.root, store: fixture.store })

    expect(result.identity).toBeUndefined()
    expect(result.session).toMatchObject({ tools: ['docket_search', 'docket_ontology'], note: expect.stringMatching(/does not offer whoami yet/) })
  })
})
