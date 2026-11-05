import { describe, expect, it } from 'vitest'

import type { AdapterAnswer } from '@docket/contracts'

import { formatAnswer } from './ask.js'

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
