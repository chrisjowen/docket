import { spawn } from 'node:child_process'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { watch, type WatchHandle } from '../src/commands/watch.js'
import type {
  DocumentRecord,
  EdgeRecord,
  NodeRecord
} from '../src/projection/jsonl/jsonl-projection.js'
import type { WatchEvent } from '../src/watcher/reconciler.js'
import {
  CLI,
  makeRepo,
  memory,
  probeWatcherReady,
  readJsonl,
  removeRepo,
  until,
  write
} from './helpers.js'

/**
 * Watcher integration tests (spec §71). These drive a real chokidar watcher
 * over a real temp repository created by the real `docket init`, and assert on
 * the index files as they land on disk - the full loop, not the reconciler in
 * isolation, which `src/watcher/reconciler.test.ts` already covers.
 *
 * Everything timing-dependent polls for the expected state; nothing sleeps for
 * a guessed interval.
 */

const NOTES = '.docket/notes'

const file = (
  id: string,
  type: string,
  title: string,
  extra = ''
): string => `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\n${extra}---\n\nBody of ${title}.\n`

interface Harness {
  root: string
  events: WatchEvent[]
  start(): Promise<void>
  documents(): Promise<DocumentRecord[]>
  nodes(): Promise<NodeRecord[]>
  edges(): Promise<EdgeRecord[]>
  /** Poll the index until `predicate` holds, then return the documents. */
  awaitDocuments(
    predicate: (documents: DocumentRecord[]) => boolean,
    what: string
  ): Promise<DocumentRecord[]>
}

const handles: WatchHandle[] = []
const roots: string[] = []

const harness = async (): Promise<Harness> => {
  const root = await makeRepo('memory-watch-e2e')
  roots.push(root)
  const events: WatchEvent[] = []

  const documents = (): Promise<DocumentRecord[]> =>
    readJsonl<DocumentRecord>(root, 'documents.jsonl')

  return {
    root,
    events,
    async start() {
      const handle = await watch({
        cwd: root,
        report: (event) => void events.push(event)
      })
      handles.push(handle)
      // `watch()` only returns once events are flowing (issue #10).
      events.length = 0
    },
    documents,
    nodes: () => readJsonl<NodeRecord>(root, 'nodes.jsonl'),
    edges: () => readJsonl<EdgeRecord>(root, 'edges.jsonl'),
    awaitDocuments: (predicate, what) =>
      until(async () => {
        const current = await documents()
        return predicate(current) ? current : undefined
      }, what)
  }
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
  await Promise.all(roots.splice(0).map(removeRepo))
})

describe('docket watch over a real repository (spec §71)', () => {
  it('follows create, edit and delete all the way into the index', async () => {
    const h = await harness()
    await h.start()

    // create
    await write(h.root, `${NOTES}/orders.md`, file('service.orders', 'service', 'Orders'))
    await h.awaitDocuments((d) => d.length === 1, 'the created document to be indexed')
    // The three JSONL files are replaced independently, so documents can land
    // a moment before nodes.
    await until(
      async () => ((await h.nodes()).map((n) => n.title).join() === 'Orders' ? true : undefined),
      'the created node to be indexed'
    )

    // edit - a new title and a new link
    await write(
      h.root,
      `${NOTES}/orders.md`,
      file(
        'service.orders',
        'service',
        'Orders API',
        'links:\n  - rel: owned_by\n    target: team.payments\n'
      )
    )
    await h.awaitDocuments(
      (d) => d[0]?.title === 'Orders API',
      'the edit to reach the index'
    )
    await until(
      async () => ((await h.edges()).length === 1 ? true : undefined),
      'the new link to become an edge'
    )
    // Still one document: an edit must replace, never duplicate.
    expect(await h.documents()).toHaveLength(1)

    // delete
    await rm(join(h.root, NOTES, 'orders.md'))
    await h.awaitDocuments((d) => d.length === 0, 'the deletion to reach the index')
    expect(await h.nodes()).toEqual([])
    expect(await h.edges()).toEqual([])
  })

  it('survives the editor save dance: temp file, unlink, rename (spec §71)', async () => {
    const h = await harness()
    await write(h.root, `${NOTES}/orders.md`, file('service.orders', 'service', 'Orders'))
    await h.start()
    expect(await h.documents()).toHaveLength(1)

    // What an editor with atomic saves does: write a sibling temp file, remove
    // the original, then rename the temp over it. The watcher sees an unlink
    // and an add on the same path and must end up with one correct document.
    const target = join(h.root, NOTES, 'orders.md')
    const temporary = `${target}.tmp`
    await writeFile(temporary, file('service.orders', 'service', 'Orders Rewritten'), 'utf8')
    await rm(target)
    await rename(temporary, target)

    const documents = await h.awaitDocuments(
      (d) => d.length === 1 && d[0]?.title === 'Orders Rewritten',
      'the rewritten document after the save dance'
    )
    expect(documents[0]?.id).toBe('service.orders')
    expect(await h.nodes()).toHaveLength(1)
  })

  it('keeps identity when a file moves to another directory (spec §15)', async () => {
    const h = await harness()
    await write(h.root, `${NOTES}/orders.md`, file('service.orders', 'service', 'Orders'))
    await h.start()

    await rename(
      join(h.root, NOTES, 'orders.md'),
      join(h.root, '.docket/resources/services/orders.md')
    )

    const documents = await h.awaitDocuments(
      (d) => d.length === 1 && d[0]?.path.includes('resources/services') === true,
      'the moved document to be re-registered under its new path'
    )
    expect(documents[0]?.id).toBe('service.orders')
    // The resource was never deleted and recreated, only re-registered.
    expect(await h.nodes()).toHaveLength(1)
  })

  it('picks up a batch of files landing at once, as a git pull would (spec §2.5)', async () => {
    const h = await harness()
    await h.start()

    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        write(h.root, `${NOTES}/${name}.md`, file(`decision.${name}`, 'decision', name))
      )
    )

    const documents = await h.awaitDocuments(
      (d) => d.length === 5,
      'all five pulled documents to be indexed'
    )
    expect(documents.map((d) => d.id)).toEqual([
      'decision.a',
      'decision.b',
      'decision.c',
      'decision.d',
      'decision.e'
    ])
  })

  it('reprojects newly valid documents when the ontology gains a type (spec §37)', async () => {
    const h = await harness()
    await h.start()

    // The type is unregistered, so the file is reported and nothing is projected.
    await write(h.root, `${NOTES}/experiment.md`, file('chaos_experiment.latency', 'chaos_experiment', 'Latency experiment'))
    await until(
      () =>
        h.events.some(
          (e) =>
            e.kind === 'diagnostics' &&
            e.diagnostics.some((d) => d.code === 'unknown-type')
        ) || undefined,
      'the unregistered type to be reported'
    )
    expect(await h.documents()).toEqual([])

    const ontologyPath = join(h.root, '.docket/entities.yaml')
    const ontology = await readFile(ontologyPath, 'utf8')
    await writeFile(
      ontologyPath,
      ontology.replace(
        '\nrelationships:',
        '\n  chaos_experiment:\n    description: A planned fault-injection experiment.\n\nrelationships:'
      ),
      'utf8'
    )

    const documents = await h.awaitDocuments(
      (d) => d.length === 1,
      'the document to be projected once its type is registered'
    )
    expect(documents[0]?.id).toBe('chaos_experiment.latency')
  })

  it('runs as the real `docket watch` process and shuts down cleanly on SIGTERM', async () => {
    const root = await makeRepo('memory-watch-cli')
    roots.push(root)

    const child = spawn(process.execPath, [CLI, 'watch'], { cwd: root })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    const exited = new Promise<number | null>((done) =>
      child.once('exit', (code) => done(code))
    )

    try {
      await until(
        () => (output.includes('watching') ? true : undefined),
        'the watch process to report that it started'
      )
      await probeWatcherReady(root, () => output.includes('ontology reloaded'))

      await write(root, `${NOTES}/orders.md`, file('service.orders', 'service', 'Orders'))
      await until(async () => {
        const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
        return documents.length === 1 ? true : undefined
      }, 'the watch process to index the new file')
    } finally {
      child.kill('SIGTERM')
    }

    // Ctrl-C must flush and close rather than abandon a half-written index.
    expect(await exited).toBe(0)
    expect(await readJsonl<DocumentRecord>(root, 'documents.jsonl')).toHaveLength(1)
  })

  it('leaves the index consistent with a fresh sync after the watcher stops', async () => {
    const h = await harness()
    await h.start()
    await write(h.root, `${NOTES}/orders.md`, file('service.orders', 'service', 'Orders'))
    await write(h.root, `${NOTES}/payments.md`, file('team.payments', 'team', 'Payments'))
    await h.awaitDocuments((d) => d.length === 2, 'both documents to be indexed')

    await Promise.all(handles.splice(0).map((handle) => handle.close()))

    // Nothing is left for a reconciliation pass to do, and a rebuild agrees.
    const result = await memory(h.root, 'sync')
    expect(result.stdout).toContain('0 projected, 0 removed, 2 unchanged')

    const watched = await h.documents()
    await memory(h.root, 'rebuild')
    expect(await h.documents()).toEqual(watched)
  })
})
