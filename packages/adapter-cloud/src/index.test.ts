import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CredentialStore, OFFLINE_ENV } from '@docket/adapter-kit'
import { startFakeCloud, type FakeCloud } from '@docket/adapter-kit/testing'
import { validateAdapterAnswer, validateAdapterDefinition, type AdapterServices, type AskRequest } from '@docket/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import definition, { createCloudAdapter, type CloudConfig } from './index.js'

let dir: string
let cloud: FakeCloud
let store: CredentialStore

/** Services with a checkout that holds only `service.orders`. */
const services = (env: Record<string, string> = {}): AdapterServices => ({
  projectRoot: dir,
  stateRoot: join(dir, 'state'),
  scope: 'default',
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  canonical: {
    get: async (kind, id) => (kind === 'entity' && id === 'service.orders' ? ({ id } as never) : undefined),
    list: async () => []
  },
  secrets: { getEnv: async (name) => env[name] }
})

const request = (question: string, maxResults = 10): AskRequest => ({
  requestId: 'r1',
  question,
  context: { scope: 'default', now: new Date().toISOString(), timezone: 'UTC' },
  budget: { maxResults, maxEvidenceBytes: 64 * 1024, deadline: new Date(Date.now() + 30_000).toISOString() }
})

const config = (overrides: Partial<CloudConfig> = {}): CloudConfig => ({ url: cloud.url, workspace: 'acme/platform', ...overrides })

const signIn = async () => {
  const { accessToken, refreshToken } = cloud.issue()
  await store.write(`${cloud.url}/mcp/acme/platform`, { accessToken, refreshToken, clientId: 'docket-cli', tokenEndpoint: `${cloud.url}/oauth/token` })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'docket-adapter-cloud-'))
  cloud = await startFakeCloud()
  store = new CredentialStore({ file: join(dir, 'credentials.json'), keychain: null })
  cloud.matches = [
    { id: 'service.orders', type: 'service', title: 'Orders API', path: '.docket/resources/service/orders.md' },
    { id: 'team.billing', type: 'team', title: 'Billing', path: '.docket/resources/team/billing.md' }
  ]
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await cloud.close()
  await rm(dir, { recursive: true, force: true })
})

describe('the cloud adapter', () => {
  it('is a valid adapter definition', () => {
    expect(validateAdapterDefinition(definition).name).toBe('cloud')
  })

  it('takes { url, workspace, tokenEnv? } and nothing else', () => {
    expect(definition.validateConfig({ workspace: 'acme/platform' })).toEqual({ url: 'https://docket.chrisjowen.net', workspace: 'acme/platform' })
    expect(() => definition.validateConfig({ workspace: 'acme' })).toThrow(/<org>\/<workspace>/)
    expect(() => definition.validateConfig({ workspace: 'acme/platform', token: 'dkt_live_x' })).toThrow(/token/)
    expect(() => definition.validateConfig({ workspace: 'acme/platform', url: 'http://docket.example.test' })).toThrow(/https/)
  })

  it('answers through the workspace\'s docket_search, with entity hits only for what the checkout holds', async () => {
    await signIn()
    const adapter = createCloudAdapter(config(), services(), store)

    const answer = validateAdapterAnswer(await adapter.query!.ask(request('who owns orders', 5)), request('who owns orders'))

    expect(cloud.toolCalls).toEqual([{ name: 'docket_search', arguments: { query: 'who owns orders', limit: 5 } }])
    expect(answer.evidence.map((item) => item.canonicalRefs[0]?.id)).toEqual(['service.orders', 'team.billing'])
    const entities = answer.blocks.find((block) => block.kind === 'entities')
    expect(entities?.kind === 'entities' && entities.entities.map((item) => item.ref.id)).toEqual(['service.orders'])
    expect(answer.interpretation.description).toMatch(/2 matches in acme\/platform on http:\/\/127\.0\.0\.1:\d+; 1 only in the cloud/)
  })

  it('uses the API token tokenEnv names', async () => {
    const { accessToken } = cloud.issue()
    const adapter = createCloudAdapter(config({ tokenEnv: 'DOCKET_CLOUD_TOKEN' }), services({ DOCKET_CLOUD_TOKEN: accessToken }), store)

    expect((await adapter.status()).state).toBe('connected')
    await expect(createCloudAdapter(config({ tokenEnv: 'DOCKET_CLOUD_TOKEN' }), services(), store).query!.ask(request('orders'))).rejects.toThrow(
      /DOCKET_CLOUD_TOKEN is not set/
    )
  })

  it('reports itself unavailable offline, without a request', async () => {
    await signIn()
    vi.stubEnv(OFFLINE_ENV, '1')
    const adapter = createCloudAdapter(config(), services(), store)

    expect(await adapter.status()).toEqual({ state: 'unavailable', message: `network access is turned off (${OFFLINE_ENV} is set)` })
    await expect(adapter.query!.ask(request('orders'))).rejects.toThrow(/network access is turned off/)
    expect(cloud.requests).toEqual([])
  })

  it('reports itself unavailable when not signed in, saying how to sign in', async () => {
    const status = await createCloudAdapter(config(), services(), store).status()

    expect(status.state).toBe('unavailable')
    expect(status.message).toMatch(/docket cloud login/)
  })
})
