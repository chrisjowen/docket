import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { init } from './init.js'
import { formatWhy, why } from './why.js'

let root: string

const POD = `---
id: pod.orders-api
type: pod
title: Orders API pod
evidence:
  - source: code
    path: deploy/orders.yaml
  - source: code
    path: deploy/orders-canary.yaml
  - source: runtime
    symbol: orders-api-7d9f
links:
  - rel: deployed_to
    target: environment.prod
---

Body.
`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-why-'))
  await init({ cwd: root })
  await writeFile(join(root, '.docket', 'notes', 'pod.md'), POD, 'utf8')
})

describe('why', () => {
  it('explains each observation: the policy that priced it, and which ones count', async () => {
    const result = await why('pod.orders-api', { cwd: root })
    expect(result.resource).toMatchObject({ type: 'pod', confidence: 0.93, band: 'established', basis: 'evidence' })
    expect(result.resource?.observations.map((observation) => [observation.base?.policy, observation.score, observation.counts])).toEqual([
      ['code evidence of pod', 0.3, true],
      ['code evidence of pod', 0.3, false],
      ['runtime evidence of pod', 0.9, true]
    ])
    expect(result.resource?.observations[0]?.beaten).toEqual([{ policy: 'code evidence', score: 0.6 }])
    expect(result.links).toEqual([
      expect.objectContaining({ rel: 'deployed_to', target: 'environment.prod', basis: 'unevidenced', confidence: 0.5, band: 'probable' })
    ])

    const text = formatWhy(result)
    expect(text).toContain('confidence 0.93, established')
    expect(text).toContain('0.30  "code evidence of pod"')
    expect(text).toContain('(beat "code evidence" at 0.60)')
    expect(text).toContain('does not count')
    expect(text).toContain('1 − (1 − 0.30) × (1 − 0.90) = 0.93')
    expect(text).toContain("no evidence: the ontology's default")
  })

  it('shows a policy edit in the next explanation: confidence is computed when read', async () => {
    const ontology = join(root, '.docket', 'entities.yaml')
    const registry = await readFile(ontology, 'utf8')
    await writeFile(
      ontology,
      registry.replace('    - name: runtime evidence of pod\n', '    - name: Only in tests\n      when: { source: code, "@path": { matches: "**/*-canary.*" } }\n      adjust: -0.2\n    - name: runtime evidence of pod\n'),
      'utf8'
    )
    const result = await why('pod.orders-api', { cwd: root })
    expect(result.resource?.observations[1]).toMatchObject({ score: 0.1, adjustments: [{ policy: 'Only in tests', adjust: -0.2 }] })
    expect(formatWhy(result)).toContain('−0.20  "Only in tests"')
  })

  it('says so when no valid resource has the id', async () => {
    const result = await why('pod.missing', { cwd: root })
    expect(result.resource).toBeUndefined()
    expect(formatWhy(result)).toBe('No valid resource "pod.missing" was found.')
  })
})
