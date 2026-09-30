import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DOCUMENTS_FILENAME,
  EDGES_FILENAME,
  type DocumentRecord,
  type EdgeRecord
} from '../projection/file/file-projection.js'
import type { WatchEvent } from '../watcher/reconciler.js'
import { init } from './init.js'
import { watch, type WatchHandle } from './watch.js'

const memoryFile = (
  id: string,
  type: string,
  title: string,
  extra = ''
): string => `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\n${extra}---\n\nBody.\n`

/**
 * Watch tests are timing-sensitive, so they poll for the expected state instead
 * of sleeping for a guessed interval.
 */
const until = async <T>(
  check: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 10_000
): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

const handles: WatchHandle[] = []

interface Harness {
  root: string
  events: WatchEvent[]
  write(relativePath: string, contents: string): Promise<void>
  unlink(relativePath: string): Promise<void>
  documents(): Promise<DocumentRecord[]>
  edges(): Promise<EdgeRecord[]>
  start(): Promise<void>
}

const harness = async (): Promise<Harness> => {
  // The macOS temp dir is a symlink, and chokidar reports real paths.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'memory-watch-')))
  await init({ cwd: root })
  const events: WatchEvent[] = []

  const readIndex = async <T>(name: string): Promise<T[]> => {
    const raw = await readFile(join(root, '.memory/.index', name), 'utf8').catch(
      () => ''
    )
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T)
  }

  return {
    root,
    events,
    async write(relativePath, contents) {
      const file = join(root, '.memory', relativePath)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, 'utf8')
    },
    unlink: (relativePath) => rm(join(root, '.memory', relativePath)),
    documents: () => readIndex<DocumentRecord>(DOCUMENTS_FILENAME),
    edges: () => readIndex<EdgeRecord>(EDGES_FILENAME),
    async start() {
      handles.push(
        await watch({ cwd: root, report: (event) => { console.log('EV', root, JSON.stringify(event)); events.push(event) } })
      )
    }
  }
}

const documentIds = (h: Harness) => async (): Promise<string[]> =>
  (await h.documents()).map((record) => record.id)

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
})

describe('watch', () => {
  it('projects files that already existed before watching started', async () => {
    const h = await harness()
    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.start()

    expect(await documentIds(h)()).toEqual(['service.orders'])
  })

  it('projects a file added while watching', async () => {
    const h = await harness()
    await h.start()
    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )

    await until(
      async () => (await h.documents()).find((d) => d.id === 'service.orders'),
      'the new document to be projected'
    )
  })

  it('reprojects a file that is edited', async () => {
    const h = await harness()
    await h.start()
    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await until(
      async () => (await h.documents()).find((d) => d.id === 'service.orders'),
      'the initial projection'
    )

    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Order Service')
    )

    const record = await until(async () => {
      const found = (await h.documents()).find((d) => d.id === 'service.orders')
      return found?.title === 'Order Service' ? found : undefined
    }, 'the edited title to be projected')
    expect(record.title).toBe('Order Service')
  })

  it('removes a deleted file and its edges', async () => {
    const h = await harness()
    await h.write(
      'resources/teams/platform.md',
      memoryFile('team.platform', 'team', 'Platform')
    )
    await h.write(
      'resources/services/orders.md',
      memoryFile(
        'service.orders',
        'service',
        'Orders',
        'links:\n  - rel: owned_by\n    target: team.platform\n'
      )
    )
    await h.start()

    expect(await h.edges()).toEqual([
      { source: 'service.orders', rel: 'owned_by', target: 'team.platform' }
    ])

    await h.unlink('resources/services/orders.md')

    // The projection is flushed before the event is reported, so waiting on the
    // event means the files on disk have already settled.
    await until(
      () => h.events.find((event) => event.kind === 'removed'),
      'the removal to be reported'
    )
    expect(await documentIds(h)()).toEqual(['team.platform'])
    expect(await h.edges()).toEqual([])
    expect(h.events).toContainEqual({
      kind: 'removed',
      id: 'service.orders',
      path: '.memory/resources/services/orders.md'
    })
  })

  it('coalesces a burst of saves into one reconciliation', async () => {
    const h = await harness()
    await h.start()

    for (let i = 0; i < 5; i += 1) {
      await h.write(
        'resources/services/orders.md',
        memoryFile('service.orders', 'service', `Orders ${i}`)
      )
    }

    await until(
      () => h.events.find((event) => event.kind === 'added'),
      'the burst to be reconciled'
    )

    // One reconciliation, and it saw the last write - not the first.
    expect((await h.documents()).map((d) => d.title)).toEqual(['Orders 4'])
    expect(
      h.events.filter(
        (event) => event.kind === 'added' || event.kind === 'updated'
      )
    ).toEqual([
      {
        kind: 'added',
        id: 'service.orders',
        path: '.memory/resources/services/orders.md'
      }
    ])
  })

  it('survives an invalid intermediate save and recovers when it is fixed', async () => {
    const h = await harness()
    await h.start()
    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await until(
      async () => (await h.documents()).find((d) => d.id === 'service.orders'),
      'the initial projection'
    )

    await h.write(
      'resources/services/orders.md',
      '---\nid: service.orders\ntype: [unclosed\n---\n'
    )
    await until(
      () =>
        h.events.some(
          (event) =>
            event.kind === 'diagnostics' &&
            event.diagnostics.some((d) => d.code === 'invalid-frontmatter')
        ) || undefined,
      'the parse failure to be reported'
    )

    // Spec §67: the previously valid projection is retained, not erased.
    expect((await h.documents()).map((d) => d.id)).toEqual(['service.orders'])

    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Fixed')
    )
    const record = await until(async () => {
      const found = (await h.documents()).find((d) => d.id === 'service.orders')
      return found?.title === 'Fixed' ? found : undefined
    }, 'the fixed file to reconcile')
    expect(record.title).toBe('Fixed')
  })

  it('does not reproject a rewrite with identical content', async () => {
    const h = await harness()
    const contents = memoryFile('service.orders', 'service', 'Orders')
    await h.write('resources/services/orders.md', contents)
    await h.start()
    // The startup sync already projected it; only what watching does counts.
    h.events.length = 0

    await h.write('resources/services/orders.md', contents)
    // A later, genuinely new file is the sequencing point: once it lands, the
    // no-op rewrite has had its chance to produce an event and did not.
    await h.write(
      'resources/services/billing.md',
      memoryFile('service.billing', 'service', 'Billing')
    )

    // Polling the event rather than the file: the projection is flushed a tick
    // before the event is reported, so the file alone is not a settled state.
    await until(
      () => (h.events.length > 0 ? true : undefined),
      'the second document to be reported'
    )
    expect(h.events).toEqual([
      {
        kind: 'added',
        id: 'service.billing',
        path: '.memory/resources/services/billing.md'
      }
    ])
  })

  it('stops on abort', async () => {
    const h = await harness()
    const controller = new AbortController()
    const handle = await watch({ cwd: h.root, signal: controller.signal })
    controller.abort()
    await handle.close()

    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await new Promise((done) => setTimeout(done, 400))
    expect(await h.documents()).toEqual([])
  })
})
