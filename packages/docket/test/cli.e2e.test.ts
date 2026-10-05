import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  DocumentRecord,
  EdgeRecord,
  NodeRecord
} from '../src/projection/jsonl/jsonl-projection.js'
import {
  INDEX,
  indexFiles,
  makeRepo,
  memory,
  readJsonl,
  removeRepo,
  write
} from './helpers.js'

/**
 * End-to-end coverage of the shipped `memory` binary against a real repository
 * on a real filesystem (spec §70). The unit tests already cover each module in
 * isolation; what is proved here is that `init`, `validate`, `sync`, `rebuild`
 * and `ontology` compose into the workflow the README documents, with the exit
 * codes spec §40 requires.
 */

const ORDERS = `---
id: service.orders
type: service
title: Orders API
tags:
  - core
attributes:
  language: typescript
  lifecycle: active
links:
  - rel: owned_by
    target: team.payments
  - rel: depends_on
    target: datasource.ledger
    attributes:
      criticality: high
      runtime: true
---

Handles orders. See [[team.payments]].
`

const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team.
`

const LEDGER = `---
id: datasource.ledger
type: datasource
title: Ledger
attributes:
  zone: private
---

The ledger.
`

let root: string | undefined

afterEach(async () => {
  await removeRepo(root)
  root = undefined
})

describe('memory CLI end to end', () => {
  it('runs init, validate and sync over a real repository', async () => {
    root = await makeRepo('memory-e2e')
    await write(root, '.docket/resources/services/orders.md', ORDERS)
    await write(root, '.docket/resources/teams/payments.md', PAYMENTS)
    await write(root, '.docket/resources/datasources/ledger.md', LEDGER)

    const validated = await memory(root, 'validate')
    expect(validated.code).toBe(0)
    expect(validated.stdout).toContain('3 resources')
    expect(validated.stdout).toContain('2 relationships')

    const synced = await memory(root, 'sync')
    expect(synced.code).toBe(0)
    expect(synced.stdout).toContain('3 projected')

    expect(Object.keys(await indexFiles(root))).toEqual([
      'documents.jsonl',
      'edges.jsonl',
      'manifest.json',
      'nodes.jsonl'
    ])

    const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
    expect(documents.map((d) => d.id)).toEqual([
      'datasource.ledger',
      'service.orders',
      'team.payments'
    ])
    // The source path is recorded, never the absolute one - the index must stay
    // diffable and machine-independent.
    expect(documents.every((d) => !d.path.startsWith('/'))).toBe(true)

    const nodes = await readJsonl<NodeRecord>(root, 'nodes.jsonl')
    expect(nodes.find((n) => n.id === 'service.orders')?.attributes).toEqual({
      language: 'typescript',
      lifecycle: 'active'
    })

    const edges = await readJsonl<EdgeRecord>(root, 'edges.jsonl')
    expect(edges).toEqual([
      {
        source: 'service.orders',
        rel: 'depends_on',
        target: 'datasource.ledger',
        attributes: { criticality: 'high', runtime: true },
        evidence: [],
        confidence: 0.5,
        basis: 'unevidenced',
        evidenceCount: 0,
        sources: []
      },
      {
        source: 'service.orders',
        rel: 'owned_by',
        target: 'team.payments',
        evidence: [],
        confidence: 0.5,
        basis: 'unevidenced',
        evidenceCount: 0,
        sources: []
      }
    ])
  })

  it('records where things were seen and projects the confidence their evidence earns', async () => {
    root = await makeRepo('memory-e2e')
    await write(
      root,
      '.docket/resources/pods/orders-api.md',
      `---
id: pod.orders-api
type: pod
title: Orders API pod
provenance:
  capturedBy: claude
evidence:
  - source: code
    path: services/orders/src/k8s.ts
    lines: 14-30
    symbol: ordersDeployment
    observedAt: 2026-10-05
    observedBy: claude
    note: Builds the Deployment manifest for the orders API.
links:
  - rel: depends_on
    target: secret.orders-db-password
    evidence:
      - source: code
        path: services/orders/src/k8s.ts
        lines: 22
        symbol: env.DB_PASSWORD
---

The pod that serves the orders API, built in code by \`ordersDeployment\`.
`
    )

    const validated = await memory(root, 'validate')
    expect(validated.code).toBe(0)
    expect(validated.stderr).not.toContain('missing-evidence')

    await memory(root, 'sync')
    const [pod] = await readJsonl<NodeRecord>(root, 'nodes.jsonl')
    // A pod read from code alone is not much to go on until something else confirms it.
    expect(pod).toMatchObject({ id: 'pod.orders-api', confidence: 0.3, basis: 'evidence', sources: ['code'] })
    expect(pod?.evidence[0]).toEqual({
      source: 'code',
      path: 'services/orders/src/k8s.ts',
      lines: '14-30',
      symbol: 'ordersDeployment',
      observedAt: '2026-10-05',
      observedBy: 'claude',
      note: 'Builds the Deployment manifest for the orders API.'
    })

    // Seen running, in a second file: the two are merged and corroborate each other.
    await write(
      root,
      '.docket/captured/orders-api-running.md',
      `---
id: pod.orders-api
type: pod
title: Orders API pod
evidence:
  - source: runtime
    symbol: deployment/orders-api
    urls:
      - https://k8s.example.com/ns/orders/deployments/orders-api
---
`
    )
    const resynced = await memory(root, 'sync')
    expect(resynced.stdout).toContain('1 projected')
    const nodes = await readJsonl<NodeRecord>(root, 'nodes.jsonl')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ confidence: 0.93, evidenceCount: 2, sources: ['code', 'runtime'] })
    const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
    expect(documents[0]?.paths).toEqual([
      '.docket/captured/orders-api-running.md',
      '.docket/resources/pods/orders-api.md'
    ])
  })

  it('rejects evidence that does not say where it was seen', async () => {
    root = await makeRepo('memory-e2e')
    await write(
      root,
      '.docket/resources/teams/payments.md',
      PAYMENTS.replace('title: Payments\n', 'title: Payments\nevidence:\n  - source: code\n')
    )

    const validated = await memory(root, 'validate')
    expect(validated.code).toBe(1)
    expect(validated.stderr).toContain('evidence-location-missing')
  })

  it('syncs incrementally and drops a document whose file is deleted', async () => {
    root = await makeRepo('memory-e2e')
    await write(root, '.docket/resources/services/orders.md', ORDERS)
    await write(root, '.docket/resources/teams/payments.md', PAYMENTS)
    await memory(root, 'sync')

    const unchanged = await memory(root, 'sync')
    expect(unchanged.stdout).toContain('0 projected, 0 removed, 2 unchanged')

    await rm(join(root, '.docket/resources/teams/payments.md'))
    const after = await memory(root, 'sync')
    expect(after.code).toBe(0)
    expect(after.stdout).toContain('0 projected, 1 removed')

    const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
    expect(documents.map((d) => d.id)).toEqual(['service.orders'])
    // The link survives as a now-dangling edge: §17 expects the graph to be
    // built incrementally, so a missing target is a warning, not a deletion.
    const edges = await readJsonl<EdgeRecord>(root, 'edges.jsonl')
    expect(edges.map((e) => e.target)).toContain('team.payments')
  })

  it('warns on a dangling reference but only fails under --strict (spec §40)', async () => {
    root = await makeRepo('memory-e2e')
    await write(root, '.docket/resources/services/orders.md', ORDERS)

    const lenient = await memory(root, 'validate')
    expect(lenient.code).toBe(0)
    expect(lenient.stdout).toContain('2 unresolved relationships')
    expect(lenient.stderr).toContain('dangling-reference')

    const strict = await memory(root, 'validate', '--strict')
    expect(strict.code).toBe(1)
    expect(strict.stderr).toContain('dangling-reference')
  })

  it('exits non-zero on a structural failure and projects nothing for that file', async () => {
    root = await makeRepo('memory-e2e')
    await write(root, '.docket/resources/teams/payments.md', PAYMENTS)
    await write(root, '.docket/notes/broken.md', '---\ntype: note\n---\n\nNo id.\n')

    const validated = await memory(root, 'validate')
    expect(validated.code).toBe(1)
    expect(validated.stderr).toContain('invalid-frontmatter')

    const synced = await memory(root, 'sync')
    expect(synced.code).toBe(1)

    const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
    expect(documents.map((d) => d.id)).toEqual(['team.payments'])
  })

  it('merges files that declare the same id, and rejects one of another type (spec §66)', async () => {
    root = await makeRepo('memory-e2e')
    await write(root, '.docket/resources/teams/a.md', PAYMENTS)
    await write(root, '.docket/resources/teams/b.md', PAYMENTS)

    const validated = await memory(root, 'validate')
    expect(validated.code).toBe(0)
    expect(validated.stdout).toContain('1 resources from 2 files')

    await memory(root, 'sync')
    const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
    expect(documents.map((d) => [d.id, d.paths])).toEqual([
      ['team.payments', ['.docket/resources/teams/a.md', '.docket/resources/teams/b.md']]
    ])

    await write(root, '.docket/resources/teams/c.md', PAYMENTS.replace('type: team', 'type: service'))
    const conflicting = await memory(root, 'validate')
    expect(conflicting.code).toBe(1)
    expect(conflicting.stderr).toContain('conflicting-type')
  })

  it('inspects the repository-owned ontology (spec §41)', async () => {
    root = await makeRepo('memory-e2e')

    const list = await memory(root, 'ontology', 'list')
    expect(list.code).toBe(0)
    expect(list.stdout).toContain('.docket/entities.yaml')
    expect(list.stdout).toMatch(/service\s/)
    expect(list.stdout).toContain('owned_by')

    const shown = await memory(root, 'ontology', 'show', 'service')
    expect(shown.code).toBe(0)
    expect(shown.stdout).toContain('lifecycle')
    expect(shown.stdout).toContain('owned_by')

    const missing = await memory(root, 'ontology', 'show', 'nonesuch')
    expect(missing.code).toBe(1)
  })

  it('refuses to run outside an initialized repository', async () => {
    root = await makeRepo('memory-e2e')
    await rm(join(root, '.docket.yaml'))

    const result = await memory(root, 'sync')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('docket init')
  })

  it('rebuilds into an index directory that does not exist yet', async () => {
    root = await makeRepo('memory-e2e')
    await write(root, '.docket/resources/teams/payments.md', PAYMENTS)
    await rm(join(root, INDEX), { recursive: true, force: true })

    const result = await memory(root, 'rebuild')
    expect(result.code).toBe(0)

    const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
    expect(documents.map((d) => d.id)).toEqual(['team.payments'])
  })
})
