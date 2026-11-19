import { describe, expect, it } from 'vitest'

import { EVIDENCE_LOCATION_FIELDS, InvalidArgumentsError } from '../docket.js'
import { WRITE_LIMITS, type WriteResult } from '../write/inputs.js'
import { argumentsOf } from './args.js'
import { EVIDENCE_SCHEMA, WRITE_SCHEMA, parseAttributes, parseEvidence, requiredText, writeAnswer } from './write-args.js'

describe('argumentsOf', () => {
  it('takes an object of the allowed keys, and no arguments as none', () => {
    expect(argumentsOf('docket_retire', { id: 'a.b', reason: 'gone' }, ['id', 'reason'], '{ "id", "reason" }')).toEqual({ id: 'a.b', reason: 'gone' })
    expect(argumentsOf('docket_ontology', undefined, [], '{}')).toEqual({})
  })

  it('refuses anything else as invalid params, naming what it does not take', () => {
    expect(() => argumentsOf('docket_retire', [], ['id'], '{ "id" }')).toThrow(new InvalidArgumentsError('docket_retire takes { "id" }.'))
    expect(() => argumentsOf('docket_retire', { id: 'a.b', workspace: 'other' }, ['id'], '{ "id" }')).toThrow(
      new InvalidArgumentsError('docket_retire does not take "workspace".')
    )
  })
})

describe('parseEvidence', () => {
  it('reads the entries a client sends, trimming what it trims and reading lines given as a number', () => {
    expect(
      parseEvidence(
        [
          { source: ' code ', path: 'src/a.ts', lines: 12, urls: 'https://example.test/a', observedAt: '2026-10-01', observedBy: ' alice ', note: 'seen' },
          { source: 'human', observedBy: '   ' }
        ],
        'evidence'
      )
    ).toEqual([
      { source: 'code', path: 'src/a.ts', lines: '12', urls: ['https://example.test/a'], observedAt: '2026-10-01', observedBy: 'alice', note: 'seen' },
      { source: 'human' }
    ])
    expect(parseEvidence(undefined, 'evidence')).toEqual([])
  })

  it('reads evidence that cites no source, and the source instance, claims and locator fields a source takes', () => {
    expect(
      parseEvidence(
        [
          { note: 'I decided this.' },
          { source: 'email', sourceRef: ' mailbox:sales ', attributes: { mailbox: 'shared', pinned: true }, locator: { message_id: '<a@b>', cc: ['x', 'y'], thread: 12 } }
        ],
        'evidence'
      )
    ).toEqual([
      { note: 'I decided this.' },
      { source: 'email', sourceRef: 'mailbox:sales', attributes: { mailbox: 'shared', pinned: true }, locator: { message_id: '<a@b>', cc: ['x', 'y'], thread: '12' } }
    ])
    expect(() => parseEvidence([{ attributes: { nested: { no: 1 } } }], 'evidence')).toThrow(new InvalidArgumentsError('evidence[0].attributes.nested must be a string, number or boolean.'))
    expect(() => parseEvidence([{ locator: { cc: [] as string[], to: [''] } }], 'evidence')).toThrow(/evidence\[0\]\.locator\.to must be up to 10 non-empty strings/)
    expect(() => parseEvidence([{ locator: 'x' }], 'evidence')).toThrow(/locator must be an object/)
    expect(EVIDENCE_SCHEMA).not.toHaveProperty('required')
  })

  it('refuses wrong shapes as invalid arguments, saying where', () => {
    const refused = (raw: unknown) => {
      try {
        parseEvidence(raw, 'evidence')
      } catch (caught) {
        expect(caught).toBeInstanceOf(InvalidArgumentsError)
        return (caught as Error).message
      }
      throw new Error('accepted')
    }
    expect(refused('code')).toBe('evidence must be an array of evidence entries.')
    expect(refused(Array(WRITE_LIMITS.evidencePerCall + 1).fill({ source: 'human' }))).toBe('evidence holds at most 50 entries.')
    expect(refused([null])).toBe('evidence[0] must be an object.')
    expect(refused([{ source: 'code', session: 'mine' }])).toMatch(/^evidence\[0\] does not take "session"; evidence fields are source, /)
    expect(refused([{ source: '  ' }])).toBe('evidence[0].source must be a non-empty string.')
    expect(refused([{ source: 'code', path: 'x'.repeat(501) }])).toBe('evidence[0].path is at most 500 characters.')
    expect(refused([{ source: 'code', urls: Array(11).fill('https://example.test') }])).toBe('evidence[0].urls must be up to 10 URLs.')
    expect(refused([{ source: 'human', observedAt: 'yesterday' }])).toBe('evidence[0].observedAt must be YYYY-MM-DD or an ISO timestamp.')
  })

  it('describes every location field docket knows in the schema, with the source instance, claims and other locator fields', () => {
    expect(Object.keys(EVIDENCE_SCHEMA.properties)).toEqual(['source', 'sourceRef', 'attributes', 'locator', ...EVIDENCE_LOCATION_FIELDS, 'observedAt', 'observedBy', 'note'])
  })
})

describe('the other arguments', () => {
  it('trims required text and refuses it empty or too long', () => {
    expect(requiredText('  gone  ', 'reason', 10)).toBe('gone')
    expect(() => requiredText(' ', 'reason', 10)).toThrow('reason must be a non-empty string.')
    expect(() => requiredText('x'.repeat(11), 'reason', 10)).toThrow('reason is at most 10 characters.')
  })

  it('takes attributes as a plain object of at most 100', () => {
    expect(parseAttributes({ tier: 'critical' }, 'attributes')).toEqual({ tier: 'critical' })
    expect(parseAttributes(undefined, 'attributes')).toBeUndefined()
    expect(() => parseAttributes(['tier'], 'attributes')).toThrow(InvalidArgumentsError)
    expect(() => parseAttributes(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`a${i}`, i])), 'attributes')).toThrow(
      'attributes holds at most 100 attributes.'
    )
  })
})

describe('writeAnswer', () => {
  const VIEWER = 'https://docket.test/w/platform/graph'
  const written: WriteResult = {
    documentId: 'doc-1',
    path: '.docket/resources/service/checkout.md',
    revision: 2,
    created: false,
    changed: true,
    evidenceAdded: 1,
    diagnostics: [{ severity: 'warning', code: 'unknown-icon', message: 'no such icon' }]
  }

  it('says what a write changed, with its warnings, and links the resource in the viewer', () => {
    const answer = writeAnswer('docket_remember', 'service.checkout', VIEWER, written, false)
    expect(answer).not.toHaveProperty('isError')
    expect(answer.structuredContent).toEqual({
      schema: WRITE_SCHEMA,
      tool: 'docket_remember',
      id: 'service.checkout',
      ok: true,
      dryRun: false,
      created: false,
      changed: true,
      evidenceAdded: 1,
      documentId: 'doc-1',
      path: '.docket/resources/service/checkout.md',
      revision: 2,
      viewer: `${VIEWER}#service.checkout`,
      diagnostics: [{ severity: 'warning', code: 'unknown-icon', message: 'no such icon' }]
    })
    expect(answer.content[0]?.text).toBe(
      [
        'Updated service.checkout (.docket/resources/service/checkout.md, revision 2) with 1 new evidence, recorded as observed by you.',
        '',
        'Warnings (the write is not blocked by these):',
        '- warning unknown-icon: no such icon'
      ].join('\n')
    )
  })

  it('reads a refusal as a tool error the model can act on', () => {
    const refused: WriteResult = { created: true, changed: false, evidenceAdded: 0, diagnostics: [{ severity: 'error', code: 'missing-evidence', message: 'Give evidence.' }] }
    const answer = writeAnswer('docket_remember', 'service.x', VIEWER, refused, false)
    expect(answer.isError).toBe(true)
    expect(answer.structuredContent.ok).toBe(false)
    expect(answer.content[0]?.text).toBe('Refused: nothing was written. Fix these and call docket_remember again:\n- error missing-evidence: Give evidence.')
    expect(writeAnswer('docket_remember', 'service.x', VIEWER, refused, true).content[0]?.text).toMatch(/^This write would be refused\. /)
  })

  it('says when a dry run checks out, and when a write said nothing new', () => {
    const quiet: WriteResult = { created: true, changed: false, evidenceAdded: 2, diagnostics: [] }
    expect(writeAnswer('docket_remember', 'service.x', VIEWER, quiet, true).content[0]?.text).toBe(
      'The write checks out against the published ontology: service.x would be created with 2 new evidence.'
    )
    expect(writeAnswer('docket_remember', 'service.x', VIEWER, { ...quiet, created: false }, false).content[0]?.text).toBe(
      'Nothing new: service.x already holds this, with this evidence.'
    )
  })
})
