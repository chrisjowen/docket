// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { fingerprintOf, summarize, summaryPrompt, type SummaryModel } from './summarize.js'
import { indexGraph, walkNeighbourhood, type Neighbourhood } from './walk.js'

const neighbourhood = (confidence: { target: number; evidence: number[] }): Neighbourhood => ({
  target: { id: 'person.alice-hong', type: 'person', title: 'Alice Hong', confidence: confidence.target },
  direct: [{ id: 'person.chris', type: 'person', title: 'Chris', rel: 'emailed' }],
  context: [],
  evidence: confidence.evidence.map((c, index) => ({ id: `mail-${index + 1}`, path: `mail/${index + 1}.eml`, note: 'An email.', confidence: c })),
  digest: '',
})

const answering = (text: string): SummaryModel => ({ chat: async () => ({ text, model: 'test/answered-by' }) })
const LONG = `Alice Hong sent Chris an email [mail-1]; she seemed a little dismissive about Sophia's proposal. ${'She has written to him often since. '.repeat(20)}`

describe('summarize', () => {
  it('gives a long summary of low-confidence evidence a low confidence', async () => {
    const n = neighbourhood({ target: 0.9, evidence: [0.3, 0.9] })
    const result = await summarize(n, summaryPrompt(n), answering(LONG))
    expect(result.text.length).toBeGreaterThan(500)
    expect(result.citedEvidence).toEqual(['mail-1'])
    expect(result.confidence).toBe(0.3)
    expect(result.model).toBe('test/answered-by')
  })

  it('never trusts a summary further than the resource itself', async () => {
    const n = neighbourhood({ target: 0.5, evidence: [0.9] })
    expect((await summarize(n, summaryPrompt(n), answering(LONG))).confidence).toBe(0.5)
  })

  it('records no cited evidence when the summary cites none, and falls back to all it was given for confidence', async () => {
    const n = neighbourhood({ target: 0.9, evidence: [0.4, 0.6] })
    const result = await summarize(n, summaryPrompt(n), answering('Alice Hong sent Chris an email about the launch plans for next quarter.'))
    expect(result.citedEvidence).toEqual([])
    expect(result.confidence).toBe(0.5)
  })

  it('reads citations of path-shaped ids in parentheses or brackets, and nothing it was not given', async () => {
    const n: Neighbourhood = {
      ...neighbourhood({ target: 0.9, evidence: [] }),
      evidence: [
        { id: 'src/Orders/db.ts', path: 'src/Orders/db.ts', confidence: 0.6 },
        { id: 'docs/ADR-7.md', path: 'docs/ADR-7.md', confidence: 0.8 },
        { id: 'mail-1', path: 'mail/1.eml', confidence: 0.2 },
      ],
    }
    const text = 'Alice changed the orders schema (src/Orders/db.ts) after the review [docs/ADR-7.md], not (src/other.ts).'
    const result = await summarize(n, summaryPrompt(n), answering(text))
    expect(result.citedEvidence).toEqual(['src/Orders/db.ts', 'docs/ADR-7.md'])
    expect(result.confidence).toBe(0.7)
  })

  it('reads grouped citations, keeps only evidence it was given, once each, and takes confidence from them', async () => {
    const n: Neighbourhood = {
      ...neighbourhood({ target: 0.9, evidence: [] }),
      evidence: [
        { id: 'src/db.ts', path: 'src/db.ts', confidence: 0.2 },
        { id: 'docs/ADR-7.md', path: 'docs/ADR-7.md', confidence: 0.4 },
        { id: 'mail-1', path: 'mail/1.eml', confidence: 0.9 },
      ],
    }
    const text = 'Alice changed the schema (src/db.ts, docs/ADR-7.md) and said so again [docs/ADR-7.md; src/unknown.ts; src/db.ts].'
    const result = await summarize(n, summaryPrompt(n), answering(text))
    expect(result.citedEvidence).toEqual(['src/db.ts', 'docs/ADR-7.md'])
    expect(result.confidence).toBe(0.3)
  })

  it('trusts and accepts only the evidence the model was shown', async () => {
    const entity = (id: string, confidence: number) => ({ id, type: 'person', title: id, paths: [], attributes: {}, content: '', evidence: [], assessment: { confidence } })
    const evidence = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ source: 'mail', path: `${prefix}/${i + 1}.eml` }))
    const edge = (target: string, confidence: number, entries: Record<string, unknown>[]) => ({ source: 'person.alice', rel: 'emailed', target, evidence: entries, assessment: { confidence } })
    const graph = {
      entities: [entity('person.alice', 0.9), entity('person.chris', 0.9), entity('person.sophia', 0.9)],
      edges: [edge('person.chris', 0.4, evidence('chris', 10)), edge('person.sophia', 0.95, evidence('sophia', 5))],
    } as unknown as Parameters<typeof indexGraph>[0]
    const n = walkNeighbourhood(indexGraph(graph), 'person.alice')
    if (!n) throw new Error('no neighbourhood')
    const shown = summaryPrompt(n).map((message) => message.content).join('\n')
    expect(shown).toContain('chris/10.eml')
    expect(shown).not.toContain('sophia/1.eml')

    const uncited = await summarize(n, summaryPrompt(n), answering('Alice Hong wrote to Chris and Sophia about the launch, many times over.'))
    expect(uncited.confidence).toBe(0.4)
    const omitted = await summarize(n, summaryPrompt(n), answering('Alice Hong wrote to Sophia about the launch (sophia/1.eml), many times over.'))
    expect(omitted.citedEvidence).toEqual([])
    expect(omitted.confidence).toBe(0.4)
  })

  it("fingerprints what the model is not shown: notes past the prompt's bound, and a direct neighbour's notes and evidence", () => {
    const entity = (id: string, content: string, evidence: Record<string, unknown>[] = []) => ({
      id,
      type: 'service',
      title: id,
      paths: [],
      attributes: {},
      content,
      evidence,
      assessment: { confidence: 0.9 },
    })
    const notes = 'Takes orders. '.repeat(500)
    const fingerprint = (orders: string, payments: string, evidence: Record<string, unknown>[] = []) => {
      const graph = {
        entities: [entity('service.orders', orders), entity('service.payments', payments, evidence)],
        edges: [{ source: 'service.orders', rel: 'depends_on', target: 'service.payments' }],
      } as unknown as Parameters<typeof indexGraph>[0]
      const n = walkNeighbourhood(indexGraph(graph), 'service.orders')
      if (!n) throw new Error('no neighbourhood')
      return { prompt: JSON.stringify(summaryPrompt(n)), fingerprint: fingerprintOf(n, summaryPrompt(n)) }
    }
    const before = fingerprint(notes, 'Charges cards.')
    const lateEdit = fingerprint(`${notes}And refunds them.`, 'Charges cards.')
    expect(lateEdit.prompt).toBe(before.prompt)
    expect(lateEdit.fingerprint).not.toBe(before.fingerprint)

    const neighbourEdit = fingerprint(notes, 'Charges cards and wallets.')
    expect(neighbourEdit.prompt).toBe(before.prompt)
    expect(neighbourEdit.fingerprint).not.toBe(before.fingerprint)

    const neighbourEvidence = fingerprint(notes, 'Charges cards.', [{ source: 'code', path: 'src/charge.ts' }])
    expect(neighbourEvidence.fingerprint).not.toBe(before.fingerprint)
    expect(fingerprint(notes, 'Charges cards.').fingerprint).toBe(before.fingerprint)
  })
})
