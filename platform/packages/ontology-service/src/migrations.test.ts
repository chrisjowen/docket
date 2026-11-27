// SPDX-License-Identifier: AGPL-3.0-only
import { parseOntology } from '@docket/platform-canonical-store'
import { describe, expect, it } from 'vitest'

import { migrationProblems, migrationSteps, rewriteDocument } from './migrations.js'

const doc = `---
# kept: a comment in the frontmatter
id: service.orders
type: svc
title: Orders
attributes:
  tier: critical
  legacy: true
links:
  - rel: needs
    target: datasource.orders-db
evidence:
  - source: code
    path: src/db.ts
---
Body stays as it is.
`

const evidence = (applied: { op: string }[]) => ({ source: 'human', observedBy: 'alice', note: `v2: ${applied.map((a) => a.op).join(', ')}` })

describe('migrations', () => {
  it('rewrites only what they name, keeping comments, layout and the body, and add evidence', () => {
    const out = rewriteDocument(
      doc,
      [
        { op: 'renameType', from: 'svc', to: 'service' },
        { op: 'renameRelationship', from: 'needs', to: 'depends_on' },
        { op: 'dropAttribute', type: 'service', from: 'legacy' },
      ],
      evidence,
    )
    expect(out?.applied.map((step) => step.op)).toEqual(['renameType', 'renameRelationship', 'dropAttribute'])
    expect(out?.raw).toBe(`---
# kept: a comment in the frontmatter
id: service.orders
type: service
title: Orders
attributes:
  tier: critical
links:
  - rel: depends_on
    target: datasource.orders-db
evidence:
  - source: code
    path: src/db.ts
  - source: human
    observedBy: alice
    note: "v2: renameType, renameRelationship, dropAttribute"
---
Body stays as it is.
`)
  })

  it('leave a document they do not touch alone', () => {
    expect(rewriteDocument(doc, [{ op: 'renameType', from: 'pod', to: 'container' }], evidence)).toBeNull()
  })

  it('must name what the draft has', () => {
    const draft = parseOntology('version: 1\nresourceTypes:\n  service: {}\n  pod: {}\nrelationships:\n  depends_on: { from: "*", to: "*" }\n').ontology
    if (!draft) throw new Error('draft does not load')
    expect(
      migrationProblems(
        [
          { op: 'renameType', from: 'svc', to: 'nothing' },
          { op: 'renameType', from: 'pod', to: 'service' },
          { op: 'mapType', from: 'pod', to: 'service' },
          { op: 'renameRelationship', from: 'needs', to: 'depends_on' },
          { op: 'dropAttribute', from: 'legacy' },
        ],
        draft,
      ),
    ).toEqual([
      'renameType svc -> nothing: the draft has no type "nothing".',
      'renameType pod -> service: the draft still has type "pod"; map it instead, or remove it.',
      'dropAttribute undefined.legacy: say which type the attribute is dropped from.',
    ])
  })
})

describe('migrationSteps', () => {
  it('keeps the objects with an op, so a malformed step reads as a migration problem, not a crash', () => {
    const steps = migrationSteps([null, 'renameType', 3, { op: 'renameType', from: 'pod', to: 'container' }, { op: 'explode' }])
    expect(steps).toEqual([{ op: 'renameType', from: 'pod', to: 'container' }, { op: 'explode' }])
    expect(migrationProblems(steps ?? [], parseOntology('version: 1\nresourceTypes:\n  container: {}\n').ontology!)).toEqual([
      'Unknown migration "explode".',
    ])
  })

  it('reads no migration as none, and anything but a list as not a migration', () => {
    expect(migrationSteps(undefined)).toEqual([])
    expect(migrationSteps({ op: 'renameType' })).toBeNull()
  })
})
