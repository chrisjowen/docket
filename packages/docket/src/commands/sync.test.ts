import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { init } from './init.js'
import { rebuild } from './rebuild.js'
import { sync } from './sync.js'

let root: string

const INDEX = '.docket/.index'

const memoryFile = (id: string, type: string, body = 'Body.'): string =>
  `---\nid: ${id}\ntype: ${type}\ntitle: ${id}\n---\n\n${body}\n`

const write = (name: string, contents: string): Promise<void> =>
  writeFile(join(root, '.docket', 'notes', name), contents, 'utf8')

/** Every file in the index, keyed by name, so runs can be compared byte for byte. */
const indexFiles = async (): Promise<Record<string, string>> => {
  const dir = join(root, INDEX)
  const entries = (await readdir(dir)).sort()
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
  it('keeps the manifest in state.dir whatever the projections write', async () => {
    await writeFile(
      join(root, '.docket.yaml'),
      'version: 1\nprojections:\n  - type: jsonl\n    output: .docket/.out\n'
    )
    await write('orders.md', memoryFile('service.orders', 'service'))
    await sync({ cwd: root })

    expect(await readdir(join(root, '.docket/.out'))).not.toContain('manifest.json')
    expect(await readdir(join(root, INDEX))).toContain('manifest.json')
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
    expect(JSON.parse(files['manifest.json'] ?? '{}')).toMatchObject({
      documents: {},
      version: 1
    })
  })
})
