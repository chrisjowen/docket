import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
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
  start(signal?: AbortSignal): Promise<WatchHandle>
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
    async start(signal) {
      const handle = await watch({
        cwd: root,
        report: (event) => events.push(event),
        signal
      })
      handles.push(handle)
      // No readiness probe: `watch()` only returns once events are flowing
      // (issue #10), which is exactly what these tests rely on.
      events.length = 0
      return handle
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

  it('reports that it is watching before the initial sync output (issue #11)', async () => {
    const h = await harness()
    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    const events: WatchEvent[] = []
    handles.push(await watch({ cwd: h.root, report: (event) => events.push(event) }))

    expect(events.map((event) => event.kind)).toEqual(['watching', 'added'])
    expect(events[0]).toEqual({ kind: 'watching', root: join(h.root, '.memory') })
  })

  it('cleans up its delivery probe', async () => {
    const h = await harness()
    await h.start()

    expect(
      (await readdir(join(h.root, '.memory'))).filter((name) =>
        name.startsWith('.watch-probe')
      )
    ).toEqual([])
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

  it('treats an editor atomic save as a single change', async () => {
    const h = await harness()
    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.start()

    // What an editor really does: write a temporary file, unlink the original,
    // rename over it (spec §35, §71). Chokidar sees unlink then add.
    const file = join(h.root, '.memory/resources/services/orders.md')
    await writeFile(
      `${file}.tmp`,
      memoryFile('service.orders', 'service', 'Saved'),
      'utf8'
    )
    await rm(file)
    await rename(`${file}.tmp`, file)

    await until(
      () => h.events.find((event) => event.kind === 'updated'),
      'the save to be reconciled'
    )
    expect((await h.documents()).map((d) => d.title)).toEqual(['Saved'])
    expect(h.events).toHaveLength(1)
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

  it('ignores paths outside the configured include and exclude', async () => {
    const h = await harness()
    await h.start()

    await h.write('notes/draft.txt', 'not a memory file')
    await h.write(
      '.index/stray.md',
      memoryFile('service.stray', 'service', 'Stray')
    )
    await h.write(
      'resources/services/billing.md',
      memoryFile('service.billing', 'service', 'Billing')
    )

    await until(
      () => (h.events.length > 0 ? true : undefined),
      'the one included file to be reported'
    )
    expect(h.events).toEqual([
      {
        kind: 'added',
        id: 'service.billing',
        path: '.memory/resources/services/billing.md'
      }
    ])
  })

  it('stops watching on abort', async () => {
    const h = await harness()
    const controller = new AbortController()
    const handle = await h.start(controller.signal)
    controller.abort()
    await handle.close()

    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    // Nothing to wait for, so this is the one place a settle is unavoidable:
    // comfortably longer than the debounce the stopped watcher would have used.
    await new Promise((done) => setTimeout(done, 1000))
    expect(await h.documents()).toEqual([])
    expect(h.events).toEqual([])
  })
})
