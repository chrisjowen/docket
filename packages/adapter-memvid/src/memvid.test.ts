import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { entityInput } from '@docket/adapter-kit/testing'
import { fakeServices, sampleAskRequest } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import memvid from './index.js'
import { createMemvidAdapter } from './memvid-adapter.js'
import { lexicalQuery, stripFrameMetadata } from './memvid-store.js'
import { memvidEnvironment, MemvidUnavailableError, spawnRunner, type CommandRunner } from './runner.js'
import { frameUri, namespacePrefix, parseFrameUri } from './uri.js'

describe('memvid adapter definition', () => {
  it('defaults to a file in its state directory and the memvid on PATH', () => {
    expect(memvid.validateConfig(undefined)).toEqual({ command: 'memvid', timeoutMs: 30_000, lockTimeoutMs: 5_000 })
    expect(memvid).toMatchObject({ apiVersion: 1, name: 'memvid' })
  })

  it('refuses unknown fields and a namespace that is not one URI segment', () => {
    expect(() => memvid.validateConfig({ fiel: 'x.mv2' })).toThrow(/fiel/)
    expect(() => memvid.validateConfig({ namespace: 'a/b' })).toThrow(/namespace must be one URI segment/)
  })
})

describe('native URIs', () => {
  it('round-trip identities with any characters, percent-encoded', () => {
    const identity = { kind: 'entity' as const, id: 'service.orders/v2', revision: 'sha256:abc' }
    const uri = frameUri('default', identity)
    expect(uri).toBe('mv2://docket/default/entity/service.orders%2Fv2/sha256%3Aabc')
    expect(uri.startsWith(namespacePrefix('default'))).toBe(true)
    expect(parseFrameUri('default', uri)).toEqual(identity)
  })

  it('do not claim frames from another namespace or another writer', () => {
    const uri = frameUri('other', { kind: 'entity', id: 'a', revision: 'r' })
    expect(parseFrameUri('default', uri)).toBeUndefined()
    expect(parseFrameUri('default', 'mv2://docket/default/notes/a/r')).toBeUndefined()
    expect(parseFrameUri('default', 'mv2://docket/default/entity/a')).toBeUndefined()
    expect(parseFrameUri('default', 'file:///notes.md')).toBeUndefined()
  })
})

describe('lexicalQuery', () => {
  it('ORs the distinct words, so a question need not match every one of them', () => {
    expect(lexicalQuery('Why did we choose Postgres? Why?')).toBe('why OR did OR we OR choose OR postgres')
  })

  it('drops the parser operators and syntax a question would otherwise trigger', () => {
    expect(lexicalQuery('title:"orders" AND (billing OR not)')).toBe('title OR orders OR billing')
    expect(lexicalQuery('?! -- "')).toBeUndefined()
  })
})

describe('stripFrameMetadata', () => {
  const uri = 'mv2://docket/default/entity/service.orders/r1'
  it('removes what memvid appends to a short frame', () => {
    const text = `# Orders\nTakes orders.\ntitle: Orders\nuri: ${uri}\ntrack: docket\nmetadata: {"mime":"text/plain"}`
    expect(stripFrameMetadata(text, 'Orders', uri)).toBe('# Orders\nTakes orders.')
  })

  it('leaves a chunk, which carries none, alone, and empties an empty frame', () => {
    expect(stripFrameMetadata('Paragraph 40: Postgres.', 'Ledger (page 3/4)', `${uri}#page-3`)).toBe('Paragraph 40: Postgres.')
    expect(stripFrameMetadata(`title: Empty\nuri: ${uri}\nmetadata: {}`, 'Empty', uri)).toBe('')
  })
})

describe('spawnRunner', () => {
  it('withholds hosted-service keys and turns telemetry and downloads off', async () => {
    const env = memvidEnvironment({ PATH: '/bin', OPENAI_API_KEY: 'sk-x', MEMVID_API_KEY: 'mv2_x', MEMVID_TELEMETRY: '1' })
    expect(env).toEqual({ PATH: '/bin', MEMVID_TELEMETRY: '0', MEMVID_OFFLINE: '1' })

    const run = spawnRunner(process.execPath, tmpdir())
    const result = await run(['-e', 'process.stdin.pipe(process.stdout); process.stderr.write(String(process.env.MEMVID_OFFLINE))'], {
      input: 'payload',
      timeoutMs: 10_000
    })
    expect(result).toEqual({ code: 0, stdout: 'payload', stderr: '1' })
  })

  it('says how to install the CLI when it is missing, and never installs it', async () => {
    const run = spawnRunner('docket-no-such-memvid', tmpdir())
    await expect(run(['version'], { timeoutMs: 10_000 })).rejects.toThrow(MemvidUnavailableError)
    await expect(run(['version'], { timeoutMs: 10_000 })).rejects.toThrow(/npm install -g memvid-cli@2\.0\.160/)
  })

  it('stops a call that outlives its timeout or is aborted', async () => {
    const run = spawnRunner(process.execPath, tmpdir())
    await expect(run(['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 200 })).rejects.toThrow(/did not finish within 200 ms/)
    const controller = new AbortController()
    const pending = run(['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 60_000, signal: controller.signal })
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
  })
})

/** A CLI that only knows its version: enough for everything that must not reach the file. */
const versionOnly: CommandRunner = async (args) =>
  args[0] === 'version' ? { code: 0, stdout: 'memvid-cli 2.0.140\n', stderr: '' } : { code: 2, stdout: '', stderr: `unexpected ${args[0]}` }

const adapterIn = async (run: CommandRunner = versionOnly, scope = 'default') => {
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), 'docket-memvid-')))
  return createMemvidAdapter(memvid.validateConfig({}), fakeServices({ projectRoot: stateRoot, stateRoot, scope }), {
    version: '0.0.0',
    run
  })
}

describe('memvid adapter', () => {
  it('describes itself as a lexical recall engine for every input kind', async () => {
    expect((await adapterIn()).describe()).toEqual({
      name: 'memvid',
      version: '0.0.0',
      inputs: ['entity', 'observation', 'document'],
      resultKinds: ['passages', 'entities'],
      rebuild: 'reconstructible'
    })
  })

  it('reports itself unavailable, with how to fix it, when the CLI cannot run', async () => {
    const adapter = await adapterIn(async () => {
      throw new MemvidUnavailableError('The memvid CLI "memvid" could not be run (ENOENT).')
    })
    expect(await adapter.status()).toEqual({ state: 'unavailable', message: 'The memvid CLI "memvid" could not be run (ENOENT).' })
  })

  it('creates no file to report status or answer a question', async () => {
    const adapter = await adapterIn()
    expect(await adapter.status()).toMatchObject({ state: 'ready', engineVersion: 'memvid-cli 2.0.140' })
    const request = { ...sampleAskRequest(), context: { ...sampleAskRequest().context, scope: 'default' } }
    const answer = await adapter.query!.ask(request)
    expect(answer.blocks).toEqual([])
    expect(answer.coverage).toEqual({ mode: 'top-k', truncated: false, scope: 'default' })
  })

  it('refuses another scope rather than writing, resetting or answering there', async () => {
    const adapter = await adapterIn()
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
    const adapter = await adapterIn()
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
