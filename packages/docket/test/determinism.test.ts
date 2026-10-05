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
  indexDigests,
  indexFiles,
  makeRepo,
  memory,
  readJsonl,
  removeRepo,
  write
} from './helpers.js'

/**
 * Rebuild determinism (spec §72) and the disposability guarantee (spec §2.2).
 *
 * The fixtures below are deliberately awkward: several resource types, links
 * carrying attributes, tags, non-ASCII titles and bodies, and frontmatter keys
 * written out of alphabetical order. Anything in the pipeline that leaks
 * insertion order, map iteration order or locale-sensitive collation into the
 * output shows up here.
 */

interface Fixture {
  /** Filename only - the tests place it under different directories. */
  name: string
  contents: string
}

const FIXTURES: Fixture[] = [
  {
    name: 'orders.md',
    contents: `---
title: Orders — API ✅
type: service
id: service.orders
tags:
  - core
  - ünicode
  - 日本語
attributes:
  lifecycle: active
  language: typescript
links:
  - rel: owned_by
    target: team.payments
  - rel: depends_on
    target: datasource.ledger
    attributes:
      runtime: true
      criticality: high
  - rel: depends_on
    target: system.stripe
    attributes:
      criticality: low
      runtime: false
---

Handles orders. Mentions [[team.payments]] and [[datasource.ledger]].

Unicode body: naïve café, 日本語, emoji ✅, RTL ‎עברית.
`
  },
  {
    name: 'payments.md',
    contents: `---
id: team.payments
type: team
title: Payments
---

The team that owns payments.
`
  },
  {
    name: 'ledger.md',
    contents: `---
type: datasource
id: datasource.ledger
attributes:
  zone: private
title: Ledger
---

Append-only ledger.
`
  },
  {
    name: 'stripe.md',
    contents: `---
id: system.stripe
type: system
title: Stripe
---

Third-party payment platform.
`
  },
  {
    name: 'event-sourcing.md',
    contents: `---
title: Use event sourcing for the ledger
links:
  - rel: supersedes
    target: decision.batch-nightly
  - rel: uses
    target: datasource.ledger
id: decision.event-sourcing
type: decision
provenance:
  confidence: 0.9
  authority: team
  capturedBy: claude
---

We chose event sourcing over nightly batch reconciliation.
`
  },
  {
    name: 'batch-nightly.md',
    contents: `---
id: decision.batch-nightly
type: decision
title: Reconcile nightly in batch
---

Superseded.
`
  },
  {
    name: 'money.md',
    contents: `---
id: library.money
type: library
title: money
attributes:
  package: '@acme/money'
  language: typescript
links:
  - rel: uses
    target: datasource.ledger
---

Fixed-point money arithmetic.
`
  },
  {
    name: 'production.md',
    contents: `---
id: environment.production
type: environment
title: Production
attributes:
  environmentType: production
---

Production environment.
`
  },
  {
    name: 'triage.md',
    contents: `---
id: agent.triage
type: agent
title: Triage agent
attributes:
  modes:
    - plan
    - act
  runtime: node
links:
  - rel: deployed_to
    target: environment.production
  - rel: owned_by
    target: team.payments
---

Triages incoming failures.
`
  },
  {
    name: 'pci.md',
    contents: `---
id: constraint.pci
type: constraint
title: Card data never leaves the PCI zone
index:
  graph: false
links:
  - rel: uses
    target: system.stripe
---

A constraint kept out of the graph on purpose (spec §21).
`
  }
]

/** Every id the fixtures declare, independently of anything the index says. */
const ALL_IDS = [
  'agent.triage',
  'constraint.pci',
  'datasource.ledger',
  'decision.batch-nightly',
  'decision.event-sourcing',
  'environment.production',
  'library.money',
  'service.orders',
  'system.stripe',
  'team.payments'
].sort()

/** Ids the fixtures expect in the graph: everything except `index.graph: false`. */
const GRAPH_IDS = ALL_IDS.filter((id) => id !== 'constraint.pci')

/** Links declared in frontmatter, minus the one on the non-graph document. */
const EXPECTED_EDGES = [
  'agent.triage deployed_to environment.production',
  'agent.triage owned_by team.payments',
  'decision.event-sourcing supersedes decision.batch-nightly',
  'decision.event-sourcing uses datasource.ledger',
  'library.money uses datasource.ledger',
  'service.orders depends_on datasource.ledger',
  'service.orders depends_on system.stripe',
  'service.orders owned_by team.payments'
].sort()

const describeEdge = (edge: EdgeRecord): string =>
  `${edge.source} ${edge.rel} ${edge.target}`

/** Lay the fixtures out under `directory`, optionally renaming them. */
const populate = async (
  root: string,
  directory: string,
  rename: (fixture: Fixture, index: number) => string = (f) => f.name
): Promise<void> => {
  for (const [index, fixture] of FIXTURES.entries()) {
    await write(root, join(directory, rename(fixture, index)), fixture.contents)
  }
}

const roots: string[] = []

const repo = async (): Promise<string> => {
  const root = await makeRepo('memory-determinism')
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRepo))
})

describe('rebuild determinism (spec §72)', () => {
  it('rebuilds byte-identically after the index is deleted', async () => {
    const root = await repo()
    await populate(root, '.docket/notes')

    expect((await memory(root, 'sync')).code).toBe(0)
    const before = await indexDigests(root)
    expect(Object.keys(before)).toEqual([
      'documents.jsonl',
      'edges.jsonl',
      'manifest.json',
      'nodes.jsonl'
    ])

    // The guarantee the README puts on its front page (spec §2.2).
    await rm(join(root, INDEX), { recursive: true, force: true })
    expect((await memory(root, 'rebuild')).code).toBe(0)

    const after = await indexDigests(root)
    expect(after).toEqual(before)
  })

  it('rebuilds byte-identically twice in a row', async () => {
    const root = await repo()
    await populate(root, '.docket/notes')

    await memory(root, 'sync')
    const first = await indexDigests(root)
    await memory(root, 'rebuild')
    const second = await indexDigests(root)
    await memory(root, 'rebuild')
    const third = await indexDigests(root)

    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('produces the same graph whatever order the files are scanned in', async () => {
    // The scan is path-ordered, so laying the same documents out under names
    // that sort the other way round feeds the projection in a different order.
    // Nothing but `path` may differ, since identity lives in the file.
    const forward = await repo()
    await populate(forward, '.docket/notes', (fixture, index) =>
      `${String(index).padStart(2, '0')}-${fixture.name}`
    )

    const reverse = await repo()
    await populate(reverse, '.docket/notes', (fixture, index) =>
      `${String(FIXTURES.length - index).padStart(2, '0')}-${fixture.name}`
    )

    expect((await memory(forward, 'sync')).code).toBe(0)
    expect((await memory(reverse, 'sync')).code).toBe(0)

    const a = await indexFiles(forward)
    const b = await indexFiles(reverse)

    expect(b['nodes.jsonl']).toBe(a['nodes.jsonl'])
    expect(b['edges.jsonl']).toBe(a['edges.jsonl'])

    const withoutPath = (records: DocumentRecord[]): unknown[] =>
      records.map(({ path, paths, ...rest }) => rest)
    expect(withoutPath(await readJsonl(reverse, 'documents.jsonl'))).toEqual(
      withoutPath(await readJsonl(forward, 'documents.jsonl'))
    )
  })

  it('produces the same graph whatever directories the files live in', async () => {
    // Identity is the id, never the path (README, spec §15), so moving every
    // document to a different directory must not move a single graph record.
    const flat = await repo()
    await populate(flat, '.docket/notes')

    const nested = await repo()
    await populate(nested, '.docket/resources/services')

    await memory(flat, 'sync')
    await memory(nested, 'sync')

    const a = await indexFiles(flat)
    const b = await indexFiles(nested)
    expect(b['nodes.jsonl']).toBe(a['nodes.jsonl'])
    expect(b['edges.jsonl']).toBe(a['edges.jsonl'])
  })

  it('makes an incremental sync converge on the same index as a rebuild', async () => {
    // A long-lived index is written one document at a time, in whatever order
    // edits happened. It must still equal the index a cold rebuild produces.
    const incremental = await repo()
    for (const fixture of [...FIXTURES].reverse()) {
      await write(incremental, join('.docket/notes', fixture.name), fixture.contents)
      await memory(incremental, 'sync')
    }
    // Churn: change a document, then put it back.
    const orders = join('.docket/notes', 'orders.md')
    await write(incremental, orders, '---\nid: service.orders\ntype: service\ntitle: Temporary\n---\n\nStale.\n')
    await memory(incremental, 'sync')
    await write(incremental, orders, FIXTURES[0]!.contents)
    await memory(incremental, 'sync')

    const cold = await repo()
    await populate(cold, '.docket/notes')
    await memory(cold, 'rebuild')

    expect(await indexFiles(incremental)).toEqual(await indexFiles(cold))
  })
})

describe('projections are disposable (spec §2.2)', () => {
  it('reproduces every canonical document, node and edge after rm -rf', async () => {
    const root = await repo()
    await populate(root, '.docket/notes')

    await rm(join(root, INDEX), { recursive: true, force: true })
    const result = await memory(root, 'rebuild')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('10 projected from scratch')

    // Checked against the fixtures, not against a previous run - two runs
    // agreeing on the wrong answer would still be wrong.
    const documents = await readJsonl<DocumentRecord>(root, 'documents.jsonl')
    expect(documents.map((d) => d.id)).toEqual(ALL_IDS)

    const nodes = await readJsonl<NodeRecord>(root, 'nodes.jsonl')
    expect(nodes.map((n) => n.id)).toEqual(GRAPH_IDS)

    const edges = await readJsonl<EdgeRecord>(root, 'edges.jsonl')
    expect(edges.map(describeEdge).sort()).toEqual(EXPECTED_EDGES)
    expect(
      edges.find((e) => e.target === 'datasource.ledger' && e.rel === 'depends_on')
        ?.attributes
    ).toEqual({ criticality: 'high', runtime: true })

    // Unicode survives the round trip through JSONL untouched.
    const orders = documents.find((d) => d.id === 'service.orders')
    expect(orders?.title).toBe('Orders — API ✅')
    expect(orders?.tags).toEqual(['core', 'ünicode', '日本語'])
    expect(orders?.content).toContain('naïve café, 日本語, emoji ✅')
  })

  it('recovers from a corrupted index rather than trusting it', async () => {
    const root = await repo()
    await populate(root, '.docket/notes')
    await memory(root, 'sync')
    const good = await indexDigests(root)

    await write(root, `${INDEX}/documents.jsonl`, 'not json at all\n')
    await write(root, `${INDEX}/manifest.json`, '{ broken')

    expect((await memory(root, 'rebuild')).code).toBe(0)
    expect(await indexDigests(root)).toEqual(good)
  })
})
