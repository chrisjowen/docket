import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { init } from '../commands/init.js'
import type { Diagnostic } from '../model/diagnostic.js'
import { ProjectionManager } from '../projection/manager.js'
import type { MemoryProjection } from '../projection/projection.js'
import { createReconciler, type WatchEvent } from './reconciler.js'

const memoryFile = (id: string, type: string, title: string): string =>
  `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\n---\n\nBody.\n`

interface Harness {
  resolved: ResolvedConfig
  projection: { upsert: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
  events: WatchEvent[]
  reconciler: ReturnType<typeof createReconciler>
  write(relativePath: string, contents: string): Promise<string>
  remove(relativePath: string): Promise<string>
}

const harness = async (): Promise<Harness> => {
  const root = await mkdtemp(join(tmpdir(), 'memory-reconciler-'))
  await init({ cwd: root })
  const resolved = await loadConfig(root)

  const projection = {
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {})
  }
  const manager = new ProjectionManager([
    { name: 'fake', ...projection } satisfies MemoryProjection
  ])
  const events: WatchEvent[] = []

  const path = (relativePath: string): string =>
    join(resolved.memoryRoot, relativePath)

  return {
    resolved,
    projection,
    events,
    reconciler: createReconciler(resolved, manager, (event) =>
      events.push(event)
    ),
    async write(relativePath, contents) {
      const file = path(relativePath)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, 'utf8')
      return file
    },
    async remove(relativePath) {
      const file = path(relativePath)
      await rm(file)
      return file
    }
  }
}

const diagnostics = (events: WatchEvent[]): Diagnostic[] =>
  events.flatMap((event) =>
    event.kind === 'diagnostics' ? event.diagnostics : []
  )

describe('createReconciler', () => {
  let h: Harness
  beforeEach(async () => {
    h = await harness()
  })

  it('projects a new file and reports it as added', async () => {
    const file = await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.reconciler.reconcile(file)

    expect(h.projection.upsert).toHaveBeenCalledTimes(1)
    expect(h.events).toContainEqual({
      kind: 'added',
      id: 'service.orders',
      path: '.memory/resources/services/orders.md'
    })
  })

  it('does nothing when the content hash is unchanged', async () => {
    const contents = memoryFile('service.orders', 'service', 'Orders')
    const file = await h.write('resources/services/orders.md', contents)

    await h.reconciler.reconcile(file)
    await h.write('resources/services/orders.md', contents)
    await h.reconciler.reconcile(file)

    expect(h.projection.upsert).toHaveBeenCalledTimes(1)
  })

  it('reprojects when the content changes', async () => {
    const file = await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.reconciler.reconcile(file)

    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Order Service')
    )
    await h.reconciler.reconcile(file)

    expect(h.projection.upsert).toHaveBeenCalledTimes(2)
    expect(h.events.at(-1)).toEqual({
      kind: 'updated',
      id: 'service.orders',
      path: '.memory/resources/services/orders.md'
    })
  })

  it('removes the old id when a file changes its id', async () => {
    const file = await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.reconciler.reconcile(file)

    await h.write(
      'resources/services/orders.md',
      memoryFile('service.ordering', 'service', 'Orders')
    )
    await h.reconciler.reconcile(file)

    expect(h.projection.remove).toHaveBeenCalledWith('service.orders')
    expect(h.projection.upsert.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'service.ordering'
    })
  })

  it('removes a deleted file by the id its path last projected', async () => {
    const file = await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.reconciler.reconcile(file)
    await h.remove('resources/services/orders.md')
    await h.reconciler.reconcile(file)

    expect(h.projection.remove).toHaveBeenCalledWith('service.orders')
    expect(h.events.at(-1)).toMatchObject({
      kind: 'removed',
      id: 'service.orders'
    })
  })

  it('keeps the projection when a moved id is re-registered before the unlink', async () => {
    const from = await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.reconciler.reconcile(from)

    // Move: the new path is reconciled first, then the old path's unlink
    // arrives. The resource must survive (spec §36).
    const to = await h.write(
      'resources/services/order-service.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.remove('resources/services/orders.md')
    await h.reconciler.reconcile(to)
    await h.reconciler.reconcile(from)

    expect(h.projection.remove).not.toHaveBeenCalled()
  })

  it('reports invalid frontmatter and retains the previous projection', async () => {
    const file = await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.reconciler.reconcile(file)

    await h.write(
      'resources/services/orders.md',
      '---\nid: service.orders\ntype: [unclosed\n---\n'
    )
    await h.reconciler.reconcile(file)

    expect(diagnostics(h.events).map((d) => d.code)).toContain(
      'invalid-frontmatter'
    )
    expect(h.projection.remove).not.toHaveBeenCalled()
    expect(h.projection.upsert).toHaveBeenCalledTimes(1)
  })

  it('reports an unregistered type and projects nothing', async () => {
    const file = await h.write(
      'notes/widget.md',
      memoryFile('widget.a', 'widget', 'A widget')
    )
    await h.reconciler.reconcile(file)

    expect(diagnostics(h.events).map((d) => d.code)).toContain('unknown-type')
    expect(h.projection.upsert).not.toHaveBeenCalled()
  })

  it('projects newly valid documents when the ontology gains a type', async () => {
    const file = await h.write(
      'notes/widget.md',
      memoryFile('widget.a', 'widget', 'A widget')
    )
    await h.reconciler.reconcile(file)
    expect(h.projection.upsert).not.toHaveBeenCalled()

    const registry = await readFile(h.resolved.ontologyPath, 'utf8')
    await writeFile(
      h.resolved.ontologyPath,
      registry.replace(
        'resourceTypes:\n',
        'resourceTypes:\n\n  widget:\n    description: A widget.\n'
      ),
      'utf8'
    )
    await h.reconciler.reconcileOntology()

    expect(h.events).toContainEqual({ kind: 'ontology-reloaded' })
    expect(h.projection.upsert.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'widget.a'
    })
  })

  it('keeps the previous registry when the ontology is unparseable', async () => {
    await h.reconciler.sync()
    await writeFile(h.resolved.ontologyPath, 'version: [1\n', 'utf8')
    await h.reconciler.reconcileOntology()

    expect(h.events).not.toContainEqual({ kind: 'ontology-reloaded' })
    expect(diagnostics(h.events).map((d) => d.code)).toContain(
      'ontology-parse-error'
    )

    // Still validating against the ontology loaded before the bad save.
    const file = await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.reconciler.reconcile(file)
    expect(h.projection.upsert).toHaveBeenCalledTimes(1)
  })

  it('sync removes ids whose file is gone but keeps broken ones', async () => {
    await h.write(
      'resources/services/orders.md',
      memoryFile('service.orders', 'service', 'Orders')
    )
    await h.write(
      'resources/services/billing.md',
      memoryFile('service.billing', 'service', 'Billing')
    )
    await h.reconciler.sync()
    expect(h.projection.upsert).toHaveBeenCalledTimes(2)

    await h.remove('resources/services/orders.md')
    await h.write('resources/services/billing.md', '---\nid: [\n---\n')
    await h.reconciler.sync()

    expect(h.projection.remove.mock.calls).toEqual([['service.orders']])
  })
})
