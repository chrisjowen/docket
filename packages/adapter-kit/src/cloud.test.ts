import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CloudApiError,
  CloudAuthError,
  cloudFetch,
  cloudOrigin,
  CloudUnreachableError,
  CloudWorkspace,
  CredentialStore,
  OFFLINE_ENV,
  type Keychain
} from './cloud.js'
import { startFakeCloud, type FakeCloud } from './testing.js'

const CLOUD = 'https://docket.example.test'
const WORKSPACE = `${CLOUD}/mcp/acme/platform`
const OTHER = `${CLOUD}/mcp/acme/other`

/** A keychain held in memory; `refuse` makes it reject every write, as a locked one does. */
const memoryKeychain = (refuse = false): Keychain & { entries: Map<string, string> } => {
  const entries = new Map<string, string>()
  return {
    name: 'memory',
    entries,
    get: async (account) => entries.get(account),
    set: async (account, secret) => {
      if (refuse) throw new Error('locked')
      entries.set(account, secret)
    },
    remove: async (account) => entries.delete(account)
  }
}

describe('CredentialStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'docket-credentials-'))
    file = join(dir, 'docket', 'credentials.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the file with mode 0600 when there is no keychain', async () => {
    const store = new CredentialStore({ file, keychain: null })

    expect(await store.write(WORKSPACE, { accessToken: 'secret-a' })).toBe('file')

    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await store.read(`${WORKSPACE}/`)).toEqual({ accessToken: 'secret-a' })
    expect(await store.read(OTHER)).toBeUndefined()
  })

  it('tightens a credentials file that was readable by others', async () => {
    const store = new CredentialStore({ file, keychain: null })
    await store.write(WORKSPACE, { accessToken: 'secret-a' })
    await writeFile(file, await readFile(file, 'utf8'), { mode: 0o644 })

    await store.write(OTHER, { accessToken: 'secret-b' })

    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await store.read(WORKSPACE)).toEqual({ accessToken: 'secret-a' })
  })

  it('keeps the credential in the keychain when there is one, and nothing in the file', async () => {
    const keychain = memoryKeychain()
    const store = new CredentialStore({ file, keychain })

    expect(await store.write(WORKSPACE, { accessToken: 'secret-a' })).toBe('keychain')

    expect([...keychain.entries.keys()]).toEqual([WORKSPACE])
    await expect(stat(file)).rejects.toThrow()
    expect(await store.read(WORKSPACE)).toEqual({ accessToken: 'secret-a' })
  })

  it('falls back to the file when the keychain refuses', async () => {
    const store = new CredentialStore({ file, keychain: memoryKeychain(true) })

    expect(await store.write(WORKSPACE, { accessToken: 'secret-a' })).toBe('file')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('forgets a workspace wherever it was kept, leaving the others', async () => {
    const store = new CredentialStore({ file, keychain: null })
    await store.write(WORKSPACE, { accessToken: 'secret-a' })
    await store.write(OTHER, { accessToken: 'secret-b' })

    expect(await store.remove(WORKSPACE)).toBe(true)
    expect(await store.remove(WORKSPACE)).toBe(false)
    expect(await store.read(WORKSPACE)).toBeUndefined()
    expect(await store.read(OTHER)).toEqual({ accessToken: 'secret-b' })
  })
})

describe('cloudOrigin', () => {
  it('keys a cloud by its origin', () => {
    expect(cloudOrigin('https://docket.example.test/acme/platform/')).toBe(CLOUD)
  })

  it('refuses plain http except on this machine', () => {
    expect(() => cloudOrigin('http://docket.example.test')).toThrow(/must use https/)
    expect(cloudOrigin('http://127.0.0.1:4100/')).toBe('http://127.0.0.1:4100')
  })
})

describe('cloudFetch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it(`throws before any request while ${OFFLINE_ENV} is set`, async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv(OFFLINE_ENV, '1')

    await expect(cloudFetch(`${CLOUD}/api/me`)).rejects.toThrow(CloudUnreachableError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names a network failure as the cloud being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })))

    await expect(cloudFetch(`${CLOUD}/api/me`)).rejects.toThrow(/could not reach https:\/\/docket\.example\.test: ECONNREFUSED/)
  })
})

describe('CloudWorkspace', () => {
  let dir: string
  let cloud: FakeCloud
  let store: CredentialStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'docket-cloud-session-'))
    cloud = await startFakeCloud()
    store = new CredentialStore({ file: join(dir, 'credentials.json'), keychain: null })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await cloud.close()
    await rm(dir, { recursive: true, force: true })
  })

  const workspace = (now?: () => Date) =>
    new CloudWorkspace({ url: cloud.url, org: 'acme', workspace: 'platform', store, ...(now ? { now } : {}) })

  const signIn = async (expiresAt?: string) => {
    const { accessToken, refreshToken } = cloud.issue()
    await store.write(`${cloud.url}/mcp/acme/platform`, {
      accessToken,
      refreshToken,
      clientId: 'docket-cli',
      tokenEndpoint: `${cloud.url}/oauth/token`,
      ...(expiresAt ? { expiresAt } : {})
    })
    return { accessToken, refreshToken }
  }

  it('calls an MCP tool with the stored session', async () => {
    await signIn()
    cloud.ontology = { version: 4, yaml: 'version: 1\n' }

    const { structured } = await workspace().callTool<{ version: number }>('docket_ontology', {})

    expect(structured.version).toBe(4)
    expect(cloud.toolCalls).toEqual([{ name: 'docket_ontology', arguments: {} }])
  })

  it('renews an access token about to expire before using it, and keeps the rotated tokens', async () => {
    const old = await signIn(new Date(Date.now() + 5_000).toISOString())

    await workspace().listTools()

    expect(cloud.tokenRequests.map((form) => [form.get('grant_type'), form.get('resource')])).toEqual([
      ['refresh_token', `${cloud.url}/mcp/acme/platform`]
    ])
    const kept = await store.read(`${cloud.url}/mcp/acme/platform`)
    expect(kept?.accessToken).not.toBe(old.accessToken)
    expect(kept?.refreshToken).not.toBe(old.refreshToken)
  })

  it('renews and retries once when the cloud refuses the access token', async () => {
    await signIn()
    cloud.expireAccessTokens()

    expect(await workspace().listTools()).toContain('docket_search')
    expect(cloud.requests.filter((route) => route === 'POST /mcp/acme/platform')).toHaveLength(2)
  })

  it('asks for a new sign-in when the session cannot be renewed', async () => {
    await signIn()
    cloud.expireAccessTokens()
    const stored = await store.read(`${cloud.url}/mcp/acme/platform`)
    await store.write(`${cloud.url}/mcp/acme/platform`, { ...stored!, refreshToken: 'revoked' })

    await expect(workspace().listTools()).rejects.toThrow(CloudAuthError)
    await expect(workspace().listTools()).rejects.toThrow(/docket cloud login/)
  })

  it('asks for a sign-in when there is none', async () => {
    await expect(workspace().listTools()).rejects.toThrow(/Not signed in: run `docket cloud login`/)
  })

  it('fails offline before reading any credential', async () => {
    vi.stubEnv(OFFLINE_ENV, '1')
    const read = vi.spyOn(store, 'read')

    await expect(workspace().listTools()).rejects.toThrow(CloudUnreachableError)
    expect(read).not.toHaveBeenCalled()
  })

  it('throws a tool error in the tool\'s own words', async () => {
    await signIn()

    await expect(workspace().callTool('docket_unknown', {})).rejects.toThrow(new CloudApiError('Unknown tool docket_unknown', 200, 'tool-error'))
  })

  it('uses a fixed token as given, never refreshing it', async () => {
    const { accessToken } = cloud.issue()
    const fixed = new CloudWorkspace({ url: cloud.url, org: 'acme', workspace: 'platform', store, token: accessToken })

    expect(await fixed.listTools()).toContain('docket_search')
    cloud.expireAccessTokens()
    await expect(fixed.listTools()).rejects.toThrow(/the token given for acme\/platform/)
    expect(cloud.tokenRequests).toEqual([])
  })
})
