import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CanonicalInput, DocumentInput, ObservationInput, ProjectionBatch } from '@docket/contracts'
import { validateCanonicalInput, validateProjectionBatch } from '@docket/contracts'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDocket } from '../adapters/docket.js'
import { writeManifest } from '../manifest/manifest.js'
import { init } from './init.js'
import { rebuild } from './rebuild.js'
import { sync, SyncError } from './sync.js'

let root: string

const INDEX = '.docket/.index'

const memoryFile = (id: string, type: string, body = 'Body.'): string =>
  `---\nid: ${id}\ntype: ${type}\ntitle: ${id}\n---\n\n${body}\n`

const write = (name: string, contents: string): Promise<void> =>
  writeFile(join(root, '.docket', 'notes', name), contents, 'utf8')

/** Every file in the index, keyed by index-relative path, so runs can be compared byte for byte. */
const indexFiles = async (): Promise<Record<string, string>> => {
  const dir = join(root, INDEX)
  const entries = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
  const contents: Record<string, string> = {}
  for (const entry of entries) {
    contents[entry] = await readFile(join(dir, entry), 'utf8')
  }
  return contents
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-sync-'))
  await init({ cwd: root })
})

describe('sync', () => {
  it('keeps each instance\'s manifest in state.dir whatever the projections write', async () => {
    await writeFile(
      join(root, '.docket.yaml'),
      'version: 1\nprojections:\n  - type: jsonl\n    output: .docket/.out\n'
    )
    await write('orders.md', memoryFile('service.orders', 'service'))
    await sync({ cwd: root })

    expect(await readdir(join(root, '.docket/.out'))).not.toContain('manifests')
    expect(await readdir(join(root, INDEX, 'manifests'))).toEqual(['jsonl.json'])
    expect((await sync({ cwd: root })).unchanged).toBe(1)
  })

  it('reprojects everything when the projections change, e.g. mem0 added', async () => {
    await write('orders.md', memoryFile('service.orders', 'service'))
    await sync({ cwd: root })

    await writeFile(
      join(root, '.docket.yaml'),
      'version: 1\nprojections:\n  - type: jsonl\n    output: .docket/.out\n'
    )
    const result = await sync({ cwd: root })

    // The unchanged file still reaches the new projection.
    expect(result.upserted).toEqual(['service.orders'])
    expect(await readFile(join(root, '.docket/.out/documents.jsonl'), 'utf8')).toContain(
      'service.orders'
    )
  })

  it('projects new documents and skips unchanged ones on the next run', async () => {
    await write('orders.md', memoryFile('service.orders', 'service'))
    await write('payments.md', memoryFile('team.payments', 'team'))

    const first = await sync({ cwd: root })
    expect(first.upserted.sort()).toEqual(['service.orders', 'team.payments'])
    expect(first.unchanged).toBe(0)

    const second = await sync({ cwd: root })
    expect(second.upserted).toEqual([])
    expect(second.removed).toEqual([])
    expect(second.unchanged).toBe(2)
  })

  it('reprojects a document whose contents changed', async () => {
    await write('orders.md', memoryFile('service.orders', 'service'))
    await sync({ cwd: root })

    await write('orders.md', memoryFile('service.orders', 'service', 'Rewritten.'))
    const result = await sync({ cwd: root })

    expect(result.upserted).toEqual(['service.orders'])
    expect(result.unchanged).toBe(0)
  })

  it('removes documents whose file is gone', async () => {
    await write('orders.md', memoryFile('service.orders', 'service'))
    await write('payments.md', memoryFile('team.payments', 'team'))
    await sync({ cwd: root })

    await rm(join(root, '.docket', 'notes', 'orders.md'))
    const result = await sync({ cwd: root })

    expect(result.removed).toEqual(['service.orders'])
    expect(result.unchanged).toBe(1)

    const documents = await readFile(join(root, INDEX, 'documents.jsonl'), 'utf8')
    expect(documents).not.toContain('service.orders')
    expect(documents).toContain('team.payments')
  })

  // Spec §67: a temporarily broken file must not erase what is already indexed.
  it('retains the projection of a file that stopped parsing', async () => {
    await write('orders.md', memoryFile('service.orders', 'service'))
    await sync({ cwd: root })

    await write('orders.md', '---\nid: service.orders\n---\nno title\n')
    const result = await sync({ cwd: root })

    expect(result.removed).toEqual([])
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    expect(
      await readFile(join(root, INDEX, 'documents.jsonl'), 'utf8')
    ).toContain('service.orders')
  })
})

describe('sync: files that share an id', () => {
  const nodes = async (): Promise<Record<string, unknown>[]> =>
    (await readFile(join(root, INDEX, 'nodes.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)

  const pod = (evidence: string): string =>
    `---\nid: pod.orders-api\ntype: pod\ntitle: Orders API\nevidence:\n${evidence}---\n`
  const IN_CODE = '  - source: code\n    path: src/k8s.ts\n    lines: 14-30\n'
  const RUNNING = '  - source: runtime\n    symbol: deployment/orders-api\n'

  it('projects them as one entity, and follows either file as it changes', async () => {
    await write('a.md', pod(IN_CODE))
    await write('b.md', pod(RUNNING))

    expect((await sync({ cwd: root })).upserted).toEqual(['pod.orders-api'])
    expect(await nodes()).toEqual([
      expect.objectContaining({ id: 'pod.orders-api', confidence: 0.93, evidenceCount: 2 })
    ])

    // Dropping one observation leaves the other, at the confidence it earns alone.
    await rm(join(root, '.docket', 'notes', 'b.md'))
    const after = await sync({ cwd: root })
    expect(after.upserted).toEqual(['pod.orders-api'])
    expect(after.removed).toEqual([])
    expect(await nodes()).toEqual([expect.objectContaining({ confidence: 0.3, evidenceCount: 1 })])

    await rm(join(root, '.docket', 'notes', 'a.md'))
    expect((await sync({ cwd: root })).removed).toEqual(['pod.orders-api'])
  })

  it('holds the merged entity while one of its files is broken (spec §67)', async () => {
    await write('a.md', pod(IN_CODE))
    await write('b.md', pod(RUNNING))
    await sync({ cwd: root })

    await write('b.md', '---\nid: pod.orders-api\n---\nno title\n')
    const result = await sync({ cwd: root })

    expect(result.upserted).toEqual([])
    expect(result.removed).toEqual([])
    expect(await nodes()).toEqual([expect.objectContaining({ confidence: 0.93 })])
  })

  it('reprojects when the ontology changes what evidence is worth', async () => {
    await write('a.md', pod(IN_CODE))
    await sync({ cwd: root })

    const ontology = join(root, '.docket', 'entities.yaml')
    const registry = await readFile(ontology, 'utf8')
    await writeFile(ontology, registry.replace(/(  pod:[\s\S]*?confidence:\n      code: )0\.3/, '$10.2'), 'utf8')

    expect((await sync({ cwd: root })).upserted).toEqual(['pod.orders-api'])
    expect(await nodes()).toEqual([expect.objectContaining({ confidence: 0.2 })])
  })
})

describe('rebuild', () => {
  // Spec §2.2 and §72: `rm -rf .docket/.index && docket rebuild` must restore
  // exactly what an incremental sync produced.
  it('produces byte-identical output to sync', async () => {
    await write('orders.md', memoryFile('service.orders', 'service'))
    await write('payments.md', memoryFile('team.payments', 'team'))
    await sync({ cwd: root })
    const synced = await indexFiles()

    await rm(join(root, INDEX), { recursive: true, force: true })
    const result = await rebuild({ cwd: root })

    expect(result.upserted.sort()).toEqual(['service.orders', 'team.payments'])
    expect(await indexFiles()).toEqual(synced)
  })

  it('drops records for documents that no longer exist', async () => {
    await write('orders.md', memoryFile('service.orders', 'service'))
    await sync({ cwd: root })

    await rm(join(root, '.docket', 'notes', 'orders.md'))
    await rebuild({ cwd: root })

    const files = await indexFiles()
    expect(files['documents.jsonl'] ?? '').toBe('')
    expect(JSON.parse(files['manifests/local.json'] ?? '{}')).toMatchObject({
      adapter: 'local',
      owners: {},
      records: { entity: {}, observation: {}, document: {} },
      version: 2
    })
  })
})

describe('sync: per-instance manifests and canonical inputs (adapter spec §8)', () => {
  const RECORDING = fileURLToPath(new URL('../../test/fixtures/adapters/recording.mjs', import.meta.url))

  const ORDERS = [
    '---',
    'id: service.orders',
    'type: service',
    'title: Orders',
    'evidence:',
    '  - source: code',
    '    path: src/orders.ts',
    '    lines: 12-40',
    '    symbol: OrdersRepository',
    '    observedAt: 2026-10-05',
    '    note: opens the pool',
    '  - source: code',
    '    path: src/main.ts',
    'links:',
    '  - rel: depends_on',
    '    target: datasource.orders-db',
    '    evidence:',
    '      - source: code',
    '        path: src/db.ts',
    '        lines: 3',
    '---',
    '',
    'Takes customer orders.',
    'Stores them in [[datasource.orders-db]].',
    ''
  ].join('\n')

  const ORDERS_DB = '---\nid: datasource.orders-db\ntype: datasource\ntitle: Orders DB\n---\n'

  /** A v2 config: the default local jsonl instance, then `extra`. */
  const configure = async (extra: string): Promise<void> => {
    await copyFile(RECORDING, join(root, 'recording.mjs'))
    await writeFile(
      join(root, '.docket.yaml'),
      `version: 2\nadapters:\n  - id: local\n    module: "@docket/adapter-jsonl"\n    config: { output: .docket/.index }\n${extra}`,
      'utf8'
    )
  }

  const recall = (config = '{ inputs: [observation, document] }'): string =>
    `  - id: recall\n    module: ./recording.mjs\n    roles: [projection]\n    config: ${config}\n`

  const stored = async (id = 'recall'): Promise<CanonicalInput[]> =>
    Object.values(
      JSON.parse(await readFile(join(root, INDEX, 'adapters', id, 'store.json'), 'utf8')) as Record<string, CanonicalInput>
    )

  const batches = async (id = 'recall'): Promise<(ProjectionBatch | { reset: string })[]> =>
    JSON.parse(await readFile(join(root, INDEX, 'adapters', id, 'batches.json'), 'utf8').catch(() => '[]')) as (
      | ProjectionBatch
      | { reset: string }
    )[]

  const manifest = async (id: string): Promise<Record<string, unknown> | undefined> =>
    readFile(join(root, INDEX, 'manifests', `${id}.json`), 'utf8').then(
      (raw) => JSON.parse(raw) as Record<string, unknown>,
      () => undefined
    )

  beforeEach(async () => {
    await write('orders.md', ORDERS)
    await write('orders-db.md', ORDERS_DB)
  })

  it('hands each instance only the kinds it declares, observations and documents included', async () => {
    await configure(recall())
    const result = await sync({ cwd: root })

    expect(result.adapters.map((report) => [report.id, report.inputs])).toEqual([
      ['local', ['entity']],
      ['recall', ['observation', 'document']]
    ])
    const records = await stored()
    expect([...new Set(records.map((record) => record.kind))].sort()).toEqual(['document', 'observation'])
    for (const record of records) expect(validateCanonicalInput(record)).toEqual(record)
    for (const batch of await batches()) if ('changes' in batch) validateProjectionBatch(batch)

    const observations = records.filter((record): record is ObservationInput => record.kind === 'observation')
    expect(observations.map((observation) => [observation.sources, observation.observedAt, observation.entityRefs])).toEqual([
      [[{ path: 'src/orders.ts', startLine: 12, endLine: 40 }], '2026-10-05', ['service.orders']],
      [[{ path: 'src/main.ts' }], undefined, ['service.orders']],
      [[{ path: 'src/db.ts', startLine: 3, endLine: 3 }], undefined, ['service.orders', 'datasource.orders-db']]
    ])
    // Canonical evidence records no event time, and a file's mtime is not one.
    expect(observations.some((observation) => 'eventAt' in observation)).toBe(false)
    expect(observations[0]).toMatchObject({
      id: expect.stringMatching(/^service\.orders#[0-9a-f]{16}$/),
      recordedIn: ['.docket/notes/orders.md'],
      text: 'service.orders (Orders) seen in code at src/orders.ts:12-40 OrdersRepository: opens the pool'
    })
    expect(observations[2]?.relationship).toEqual({ source: 'service.orders', rel: 'depends_on', target: 'datasource.orders-db' })

    const [document] = records.filter((record): record is DocumentInput => record.kind === 'document')
    expect(document).toMatchObject({
      id: '.docket/notes/orders.md',
      entityRefs: ['service.orders', 'datasource.orders-db'],
      text: 'Takes customer orders.\nStores them in [[datasource.orders-db]].'
    })
    // The span is the text's own lines of the file, at the revision it names.
    const lines = ORDERS.split('\n')
    const { startLine = 0, endLine = 0 } = document?.source ?? {}
    expect(lines.slice(startLine - 1, endLine).join('\n')).toBe(document?.text)
    expect(document?.revision).toMatch(/^sha256:/)
  })

  it('syncs only the instances --adapter names, and refuses one it cannot sync', async () => {
    await configure(recall())
    const result = await sync({ cwd: root, adapters: ['recall'] })

    expect(result.adapters.map((report) => report.id)).toEqual(['recall'])
    expect(await manifest('local')).toBeUndefined()
    expect(await manifest('recall')).toMatchObject({ adapter: 'recall' })
    await expect(sync({ cwd: root, adapters: ['nope'] })).rejects.toThrow(
      'No adapter instance "nope" is configured. Configured instances: local, recall.'
    )
  })

  it('replays nothing twice, and leaves no stale record after an update or a delete', async () => {
    await configure(recall())
    await sync({ cwd: root })
    const first = (await batches()).length

    expect((await sync({ cwd: root })).adapters[1]).toMatchObject({ upserted: [], removed: [], unchanged: 4 })
    expect(await batches()).toHaveLength(first)

    await write('orders.md', ORDERS.replace('opens the pool', 'opens the connection pool').replace('Takes customer', 'Takes'))
    const updated = (await sync({ cwd: root })).adapters[1]
    expect(updated?.upserted.map((ref) => ref.kind).sort()).toEqual(['document', 'observation'])
    expect(updated?.removed.map((ref) => ref.kind)).toEqual(['observation'])
    const records = await stored()
    expect(records).toHaveLength(4)
    expect(records.some((record) => 'text' in record && record.text.includes('opens the pool'))).toBe(false)

    await rm(join(root, '.docket', 'notes', 'orders.md'))
    await sync({ cwd: root })
    expect(await stored()).toEqual([])
  })

  it('records what a failing instance acknowledged and lets every other instance sync', async () => {
    await configure(recall())
    const state = join(root, INDEX, 'adapters', 'recall')
    await mkdir(state, { recursive: true })
    await writeFile(join(state, 'down'), '{}', 'utf8')
    const failure = await sync({ cwd: root }).catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(SyncError)
    const { result } = failure as SyncError
    expect(result.adapters.map((report) => [report.id, report.error])).toEqual([
      ['local', undefined],
      ['recall', 'connection refused']
    ])
    expect((failure as SyncError).message).toBe('sync failed for recall')
    expect(await manifest('local')).toMatchObject({ records: { entity: { 'service.orders': {} } } })
    expect((await manifest('recall'))?.records).toEqual({ entity: {}, observation: {}, document: {} })

    // Up again, but refusing the document: everything else is recorded, the document retried next time.
    await rm(join(state, 'down'))
    await writeFile(join(state, 'refuse.json'), JSON.stringify(['.docket/notes/orders.md']), 'utf8')
    const partial = ((await sync({ cwd: root }).catch((cause: unknown) => cause)) as SyncError).result.adapters[1]
    expect(partial?.failed).toEqual([{ kind: 'document', id: '.docket/notes/orders.md', retryable: false, message: 'refused' }])
    expect(Object.keys((await manifest('recall'))?.records as object)).toEqual(['document', 'entity', 'observation'])
    expect((await manifest('recall'))?.records).toMatchObject({ document: {} })

    await rm(join(state, 'refuse.json'))
    const healed = (await sync({ cwd: root })).adapters[1]
    expect(healed).toMatchObject({ origin: 'current', reset: false, unchanged: 3 })
    expect(healed?.upserted).toEqual([{ kind: 'document', id: '.docket/notes/orders.md' }])
  })

  it('rebuilds only the instance --adapter names, in its own namespace', async () => {
    await configure(recall())
    await sync({ cwd: root })
    const local = await readFile(join(root, INDEX, 'manifests', 'local.json'), 'utf8')

    const result = await rebuild({ cwd: root, adapters: ['recall'] })
    expect(result.adapters.map((report) => [report.id, report.origin, report.upserted.length])).toEqual([['recall', 'rebuilt', 4]])
    expect((await batches()).filter((batch) => 'reset' in batch)).toEqual([{ reset: 'default' }, { reset: 'default' }])
    expect(await readFile(join(root, INDEX, 'manifests', 'local.json'), 'utf8')).toBe(local)
  })

  it('resets and replays an instance whose configuration changed, and only it', async () => {
    await configure(recall())
    await sync({ cwd: root })

    await configure(recall('{ inputs: [observation, document], label: elsewhere }'))
    const result = await sync({ cwd: root })
    expect(result.adapters.map((report) => [report.id, report.origin, report.reset, report.upserted.length])).toEqual([
      ['local', 'current', false, 0],
      ['recall', 'reconfigured', true, 4]
    ])
  })

  it('carries the shared manifest of an earlier docket over without reprojecting anything', async () => {
    await writeFile(join(root, '.docket.yaml'), 'version: 1\nprojections:\n  - type: jsonl\n', 'utf8')
    await sync({ cwd: root })
    const migrated = await manifest('jsonl')
    const projected = await readFile(join(root, INDEX, 'documents.jsonl'), 'utf8')

    // What docket wrote before each instance kept its own manifest.
    const owners = migrated?.owners as Record<string, string[]>
    const entities = (migrated?.records as { entity: Record<string, { revision: string }> }).entity
    await rm(join(root, INDEX, 'manifests'), { recursive: true })
    await writeManifest(join(root, INDEX), {
      version: 1,
      projections: (await createDocket({ projectRoot: root })).projectionsFingerprint,
      documents: Object.fromEntries(
        Object.entries(entities).map(([id, { revision }]) => [id, { path: owners[id]![0]!, hash: revision }])
      )
    })

    const result = await sync({ cwd: root })
    expect(result.adapters.map((report) => [report.id, report.origin, report.reset])).toEqual([['jsonl', 'migrated', false]])
    expect(result.upserted).toEqual([])
    expect(result.unchanged).toBe(2)
    expect(await readFile(join(root, INDEX, 'documents.jsonl'), 'utf8')).toBe(projected)
    expect(await manifest('jsonl')).toEqual(migrated)
    expect(await readdir(join(root, INDEX))).not.toContain('manifest.json')
  })
})
