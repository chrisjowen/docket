import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkoutScope } from '@docket/adapter-kit'
import { entityInput } from '@docket/adapter-kit/testing'
import { fakeServices, sampleAskRequest } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import mempalace from './index.js'
import { McpError, McpStdioClient, McpUnavailableError, toolResultJson, type ToolClient } from './mcp-client.js'
import { createMempalaceAdapter, serverEnvironment } from './mempalace-adapter.js'
import {
  defaultWing,
  drawerHeader,
  missingModel,
  palaceName,
  parseSourceFile,
  retryablePalaceError,
  roomFor,
  sourceFile,
  stripDrawerHeader
} from './palace-store.js'

const FAKE_SERVER = fileURLToPath(new URL('../fixtures/fake-mcp-server.mjs', import.meta.url))

const startFake = (env: NodeJS.ProcessEnv = process.env) =>
  McpStdioClient.start({ command: process.execPath, args: [FAKE_SERVER], env, cwd: tmpdir(), startupTimeoutMs: 10_000, timeoutMs: 10_000 })

describe('MemPalace adapter definition', () => {
  it('defaults to the mempalace-mcp on PATH, the minilm model and a palace in its state directory', () => {
    expect(mempalace.validateConfig(undefined)).toEqual({
      command: 'mempalace-mcp',
      args: [],
      embeddingModel: 'minilm',
      startupTimeoutMs: 60_000,
      timeoutMs: 60_000
    })
    expect(mempalace).toMatchObject({ apiVersion: 1, name: 'mempalace' })
  })

  it('refuses unknown fields, wings MemPalace would refuse and models it cannot check', () => {
    expect(() => mempalace.validateConfig({ wings: 'x' })).toThrow(/wings/)
    for (const wing of ['../escape', 'a/b', '-leading', 'trailing-', 'a..b']) {
      expect(() => mempalace.validateConfig({ wing }), wing).toThrow(/wing must be a MemPalace name/)
    }
    expect(() => mempalace.validateConfig({ embeddingModel: 'openai-compat' })).toThrow()
  })
})

describe('drawer identity', () => {
  it('round-trips through source_file with no "/", so a basename is all of it', () => {
    const identity = { kind: 'entity' as const, id: 'service.orders/v2', revision: 'sha256:abc' }
    const value = sourceFile('docket-acme', identity)
    expect(value).toBe('docket:docket-acme:entity:service.orders%2Fv2:sha256%3Aabc')
    expect(value).not.toContain('/')
    expect(parseSourceFile('docket-acme', value)).toEqual(identity)
  })

  it('does not claim drawers from another wing or another writer', () => {
    const value = sourceFile('docket-other', { kind: 'entity', id: 'a', revision: 'r' })
    expect(parseSourceFile('docket-acme', value)).toBeUndefined()
    expect(parseSourceFile('docket-acme', 'notes/meeting.md')).toBeUndefined()
    expect(parseSourceFile('docket-acme', 'docket:docket-acme:task:a:r')).toBeUndefined()
    expect(parseSourceFile('docket-acme', undefined)).toBeUndefined()
  })

  it('strips the header from the chunk that carries it, and only that one', () => {
    const identity = { kind: 'document' as const, id: 'doc.a', revision: 'r1' }
    expect(stripDrawerHeader(`${drawerHeader(identity)}We chose Postgres.`, identity)).toBe('We chose Postgres.')
    expect(stripDrawerHeader('ose Postgres. Later chunk.', identity)).toBe('ose Postgres. Later chunk.')
  })
})

describe('palace names', () => {
  it('turns a checkout into a wing MemPalace accepts, unique to it', () => {
    const wing = defaultWing('/repos/acme platform', 'default')
    expect(wing).toBe(checkoutScope('/repos/acme platform'))
    expect(mempalace.validateConfig({ wing }).wing).toBe(wing)
    expect(defaultWing('/repos/acme platform', 'payments')).toBe(`${wing}-payments`)
    expect(mempalace.validateConfig({ wing: defaultWing('/repos/acme@2+', 'default') }).wing).toMatch(/^docket-acme-2-+[0-9a-f]{12}$/)
  })

  it('files an entity under its type and other inputs under their kind', () => {
    expect(roomFor(entityInput({ id: 'service.a', type: 'service' }))).toBe('service')
    expect(roomFor(entityInput({ id: 'x', type: '__' }))).toBe('entities')
    expect(palaceName("--O'Brien..notes--")).toBe("O'Brien.notes")
  })
})

describe('embedding model check', () => {
  it('reports a missing minilm model, and how to fetch it without docket doing so', async () => {
    const home = await mkdtemp(join(tmpdir(), 'docket-no-model-'))
    expect(missingModel('minilm', home)).toMatch(/would download it on first use; docket never downloads models implicitly/)
    expect(missingModel('embeddinggemma', home)).toBeUndefined()
  })

  it('runs the server offline against the Hugging Face cache, apart from the user\'s own config', () => {
    const env = serverEnvironment(mempalace.validateConfig({ embeddingModel: 'embeddinggemma' }), '/state/mempalace', { PATH: '/bin' })
    expect(env).toEqual({
      PATH: '/bin',
      MEMPALACE_CONFIG_DIR: '/state/mempalace',
      MEMPALACE_EMBEDDING_MODEL: 'embeddinggemma',
      MEMPALACE_HUB_FORWARD: '0',
      HF_HUB_OFFLINE: '1',
      ANONYMIZED_TELEMETRY: 'False'
    })
  })
})

describe('McpStdioClient', () => {
  it('completes the handshake and returns each tool\'s JSON, matched by id', async () => {
    const client = await startFake()
    try {
      expect(client.serverInfo).toEqual({ name: 'mempalace', version: '3.10.0' })
      expect(await client.call('echo', { wing: 'w' })).toEqual({ echoed: { wing: 'w' } })
      expect(await client.call('notice', {})).toEqual({ ok: true })
    } finally {
      await client.close()
    }
  })

  it('surfaces server errors with their code, and an exit with the server\'s last words', async () => {
    const client = await startFake()
    await expect(client.call('busy', {})).rejects.toMatchObject({ code: -32001 })
    await expect(client.call('exit', {})).rejects.toThrow(/exited \(code 3\):[\s\S]*fatal: palace locked/)
    await expect(client.call('echo', {})).rejects.toThrow(McpUnavailableError)
  })

  it('gives up on a call past its timeout or once aborted, leaving the server usable', async () => {
    const client = await startFake()
    try {
      await expect(client.call('slow', {}, { timeoutMs: 100 })).rejects.toThrow(/did not answer within 100 ms/)
      const controller = new AbortController()
      const pending = client.call('slow', {}, { signal: controller.signal })
      controller.abort(new Error('cancelled'))
      await expect(pending).rejects.toThrow('cancelled')
      expect(await client.call('env', { name: 'DOCKET_PROBE' })).toEqual({ value: null })
    } finally {
      await client.close()
    }
  })

  it('says the server could not be run when its command is missing', async () => {
    await expect(
      McpStdioClient.start({ command: 'docket-no-such-mempalace', args: [], env: process.env, cwd: tmpdir(), startupTimeoutMs: 5_000, timeoutMs: 5_000 })
    ).rejects.toThrow(McpUnavailableError)
  })

  it('reads the last JSON block of a result', () => {
    expect(() => toolResultJson({ content: [{ type: 'text', text: 'no json here' }] })).toThrow(McpError)
  })
})

describe('retryablePalaceError', () => {
  it('retries a busy palace, not a refused parameter', () => {
    expect(retryablePalaceError(new McpError('lease', -32001))).toBe(true)
    expect(retryablePalaceError(new McpError('Unknown parameter', -32602))).toBe(false)
  })
})

const adapterWith = async (connect: () => Promise<ToolClient>, home?: string) => {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-mempalace-')))
  return createMempalaceAdapter(mempalace.validateConfig({ wing: 'docket-test' }), fakeServices({ projectRoot: stateRoot, stateRoot, scope: 'default' }), {
    version: '0.0.0',
    connect,
    ...(home !== undefined ? { home } : {})
  })
}

const never = async (): Promise<ToolClient> => {
  throw new Error('the server must not be started')
}

describe('MemPalace adapter', () => {
  it('describes itself as a recall engine for every input kind', async () => {
    expect((await adapterWith(never)).describe()).toEqual({
      name: 'mempalace',
      version: '0.0.0',
      inputs: ['entity', 'observation', 'document'],
      resultKinds: ['passages', 'entities'],
      rebuild: 'reconstructible'
    })
  })

  it('never starts the server while the embedding model is missing, and says so', async () => {
    const home = await mkdtemp(join(tmpdir(), 'docket-no-model-'))
    const adapter = await adapterWith(never, home)
    expect(await adapter.status()).toMatchObject({ state: 'unavailable', message: expect.stringContaining('never downloads models') })
    const receipt = await adapter.projection!.apply({
      batchId: 'b',
      scope: 'default',
      checkpoint: 'c',
      changes: [{ operation: 'upsert', record: entityInput({ id: 'service.a', scope: 'default' }) }]
    })
    expect(receipt.failed).toEqual([{ id: 'service.a', retryable: true, message: expect.stringContaining('never downloads models') }])
  })

  it('says how to install MemPalace when the server cannot be run, and installs nothing', async () => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-mempalace-')))
    const home = await realpath(await mkdtemp(join(tmpdir(), 'docket-model-')))
    const { minilmDirectory } = await import('./palace-store.js')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(minilmDirectory(home), { recursive: true })
    for (const file of ['config.json', 'model.onnx', 'special_tokens_map.json', 'tokenizer_config.json', 'tokenizer.json', 'vocab.txt']) {
      writeFileSync(join(minilmDirectory(home), file), '')
    }
    const adapter = createMempalaceAdapter(
      mempalace.validateConfig({ command: 'docket-no-such-mempalace' }),
      fakeServices({ projectRoot: stateRoot, stateRoot, scope: 'default' }),
      { version: '0.0.0', home }
    )
    expect(await adapter.status()).toMatchObject({ state: 'unavailable', message: expect.stringContaining('pip install mempalace==3.10.0') })
    await adapter.close()
  })

  it('refuses another scope rather than writing, resetting or answering there', async () => {
    const adapter = await adapterWith(never)
    const receipt = await adapter.projection!.apply({
      batchId: 'b',
      scope: 'other',
      checkpoint: 'c',
      changes: [{ operation: 'upsert', record: entityInput({ id: 'service.a', scope: 'other' }) }]
    })
    expect(receipt.failed).toEqual([{ id: 'service.a', retryable: false, message: expect.stringContaining('"other"') }])
    await expect(adapter.projection!.reset('other')).rejects.toThrow(/serves scope "default", not "other"/)
    await expect(adapter.query!.ask(sampleAskRequest())).rejects.toThrow(/serves scope "default", not "contract-test"/)
  })

  it('does not search past the question\'s deadline', async () => {
    const adapter = await adapterWith(never)
    const request = sampleAskRequest()
    await expect(
      adapter.query!.ask({
        ...request,
        context: { ...request.context, scope: 'default' },
        budget: { ...request.budget, deadline: new Date(Date.now() - 1000).toISOString() }
      })
    ).rejects.toThrow(/deadline has already passed/)
  })
})
