import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AdapterAnswer } from '@docket/contracts'

import { askCommand, formatAnswer } from './ask.js'
import { init } from './init.js'
import { sync } from './sync.js'

const answer = (coverage: AdapterAnswer['coverage']): AdapterAnswer => ({
  interpretation: { description: 'Read-only Cypher', assumptions: [], nativeQuery: 'MATCH (d {scope: $scope}) RETURN count(d) AS n' },
  blocks: [{ kind: 'metric', id: 'graph:metric-1', label: 'n', value: 4, evidenceIds: [] }],
  evidence: [],
  coverage,
  diagnostics: []
})

const lines = (coverage: AdapterAnswer['coverage']): string[] =>
  formatAnswer({
    requestId: 'r',
    question: 'How many deployments?',
    results: [{ adapter: 'graph', state: 'answered', answer: answer(coverage) }],
    synthesis: null,
    diagnostics: []
  })

describe('formatAnswer', () => {
  it('says when a result came from an unverified model-written query', () => {
    const unverifiedQuery = { text: 'MATCH (d {scope: $scope}) RETURN count(d) AS n', writtenBy: 'Ollama qwen', undirectedRetry: false }
    expect(lines({ mode: 'unknown', truncated: false, scope: 'default', unverifiedQuery })).toContain(
      'graph  coverage unknown, unverified query by Ollama qwen'
    )
    expect(lines({ mode: 'exhaustive', truncated: false, scope: 'default' })).toContain('graph  every match')
  })
})

const team = (id: string, title: string, body: string): string => `---\nid: ${id}\ntype: team\ntitle: ${title}\n---\n\n${body}\n`

const SUPERSESSIONS = `supersessions:
  - id: s1
    resource: team.payments
    supersededBy: team.money
    validUntil: "2026-11-01T00:00:00.000Z"
    source: agent
    recordedBy: test
    recordedAt: "2026-11-01T00:00:00.000Z"
    reason: The team was renamed.
    evidence: [{ source: human }]
`

describe('docket ask', () => {
  it('ranks a superseded record after its replacement, and says it is out of date', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docket-ask-'))
    try {
      await init({ cwd: root })
      await mkdir(join(root, '.docket/resources/teams'), { recursive: true })
      await writeFile(join(root, '.docket/resources/teams/payments.md'), team('team.payments', 'Payments', 'The payments team owns payments.'), 'utf8')
      await writeFile(join(root, '.docket/resources/teams/money.md'), team('team.money', 'Money Movement', 'Formerly the payments team.'), 'utf8')
      await sync({ cwd: root })
      const entityOrder = (answer: Awaited<ReturnType<typeof askCommand>>): string[] =>
        answer.results.flatMap((result) =>
          result.state === 'answered' ? result.answer.blocks.flatMap((block) => (block.kind === 'entities' ? block.entities.map((item) => item.ref.id) : [])) : []
        )

      const before = await askCommand('payments', { cwd: root, synthesis: false })
      expect(entityOrder(before)).toEqual(['team.payments', 'team.money'])
      expect(before.changes).toBeUndefined()

      await writeFile(join(root, '.docket/supersessions.yaml'), SUPERSESSIONS, 'utf8')
      const after = await askCommand('payments', { cwd: root, synthesis: false })
      expect(entityOrder(after)).toEqual(['team.money', 'team.payments'])
      expect(after.references?.map((reference) => reference.id)).toEqual(['team.money', 'team.payments'])
      expect(after.changes).toEqual([
        expect.objectContaining({ id: 'team.payments', supersededBy: 'team.money', current: { id: 'team.money', type: 'team', title: 'Money Movement' }, since: '2026-11-01' })
      ])
      const lines = formatAnswer(after)
      expect(lines).toContain('Changed since recorded - never present these as current:')
      expect(lines).toContain('  Out of date: "Payments" (team.payments) is superseded by "Money Movement" (team.money) since 2026-11-01. The team was renamed.')
      expect(lines.find((line) => line.trim().startsWith('team.payments'))).toMatch(/out of date$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
