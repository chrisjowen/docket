import { describe, expect, it } from 'vitest'

import type { Ontology } from '../../model/index.js'
import { orderedEvidence, stampAll, stampContext, stampEvidence } from './evidence.js'

const NOW = new Date('2026-11-20T10:00:00.000Z')
const writer = { label: 'claude-code via tom', requestId: 'req-1', principal: 'tom' }
const where = { where: { path: '.docket/x.md', id: 'service.x' }, subject: 'service.x' }

const ontology: Ontology = {
  version: 1,
  resourceTypes: {},
  relationships: {},
  sources: { person: { kind: 'identity' }, code: {}, human: {} },
  trust: { policies: [] }
}
const people = { people: { dana: { aliases: ['dana@acme.com'], attributes: {} }, tom: { attributes: {} } } }
const context = stampContext(ontology, people)

describe('stamping evidence', () => {
  it('stamps who wrote it, who they act for, the request and the time, and keeps the source\'s claims and locator', () => {
    expect(
      stampEvidence(
        { source: 'code', sourceRef: 'payments', attributes: { branch: 'default' }, path: 'a.go', locator: { section: 'Order state' }, observedBy: 'sam' },
        writer,
        NOW,
        context
      )
    ).toEqual({
      source: 'code',
      sourceRef: 'payments',
      attributes: { branch: 'default' },
      path: 'a.go',
      locator: { section: 'Order state' },
      observedAt: '2026-11-20T10:00:00.000Z',
      observedBy: 'claude-code via tom',
      principal: 'tom',
      session: 'req-1',
      reportedBy: 'sam'
    })
  })

  it('takes evidence citing no source as said by the person the writer acts for', () => {
    const { stamped, diagnostics } = stampAll([{ note: 'I decided this.' }], writer, NOW, context, where)
    expect(diagnostics).toEqual([])
    expect(stamped).toEqual([expect.objectContaining({ source: 'person', principal: 'tom', note: 'I decided this.' })])
    expect(stamped[0]?.sourceRef).toBeUndefined()
  })

  it('writes legacy human evidence as the person it names, when the directory knows them, else the writer\'s', () => {
    expect(stampEvidence({ source: 'human', observedBy: 'Dana@acme.com' }, writer, NOW, context)).toMatchObject({
      source: 'person',
      sourceRef: 'dana',
      reportedBy: 'Dana@acme.com'
    })
    expect(stampEvidence({ source: 'human', observedBy: 'a visitor' }, writer, NOW, context)).toMatchObject({ source: 'person', principal: 'tom' })
    expect(stampEvidence({ source: 'human', observedBy: 'a visitor' }, writer, NOW, context).sourceRef).toBeUndefined()
    // Without a person source - a legacy ontology - it stays as it was.
    expect(stampEvidence({ source: 'human' }, writer, NOW, stampContext({ ...ontology, sources: { human: {} } }))).toMatchObject({ source: 'human' })
  })

  it('asks a person cited second-hand to confirm, once each, and not the writer\'s own person', () => {
    const { diagnostics } = stampAll(
      [
        { source: 'person', sourceRef: 'dana', note: 'Dana said so.' },
        { source: 'person', sourceRef: 'dana@acme.com', note: 'And again.' },
        { source: 'person', sourceRef: 'tom' },
        { source: 'human', observedBy: 'dana' }
      ],
      writer,
      NOW,
      context,
      where
    )
    expect(diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'confirm-requested',
        message:
          'Evidence for service.x citing dana counts as said by tom until dana confirms it: dana confirms by adding evidence of their own (docket_add_evidence; no source needed).',
        path: '.docket/x.md',
        id: 'service.x'
      }
    ])
  })

  it('refuses evidence citing no source when there is no one it could be from', () => {
    const noPerson = stampAll([{ note: 'x' }], writer, NOW, stampContext({ ...ontology, sources: { code: {} } }), where)
    expect(noPerson.stamped).toEqual([])
    expect(noPerson.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'missing-evidence-source', message: expect.stringContaining('no person source') })
    ])
    const noOne = stampAll([{ note: 'x' }, { source: 'code', path: 'a.go' }], { label: 'ci', requestId: 'r' }, NOW, context, where)
    expect(noOne.stamped).toHaveLength(1)
    expect(noOne.diagnostics).toEqual([expect.objectContaining({ code: 'missing-evidence-source', message: expect.stringContaining('acts for no one') })])
  })

  it('writes the new fields in their place', () => {
    expect(Object.keys(orderedEvidence({ session: 's', principal: 'p', locator: {}, attributes: {}, sourceRef: 'r', source: 'x', path: 'a' }))).toEqual([
      'source',
      'sourceRef',
      'attributes',
      'path',
      'locator',
      'principal',
      'session'
    ])
  })
})
