import { mkdtemp, readdir, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { GraphContract } from '../src/commands/graph.js'
import { readGraph } from '../src/open/graph.js'
import { makeRepo, memory, removeRepo, write } from './helpers.js'

/**
 * The shipped `docket graph --json`: the contract docs/graph-json.md
 * documents, which other tools read instead of parsing `.docket/` themselves.
 */

const EXAMPLE = fileURLToPath(new URL('../../../examples/acme-platform', import.meta.url))

/** Every file under `root` with its size and modification time, to prove nothing was written. */
const snapshot = async (root: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {}
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    const stats = await stat(path)
    files[relative(root, path)] = `${stats.size}:${stats.mtimeMs}`
  }
  return files
}

let scratch: string | undefined

afterEach(async () => {
  await removeRepo(scratch)
  scratch = undefined
})

const emptyDir = async (): Promise<string> => realpath(await mkdtemp(join(tmpdir(), 'docket-graph-e2e-')))

describe('docket graph --json', () => {
  it('prints the example graph as the versioned contract, without writing anything', async () => {
    // Run from a directory with no docket, so only --root can find the example's.
    scratch = await emptyDir()
    const before = await snapshot(EXAMPLE)

    const result = await memory(scratch, 'graph', '--json', '--root', EXAMPLE)

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const graph = JSON.parse(result.stdout) as GraphContract
    expect(graph.schema).toBe('docket.graph')
    expect(graph.version).toBe(1)
    expect(graph.project).toEqual({ name: 'acme-platform', root: EXAMPLE })
    expect(graph.entities).toHaveLength(21)
    expect(graph.edges).toHaveLength(37)
    expect(graph.diagnostics).toEqual([])
    expect(graph.index).toEqual({ synced: false, behind: 21 })

    // Every type carries the icon to draw it with.
    const service = graph.types.find((type) => type.name === 'service')
    expect(service?.icon).toEqual(expect.any(String))
    expect(graph.types.every((type) => type.icon.length > 0)).toBe(true)
    expect(graph.relationships.map((relationship) => relationship.name)).toContain('depends_on')

    // Links carry their computed confidence and basis, and evidence its survey date.
    const stripe = graph.edges.find(
      (edge) => edge.source === 'service.orders' && edge.rel === 'depends_on' && edge.target === 'system.stripe'
    )
    expect(stripe?.dangling).toBe(false)
    expect(stripe?.assessment).toMatchObject({ confidence: expect.any(Number), basis: 'evidence' })
    expect(stripe?.evidence?.some((evidence) => typeof evidence.observedAt === 'string')).toBe(true)
    expect(graph.edges.every((edge) => edge.assessment !== undefined)).toBe(true)
    expect(graph.entities.find((entity) => entity.id === 'service.orders')?.assessment?.basis).toEqual(
      expect.any(String)
    )

    // The same graph docket open serves, under the schema name and version.
    const { schema, version, ...served } = graph
    expect(served).toEqual(await readGraph(EXAMPLE))
    expect([schema, version]).toEqual(['docket.graph', 1])

    expect(await snapshot(EXAMPLE)).toEqual(before)
  })

  it('reports index lag and diagnostics in the JSON, and still succeeds', async () => {
    scratch = await makeRepo('docket-graph-e2e')
    await write(scratch, '.docket/resources/teams/payments.md', '---\nid: team.payments\ntype: team\ntitle: Payments\n---\n')
    expect((await memory(scratch, 'sync')).code).toBe(0)
    await write(scratch, '.docket/resources/broken.md', '---\nid: service.broken\ntype: nonsense\ntitle: Broken\n---\n')

    // Run from a subdirectory: like every command, it finds .docket.yaml above.
    const result = await memory(join(scratch, '.docket'), 'graph', '--json')

    expect(result.code).toBe(0)
    const graph = JSON.parse(result.stdout) as GraphContract
    expect(graph.project.root).toBe(scratch)
    expect(graph.entities.map((entity) => entity.id)).toEqual(['team.payments'])
    expect(graph.index).toEqual({ synced: true, behind: 0 })
    expect(graph.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', path: '.docket/resources/broken.md' })
    )
  })

  it('fails with nothing on stdout where there is no docket', async () => {
    scratch = await emptyDir()

    const result = await memory(scratch, 'graph', '--json')

    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('No .docket.yaml found')
    expect(await readdir(scratch)).toEqual([])
  })

  it('fails rather than searching upward from a --root that does not exist', async () => {
    scratch = await emptyDir()

    const result = await memory(EXAMPLE, 'graph', '--json', '--root', join(scratch, 'missing'))

    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('is not a directory')
  })

  it('fails with its usage and nothing on stdout without --json', async () => {
    const result = await memory(EXAMPLE, 'graph')

    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("required option '--json' not specified")
    expect(result.stderr).toContain('Usage: docket graph')
  })
})
