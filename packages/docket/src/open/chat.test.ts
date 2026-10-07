import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { appendFile, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { sync } from '../commands/sync.js'
import { citationsIn } from './chat.js'
import { startUiServer, type UiServer } from './server.js'
import type { UiChatAnswer } from './types.js'

const ORDERS = `---
id: service.orders
type: service
title: Orders API
links:
  - rel: owned_by
    target: team.payments
---

Handles orders for checkout.
`

const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team owns checkout money movement.
`

const REPLY = 'Checkout runs on [service.orders], owned by [team.payments]. See also [service.imaginary].'

/** A stand-in for Ollama's `/api/chat`, counting what it is asked. */
interface FakeOllama {
  url: string
  prompts: { system: string; user: string }[]
  /** What it answers next: a reply, or an HTTP status to fail with. */
  respond: string | number
  close(): Promise<void>
}

const fakeOllama = async (): Promise<FakeOllama> => {
  const fake = { prompts: [], respond: REPLY } as unknown as FakeOllama
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      const { messages } = JSON.parse(body) as { messages: { content: string }[] }
      fake.prompts.push({ system: messages[0]?.content ?? '', user: messages[1]?.content ?? '' })
      if (typeof fake.respond === 'number') {
        response.writeHead(fake.respond).end('model not found')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: { role: 'assistant', content: fake.respond } }))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake.close = () =>
    new Promise((done) => {
      server.closeAllConnections()
      server.close(() => done())
    })
  return fake
}

/**
 * A stand-in for the `claude` CLI, put on a PATH that holds nothing else of
 * Claude's, so the real one is never run. It keeps the arguments and stdin of
 * its last call, counts its calls, and answers with `reply`, or exits with
 * `code` after printing `stderr`, or sleeps for `sleep` seconds first.
 */
interface FakeClaude {
  install(behaviour?: { reply?: string; code?: number; stderr?: string; sleep?: number }): Promise<void>
  calls(): Promise<number>
  args(): Promise<string[]>
  stdin(): Promise<string>
}

const fakeClaude = (bin: string): FakeClaude => ({
  install: async ({ reply = REPLY, code = 0, stderr = '', sleep = 0 } = {}) => {
    await writeFile(join(bin, 'reply'), reply, 'utf8')
    await writeFile(join(bin, 'stderr'), stderr, 'utf8')
    const script = [
      '#!/bin/sh',
      'dir="$(dirname "$0")"',
      'printf x >> "$dir/calls"',
      ': > "$dir/args"',
      'for arg in "$@"; do printf \'%s\\0\' "$arg" >> "$dir/args"; done',
      'cat > "$dir/stdin"',
      sleep > 0 ? `sleep ${sleep}` : '',
      'cat "$dir/stderr" >&2',
      code === 0 ? 'cat "$dir/reply"' : '',
      `exit ${code}`
    ].join('\n')
    await writeFile(join(bin, 'claude'), `${script}\n`, 'utf8')
    await chmod(join(bin, 'claude'), 0o755)
  },
  calls: async () => (await readFile(join(bin, 'calls'), 'utf8').catch(() => '')).length,
  args: async () => (await readFile(join(bin, 'args'), 'utf8')).split('\0').slice(0, -1),
  stdin: () => readFile(join(bin, 'stdin'), 'utf8')
})

let root: string
let server: UiServer | undefined
let ollama: FakeOllama
let claude: FakeClaude
let bin: string
const PATH = process.env.PATH

const write = async (path: string, contents: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

const chat = async (question: string): Promise<UiChatAnswer> => {
  if (!server) throw new Error('server not started')
  const response = await fetch(new URL(`/api/chat?q=${encodeURIComponent(question)}`, server.url))
  expect(response.status).toBe(200)
  return (await response.json()) as UiChatAnswer
}

const CACHE = '.docket/.cache/chat'

const cacheFiles = async (): Promise<string[]> => readdir(join(root, CACHE)).catch(() => [])

/** Every file under the root, with its contents, so a test can tell what a request wrote. */
const snapshot = async (dir: string = root): Promise<Map<string, string>> => {
  const files = new Map<string, string>()
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    files.set(relative(root, path), await readFile(path, 'utf8'))
  }
  return files
}

const configureModel = (model = 'fake-model'): Promise<void> =>
  appendFile(join(root, '.docket.yaml'), `\nsummarize:\n  url: ${ollama.url}\n  model: ${model}\n`, 'utf8')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-chat-'))
  bin = await mkdtemp(join(tmpdir(), 'docket-chat-bin-'))
  process.env.PATH = `${bin}:/usr/bin:/bin`
  claude = fakeClaude(bin)
  await init({ cwd: root })
  await write(join(root, '.docket/resources/services/orders.md'), ORDERS)
  await write(join(root, '.docket/resources/teams/payments.md'), PAYMENTS)
  await sync({ cwd: root })
  ollama = await fakeOllama()
  server = await startUiServer({ cwd: root, uiDir: join(root, 'ui'), port: 0 })
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await ollama.close()
  process.env.PATH = PATH
  await rm(root, { recursive: true, force: true })
  await rm(bin, { recursive: true, force: true })
})

describe('the chat API', () => {
  it('summarizes what search found, citing only exhibits it was given', async () => {
    await configureModel()

    const reply = await chat('checkout')

    expect(reply.answer.documents.map((document) => document.id).sort()).toEqual(['service.orders', 'team.payments'])
    expect(reply.summary).toEqual({
      text: REPLY,
      cited: ['service.orders', 'team.payments'],
      model: 'fake-model',
      cached: false,
      createdAt: expect.any(String)
    })
    expect(reply.notice).toBeUndefined()
    expect(ollama.prompts).toHaveLength(1)
    expect(ollama.prompts[0]?.user).toContain('Question: checkout')
    expect(ollama.prompts[0]?.user).toContain('[service.orders] Orders API (service)')
    expect(ollama.prompts[0]?.user).toContain('links: owned_by -> team.payments')
  })

  it('answers the same question again from the cache, without the model', async () => {
    await configureModel()

    const first = await chat('checkout')
    const again = await chat('  Checkout ')

    expect(again.summary).toEqual({ ...first.summary, cached: true })
    expect(ollama.prompts).toHaveLength(1)
    expect(await cacheFiles()).toHaveLength(1)
  })

  it('asks the model again for a different question', async () => {
    await configureModel()

    await chat('checkout')
    const other = await chat('who owns checkout money movement')

    expect(other.summary?.cached).toBe(false)
    expect(ollama.prompts).toHaveLength(2)
    expect(await cacheFiles()).toHaveLength(2)
  })

  it('throws the cached answer away when an exhibit it was built from changes', async () => {
    await configureModel()
    await chat('checkout')

    await write(join(root, '.docket/resources/teams/payments.md'), PAYMENTS.replace('owns', 'runs'))
    ollama.respond = 'Now [team.payments] runs it.'
    const changed = await chat('checkout')

    expect(changed.summary).toMatchObject({ text: 'Now [team.payments] runs it.', cited: ['team.payments'], cached: false })
    expect(ollama.prompts).toHaveLength(2)
    expect(ollama.prompts[1]?.user).toContain('The payments team runs checkout money movement.')
    // Replaced, not kept beside it: one file per question.
    expect(await cacheFiles()).toHaveLength(1)
    expect((await chat('checkout')).summary).toMatchObject({ text: 'Now [team.payments] runs it.', cached: true })
  })

  it('throws the cached answer away when the exhibits become connected through an entity it did not find', async () => {
    const ledger = (links: string): string =>
      `---\nid: datasource.ledger\ntype: datasource\ntitle: Ledger\n${links}---\n\nRecords money movement.\n`
    await write(
      join(root, '.docket/resources/services/orders.md'),
      ORDERS.replace('rel: owned_by\n    target: team.payments', 'rel: depends_on\n    target: datasource.ledger')
    )
    await write(join(root, '.docket/resources/datasources/ledger.md'), ledger(''))
    await sync({ cwd: root })
    await configureModel()

    const first = await chat('checkout')
    expect(first.answer.documents.map((document) => document.id).sort()).toEqual(['service.orders', 'team.payments'])
    expect(first.answer.paths).toEqual([])

    await write(join(root, '.docket/resources/datasources/ledger.md'), ledger('links:\n  - rel: owned_by\n    target: team.payments\n'))
    const connected = await chat('checkout')

    expect(connected.answer.documents.map((document) => document.id).sort()).toEqual(['service.orders', 'team.payments'])
    expect(connected.answer.paths.map((path) => path.nodes)).toEqual([['service.orders', 'datasource.ledger', 'team.payments']])
    expect(connected.summary?.cached).toBe(false)
    expect(ollama.prompts).toHaveLength(2)
    expect(ollama.prompts[1]?.user).toContain('How they connect:\nservice.orders -depends_on-> datasource.ledger -owned_by-> team.payments')
    expect((await chat('checkout')).summary?.cached).toBe(true)
  })

  it('throws the cached answer away when the model changes', async () => {
    await configureModel('first-model')
    await chat('checkout')

    await write(join(root, '.docket.yaml'), (await readFile(join(root, '.docket.yaml'), 'utf8')).replace('first-model', 'second-model'))
    const reply = await chat('checkout')

    expect(reply.summary).toMatchObject({ model: 'second-model', cached: false })
    expect(ollama.prompts).toHaveLength(2)
  })

  it('writes nothing but its own cache', async () => {
    await configureModel()
    const before = await snapshot()

    await chat('checkout')

    const after = await snapshot()
    const written = [...after.keys()].filter((path) => before.get(path) !== after.get(path))
    expect(written).toEqual([expect.stringMatching(/^\.docket\/\.cache\/chat\/[0-9a-f]{64}\.json$/)])
    expect(JSON.parse(after.get(written[0] as string) as string)).toMatchObject({
      question: 'checkout',
      model: 'fake-model',
      exhibits: expect.arrayContaining([{ id: 'service.orders', hash: expect.stringMatching(/^sha256:/) }]),
      cited: ['service.orders', 'team.payments']
    })
  })

  it('summarizes with the claude CLI when no model is configured', async () => {
    await claude.install()

    const reply = await chat('checkout')

    expect(reply.summary).toEqual({
      text: REPLY,
      cited: ['service.orders', 'team.payments'],
      model: 'claude',
      cached: false,
      createdAt: expect.any(String)
    })
    expect(reply.notice).toBeUndefined()
    const args = await claude.args()
    expect(args.slice(0, 3)).toEqual(['-p', '--output-format', 'text'])
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('casebook')
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).toContain('--no-session-persistence')
    expect(args).not.toContain('--model')
    expect(await claude.stdin()).toContain('Question: checkout')
    expect(await claude.stdin()).toContain('[service.orders] Orders API (service)')
    expect(ollama.prompts).toHaveLength(0)

    expect((await chat('checkout')).summary).toMatchObject({ model: 'claude', cached: true })
    expect(await claude.calls()).toBe(1)
  })

  it('passes the question to claude as input, never through a shell', async () => {
    await claude.install()
    const question = `checkout "$(touch pwned)" \`touch pwned\`; touch pwned`

    await chat(question)

    expect(await claude.stdin()).toContain(`Question: ${question}`)
    expect(await readdir(bin)).not.toContain('pwned')
    expect(await readdir(tmpdir())).not.toContain('pwned')
  })

  it('passes a configured claude model on', async () => {
    await claude.install()
    await appendFile(join(root, '.docket.yaml'), '\nsummarize:\n  provider: claude\n  model: sonnet\n', 'utf8')

    const reply = await chat('checkout')

    expect(reply.summary).toMatchObject({ model: 'claude (sonnet)', cached: false })
    const args = await claude.args()
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet')
  })

  it('does not return claude\'s cached answer once Ollama is configured instead', async () => {
    await claude.install()
    await chat('checkout')

    await configureModel()
    const reply = await chat('checkout')

    expect(reply.summary).toMatchObject({ model: 'fake-model', cached: false })
    expect(ollama.prompts).toHaveLength(1)
    expect(await claude.calls()).toBe(1)
  })

  it('shows the search results, and how to get a model, when claude is not installed and none is configured', async () => {
    const reply = await chat('checkout')

    expect(reply.summary).toBeNull()
    expect(reply.notice).toEqual({ reason: 'unconfigured', message: expect.stringContaining('Claude Code is not installed') })
    expect(reply.notice?.message).toContain('summarize')
    expect(reply.answer.documents).toHaveLength(2)
    expect(ollama.prompts).toHaveLength(0)
    expect(await cacheFiles()).toEqual([])
  })

  it('reports claude failing, with what it said, and caches nothing', async () => {
    await claude.install({ code: 1, stderr: 'Invalid API key - please run /login' })

    const reply = await chat('checkout')

    expect(reply.summary).toBeNull()
    expect(reply.notice).toEqual({ reason: 'failed', message: expect.stringContaining('Invalid API key - please run /login') })
    expect(reply.notice?.message).toContain('claude exited with 1')
    expect(reply.answer.documents).toHaveLength(2)
    expect(await cacheFiles()).toEqual([])
  })

  it('gives up on claude after its timeout', async () => {
    await claude.install({ sleep: 5 })
    await appendFile(join(root, '.docket.yaml'), '\nsummarize:\n  provider: claude\n  timeoutMs: 200\n', 'utf8')

    const reply = await chat('checkout')

    expect(reply.notice).toEqual({ reason: 'failed', message: expect.stringContaining('did not answer within 0.2s') })
    expect(await cacheFiles()).toEqual([])
  })

  it('reports a failing model without failing the answer, and caches nothing', async () => {
    await configureModel()
    ollama.respond = 500

    const reply = await chat('checkout')

    expect(reply.summary).toBeNull()
    expect(reply.notice).toEqual({ reason: 'failed', message: expect.stringContaining('fake-model') })
    expect(reply.answer.documents).toHaveLength(2)
    expect(await cacheFiles()).toEqual([])
  })

  it('does not ask the model when nothing was found', async () => {
    await configureModel()

    const reply = await chat('zebra')

    expect(reply.summary).toBeNull()
    expect(reply.notice?.reason).toBe('empty')
    expect(ollama.prompts).toHaveLength(0)
  })

  it('rejects an empty question', async () => {
    expect((await fetch(new URL('/api/chat?q=', server?.url))).status).toBe(400)
  })
})

describe('citationsIn', () => {
  it('keeps exhibits it knows, once each, in first-cited order', () => {
    expect(citationsIn('[b] and [a], then [b] again, [c] and [ not an id ]', new Set(['a', 'b']))).toEqual(['b', 'a'])
    expect(citationsIn('`c` relies on `b`, not `d`', new Set(['a', 'b', 'c']))).toEqual(['c', 'b'])
  })

  it('reads ids grouped in one bracket', () => {
    expect(citationsIn('Checkout [service.orders, team.payments] and [c; a]', new Set(['a', 'c', 'service.orders', 'team.payments']))).toEqual([
      'service.orders',
      'team.payments',
      'c',
      'a'
    ])
  })
})
