import { describe, expect, it } from 'vitest'
import { hashContent } from './hashing.js'
import { parseMemoryFile } from './parser.js'

const MINIMAL = `---
id: service.conversation-api
type: service
title: Conversation API
---

# Conversation API

Handles conversation persistence and retrieval.
`

// Spec §14.
const FULL = `---
id: agent.research-assistant
type: agent
title: Research Assistant

tags:
  - research
  - agents

attributes:
  package: RA.agent
  runtime: in-process
  modes:
    - fast
    - slow

links:
  - rel: uses
    target: datasource.public-market-1

  - rel: uses
    target: datasource.private-market-3

  - rel: owned_by
    target: team.research-platform

provenance:
  authority: repo
  confidence: 1.0
  capturedBy: human

index:
  graph: true
  fts: true
  vector: true
---

# Research Assistant

The Research Assistant performs research across public and private market data.
`

describe('parseMemoryFile', () => {
  it('normalizes omitted optional fields on a minimal file', () => {
    const { document, diagnostics } = parseMemoryFile(MINIMAL, 'a/foo.md')
    expect(diagnostics).toEqual([])
    expect(document).toMatchObject({
      id: 'service.conversation-api',
      type: 'service',
      title: 'Conversation API',
      path: 'a/foo.md',
      tags: [],
      attributes: {},
      links: [],
      mentions: [],
      index: { graph: true, fts: true, vector: true }
    })
    expect(document?.provenance).toBeUndefined()
    expect(document?.content.trim()).toMatch(/^# Conversation API/)
  })

  it('preserves the full frontmatter of the spec example', () => {
    const { document, diagnostics } = parseMemoryFile(FULL, 'agents/ra.md')
    expect(diagnostics).toEqual([])
    expect(document?.tags).toEqual(['research', 'agents'])
    expect(document?.attributes).toEqual({
      package: 'RA.agent',
      runtime: 'in-process',
      modes: ['fast', 'slow']
    })
    expect(document?.links).toEqual([
      { rel: 'uses', target: 'datasource.public-market-1' },
      { rel: 'uses', target: 'datasource.private-market-3' },
      { rel: 'owned_by', target: 'team.research-platform' }
    ])
    expect(document?.provenance).toEqual({
      authority: 'repo',
      confidence: 1,
      capturedBy: 'human'
    })
  })

  it('preserves arbitrary link attributes (spec §16)', () => {
    const raw = `---
id: a.b
type: service
title: B
links:
  - rel: depends_on
    target: service.identity
    attributes:
      criticality: high
---
`
    const { document } = parseMemoryFile(raw, 'b.md')
    expect(document?.links[0]?.attributes).toEqual({ criticality: 'high' })
  })

  it('reports a diagnostic and no document when a required field is missing', () => {
    const { document, diagnostics } = parseMemoryFile(
      '---\nid: a.b\ntype: service\n---\n',
      'broken.md'
    )
    expect(document).toBeUndefined()
    expect(diagnostics).toEqual([
      {
        severity: 'error',
        code: 'invalid-frontmatter',
        message: expect.stringContaining('title'),
        path: 'broken.md'
      }
    ])
  })

  it('reports a diagnostic on unparseable YAML instead of throwing', () => {
    const { document, diagnostics } = parseMemoryFile(
      '---\nid: [unclosed\n---\n',
      'bad.md'
    )
    expect(document).toBeUndefined()
    expect(diagnostics[0]?.code).toBe('invalid-frontmatter')
  })

  it('extracts deduped [[id]] mentions from the body only', () => {
    const raw = `---
id: a.b
type: service
title: B
---

Depends on [[service.identity]] and [[ datasource.market ]].

Again: [[service.identity]].
`
    const { document } = parseMemoryFile(raw, 'b.md')
    expect(document?.mentions).toEqual(['service.identity', 'datasource.market'])
    // Mentions are weak references, never links (spec §19).
    expect(document?.links).toEqual([])
  })
})

describe('hashContent', () => {
  it('is stable, prefixed, and content-dependent', () => {
    expect(hashContent(MINIMAL)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(hashContent(MINIMAL)).toBe(hashContent(MINIMAL))
    expect(hashContent(MINIMAL)).not.toBe(hashContent(`${MINIMAL} `))
    expect(parseMemoryFile(MINIMAL, 'x.md').document?.hash).toBe(
      hashContent(MINIMAL)
    )
  })

  it('does not depend on the source path', () => {
    expect(parseMemoryFile(MINIMAL, 'one.md').document?.hash).toBe(
      parseMemoryFile(MINIMAL, 'two/three.md').document?.hash
    )
  })
})
