import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AdapterAnswer } from '@docket/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { synthesisPrompt, synthesize, type SynthesisInput } from './synthesis.js'
import { takeSnapshot, type RequestSnapshot } from './snapshot.js'
import type { AdapterResult } from './wire.js'

const entity = (id: string, type: string, title: string, links: string, body: string): string =>
  `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\n${links}---\n\n${body}\n`

let root: string
let snapshot: RequestSnapshot
let ollama: { url: string; prompts: string[]; close(): Promise<void> }

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-synthesis-'))
  await init({ cwd: root })
  await mkdir(join(root, '.docket/resources'), { recursive: true })
  const background = Array.from({ length: 80 }, (_, index) => `Background paragraph ${index} about unrelated history.`).join('\n\n')
  await writeFile(
    join(root, '.docket/resources/orders.md'),
    entity('service.orders', 'service', 'Orders API', 'links:\n  - rel: depends_on\n    target: datasource.ledger\n', `${background}\n\nOrders are deployed by the release train.`),
    'utf8'
  )
  await writeFile(
    join(root, '.docket/resources/ledger.md'),
    entity('datasource.ledger', 'datasource', 'Ledger', 'links:\n  - rel: owned_by\n    target: team.payments\n', 'Records money movement.'),
    'utf8'
  )
  await writeFile(join(root, '.docket/resources/payments.md'), entity('team.payments', 'team', 'Payments', '', 'Owns checkout.'), 'utf8')
  snapshot = await takeSnapshot(root)

  const prompts: string[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      const { messages } = JSON.parse(body) as { messages: { content: string }[] }
      prompts.push(messages[1]?.content ?? '')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: { content: 'graph counts 4 deployments [graph:row-1]; mem0 saw 2 [mem0:fact-1] for [service.orders].' } }))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  ollama = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    prompts,
    close: () => new Promise((done) => server.close(() => done()))
  }
})

afterAll(async () => {
  await ollama.close()
  await rm(root, { recursive: true, force: true })
})

const graphAnswer: AdapterAnswer = {
  interpretation: { description: 'Read-only Cypher', assumptions: ['Counts what the files record.'], nativeQuery: 'MATCH ... count(d)' },
  blocks: [{ kind: 'metric', id: 'graph:m', label: 'deployments', value: 4, evidenceIds: ['graph:row-1'] }],
  evidence: [
    {
      id: 'graph:row-1',
      kind: 'derived-fact',
      text: 'deployments: 4',
      canonicalRefs: [{ kind: 'entity', id: 'service.orders' }],
      derivation: { engine: 'neo4j' }
    }
  ],
  coverage: { mode: 'exhaustive', truncated: false, scope: 'default' },
  diagnostics: []
}

const mem0Answer: AdapterAnswer = {
  interpretation: { description: 'mem0 semantic search', assumptions: [] },
  blocks: [
    { kind: 'metric', id: 'mem0:m', label: 'Deployments', value: 2, evidenceIds: ['mem0:fact-1'] },
    { kind: 'facts', id: 'mem0:f', evidenceIds: ['mem0:fact-1'] }
  ],
  evidence: [{ id: 'mem0:fact-1', kind: 'passage', text: 'Orders was deployed twice.', canonicalRefs: [{ kind: 'entity', id: 'service.orders', revision: 'sha256:old' }] }],
  coverage: { mode: 'top-k', truncated: true, scope: 'default' },
  diagnostics: []
}

const results: AdapterResult[] = [
  { adapter: 'graph', state: 'answered', answer: graphAnswer, references: { 'graph:row-1': ['resolved'] } },
  { adapter: 'mem0', state: 'answered', answer: mem0Answer, references: { 'mem0:fact-1': ['stale'] } },
  { adapter: 'memvid', state: 'failed', error: { code: 'unavailable', message: 'memvid is not installed' } }
]

const input = (overrides: Partial<SynthesisInput> = {}): SynthesisInput => ({
  question: 'How many deployments of orders?',
  context: { scope: 'default', now: '2026-10-09T08:00:00.000Z', timezone: 'Asia/Singapore' },
  results,
  references: [
    {
      kind: 'entity',
      id: 'service.orders',
      status: 'resolved',
      revision: 'x',
      entity: 'service.orders',
      foundBy: [{ adapter: 'graph', blockIds: [], evidenceIds: ['graph:row-1'] }]
    }
  ],
  connections: [
    {
      nodes: ['service.orders', 'datasource.ledger', 'team.payments'],
      steps: [
        { rel: 'depends_on', forward: true },
        { rel: 'owned_by', forward: true }
      ]
    }
  ],
  snapshot,
  ...overrides
})

describe('synthesisPrompt', () => {
  let prompt: ReturnType<typeof synthesisPrompt>['prompt']
  let exhibits: ReturnType<typeof synthesisPrompt>['exhibits']
  let evidence: string[]
  beforeAll(() => {
    ;({ prompt, exhibits, evidence } = synthesisPrompt(input()))
  })

  it('tells the model to cite evidence, mark derived facts, respect coverage and keep conflicting counts', () => {
    expect(prompt.system).toContain('casebook')
    expect(prompt.system).toMatch(/derived/)
    expect(prompt.system).toMatch(/never present how many it found as a count/)
    expect(prompt.system).toMatch(/Never pick one silently or average them/)
  })

  it('states each adapter\'s coverage, and the one that could not answer', () => {
    expect(prompt.user).toContain('Asked: 2026-10-09T08:00:00.000Z (time zone Asia/Singapore), in scope "default"')
    expect(prompt.user).toContain('graph: Read-only Cypher (every match in scope)')
    expect(prompt.user).toContain('mem0: mem0 semantic search (top matches only - a sample, not a count, cut short)')
    expect(prompt.user).toContain('memvid: no answer (unavailable) - memvid is not installed')
    expect(prompt.user).toContain('metric: deployments = 4 [graph:row-1]')
  })

  it('sets conflicting counts side by side rather than choosing one', () => {
    expect(prompt.user).toContain(
      'Adapters disagree:\n- deployments: graph says 4 (every match in scope); mem0 says 2 (top matches only - a sample, not a count)'
    )
  })

  it('cites each piece of evidence, telling derived facts from recorded passages and stale ones from current', () => {
    expect(evidence).toEqual(['graph:row-1', 'mem0:fact-1'])
    expect(prompt.user).toContain('[graph:row-1] derived by neo4j, not recorded, from graph; source: entity service.orders (on record)')
    expect(prompt.user).toContain('[mem0:fact-1] passage, from mem0; source: entity service.orders (from an index behind the files)')
  })

  it('includes the entities on the paths between what was found', () => {
    expect(exhibits.map((item) => item.id)).toEqual(['service.orders', 'datasource.ledger', 'team.payments'])
    expect(prompt.user).toContain('On the paths between them:\n\n[datasource.ledger] Ledger (datasource)')
    expect(prompt.user).toContain('How they connect:\nservice.orders -depends_on-> datasource.ledger -owned_by-> team.payments')
  })

  it('quotes the relevant part of a long body, not its opening, within the total budget', () => {
    expect(prompt.user).toContain('Orders are deployed by the release train.')
    expect(prompt.user).not.toContain('Background paragraph 0 ')
    const small = synthesisPrompt(input(), 4_000)
    expect(small.prompt.user.length).toBeLessThan(4_000 + 1_500)
    expect(small.prompt.user).toContain('Orders are deployed by the release train.')
  })
})

describe('synthesize', () => {
  const options = (checkpoint?: string) => ({
    summarize: { provider: 'ollama' as const, url: ollama.url, model: 'fake', timeoutMs: 5_000 },
    memoryRoot: snapshot.resolved.memoryRoot,
    adapters: new Map([
      ['graph', { fingerprint: 'sha256:g', checkpoint }],
      ['mem0', { fingerprint: 'sha256:m', checkpoint: 'records:1' }]
    ])
  })

  it('cites evidence and exhibits, and caches only answers whose freshness is known', async () => {
    const first = await synthesize(input(), options(undefined))
    expect(first.synthesis).toMatchObject({
      citedEvidence: ['graph:row-1', 'mem0:fact-1'],
      citedEntities: ['service.orders'],
      model: 'fake',
      cached: false
    })
    // graph reported no checkpoint and sync does not know it: nothing is cached.
    await synthesize(input(), options(undefined))
    expect(ollama.prompts).toHaveLength(2)
    expect(await readdir(join(snapshot.resolved.memoryRoot, '.cache', 'chat')).catch(() => [])).toEqual([])

    const known = await synthesize(input(), options('records:2'))
    const again = await synthesize(input(), options('records:2'))
    expect(known.synthesis?.cached).toBe(false)
    expect(again.synthesis).toMatchObject({ cached: true, citedEvidence: ['graph:row-1', 'mem0:fact-1'] })
    expect(ollama.prompts).toHaveLength(3)

    // A new checkpoint is a new answer to summarise.
    await synthesize(input(), options('records:3'))
    expect(ollama.prompts).toHaveLength(4)
  })

  it('does not ask the model when there is nothing to summarise', async () => {
    const before = ollama.prompts.length
    const outcome = await synthesize(input({ results: [], references: [], connections: [] }), options('records:9'))
    expect(outcome).toEqual({ synthesis: null, notice: expect.objectContaining({ reason: 'empty' }) })
    expect(ollama.prompts).toHaveLength(before)
  })
})
