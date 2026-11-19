import { describe, expect, it } from 'vitest'

import { parseMemoryFile } from '../docket.js'
import { evidenceKey, evidenceProblems, hasErrors, orderedEvidence, refuse, stampEvidence, writeDiagnostics } from './evidence.js'

const NOW = new Date('2026-11-04T09:30:00.000Z')
const writer = { label: 'ci-bot (token tok_8f3a…)', requestId: 'req-1' }

describe('stampEvidence', () => {
  it('records the writer as the observer, the request as the session, and now unless the client said when', () => {
    expect(stampEvidence({ source: 'code', path: 'src/checkout.ts', lines: '1-40', note: 'the checkout handler' }, writer, NOW)).toEqual({
      source: 'code',
      path: 'src/checkout.ts',
      lines: '1-40',
      note: 'the checkout handler',
      observedAt: NOW.toISOString(),
      observedBy: 'ci-bot (token tok_8f3a…)',
      session: 'req-1'
    })
    expect(stampEvidence({ source: 'human', observedAt: '2026-10-01' }, writer, NOW).observedAt).toBe('2026-10-01')
  })

  it('keeps who the client said saw it as reportedBy, unless that is the writer', () => {
    expect(stampEvidence({ source: 'human', observedBy: 'alice' }, writer, NOW)).toMatchObject({ observedBy: writer.label, reportedBy: 'alice' })
    expect(stampEvidence({ source: 'human', observedBy: writer.label }, writer, NOW)).not.toHaveProperty('reportedBy')
  })

  it('writes the fields in evidence order: source, location, note, then the stamp', () => {
    const stamped = stampEvidence({ note: 'seen', observedBy: 'alice', commit: 'abc123', path: 'a.ts', source: 'code' }, writer, NOW)
    expect(Object.keys(stamped)).toEqual(['source', 'path', 'commit', 'note', 'observedAt', 'observedBy', 'session', 'reportedBy'])
  })
})

describe('evidence identity and order', () => {
  it('treats the same observation in another session or at another time as the same entry', () => {
    const first = stampEvidence({ source: 'code', path: 'a.ts' }, writer, NOW)
    const again = stampEvidence({ source: 'code', path: 'a.ts' }, { ...writer, requestId: 'req-2' }, new Date('2026-12-01T00:00:00Z'))
    expect(evidenceKey({ ...again })).toBe(evidenceKey({ ...first }))
    expect(evidenceKey({ ...first, note: 'more' })).not.toBe(evidenceKey({ ...first }))
    expect(evidenceKey({ ...first, observedBy: 'someone else' })).not.toBe(evidenceKey({ ...first }))
  })

  it('orders known fields first and keeps unknown ones after', () => {
    expect(Object.keys(orderedEvidence({ extra: 1, session: 's', source: 'code', path: 'a.ts' }))).toEqual(['source', 'path', 'session', 'extra'])
  })
})

describe('write diagnostics', () => {
  it('refuse with an error at the resource, and ask for evidence only when none is given', () => {
    const where = { path: '.docket/resources/service/x.md', id: 'service.x' }
    expect(refuse('missing-notes', 'Give notes.', where)).toEqual({ severity: 'error', code: 'missing-notes', message: 'Give notes.', ...where })
    expect(evidenceProblems([], 'service.x', where)).toEqual([expect.objectContaining({ code: 'missing-evidence', id: 'service.x' })])
    expect(evidenceProblems([{ source: 'human' }], 'service.x', where)).toEqual([])
    expect(hasErrors([{ severity: 'warning', code: 'w', message: '' }])).toBe(false)
    expect(hasErrors([refuse('e', '')])).toBe(true)
  })

  it('keep reportedBy, which docket accepts, and pass on a warning about a field docket does not know', () => {
    const raw = [
      '---',
      'id: service.x',
      'type: service',
      'title: X',
      'evidence:',
      '  - source: human',
      '    observedBy: ci-bot',
      '    reportedBy: alice',
      '  - source: human',
      '    reportedBy: alice',
      '    whoKnows: maybe',
      '---',
      ''
    ].join('\n')
    const { document, diagnostics } = parseMemoryFile(raw, '.docket/resources/service/x.md')
    expect(document?.evidence.map((entry) => entry.reportedBy)).toEqual(['alice', 'alice'])
    expect(writeDiagnostics(diagnostics).map((d) => d.message)).toEqual([expect.stringMatching(/^evidence\[1\]: "whoKnows" ignored/)])
  })
})
