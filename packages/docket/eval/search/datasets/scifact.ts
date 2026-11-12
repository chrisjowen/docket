import { execFileSync } from 'node:child_process'

import { evidenceFor, hash32, random, sample, type Corpus, type CorpusEntity, type EvalQuery } from '../corpus.js'
import { absentNames, dataFile, whoIsQuery, type QueryBudget } from './common.js'

/*
 * SciFact (Wadden et al., 2020), as packaged by BEIR (Thakur et al., 2021),
 * as research: each abstract a paper. A claim's relevant papers are the ones
 * its test qrels cite as evidence.
 *
 * No-answer claims are held out: the papers they cite are removed from the
 * corpus, so the papers closest to them - same field, same terms - stay as
 * distractors, the hard case for a relevance floor. A held-out claim never
 * shares a paper with a claim that stays answerable.
 */

const EVIDENCE = (id: string) => [
  { source: 'publication', key: `s2orc:${id}` },
  { source: 'bibliographic', urls: [`https://api.semanticscholar.org/CorpusID:${id}`] },
  { source: 'preprint', urls: [`https://example.org/preprint/${id}`] },
  { source: 'docs', path: 'reading-notes.md' }
]

const lines = (file: string): string[] =>
  execFileSync('unzip', ['-p', dataFile('scifact.zip'), file], { maxBuffer: 256 * 1024 * 1024 })
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())

export const loadScifact = async (budget: QueryBudget): Promise<Corpus> => {
  const papers = lines('scifact/corpus.jsonl').map((line) => JSON.parse(line) as { _id: string; title: string; text: string })
  const claims = new Map(lines('scifact/queries.jsonl').map((line) => JSON.parse(line) as { _id: string; text: string }).map((claim) => [claim._id, claim.text]))
  const qrels = new Map<string, string[]>()
  for (const line of lines('scifact/qrels/test.tsv').slice(1)) {
    const [query, paper] = line.split('\t') as [string, string]
    qrels.set(query, [...(qrels.get(query) ?? []), paper])
  }

  const next = random(hash32('scifact'))
  const all = [...qrels.keys()]
  const heldOut = sample(all, budget.noAnswer - 1, next)
  const removed = new Set(heldOut.flatMap((query) => qrels.get(query) ?? []))
  const answerable = sample(
    all.filter((query) => !heldOut.includes(query) && (qrels.get(query) ?? []).every((paper) => !removed.has(paper))),
    budget.answerable,
    next
  )

  const entities: CorpusEntity[] = papers
    .filter((paper) => !removed.has(paper._id))
    .map((paper) => ({
      id: `paper.s${paper._id}`,
      type: 'paper',
      title: paper.title.replace(/\s+/g, ' ').trim() || `Paper ${paper._id}`,
      body: paper.text,
      evidence: evidenceFor(`paper.s${paper._id}`, EVIDENCE(paper._id))
    }))

  const queries: EvalQuery[] = [
    ...answerable.map((query) => ({
      id: `claim-${query}`,
      text: claims.get(query) as string,
      kind: 'answerable' as const,
      category: 'claim',
      relevant: Object.fromEntries((qrels.get(query) ?? []).map((paper) => [`paper.s${paper}`, 2]))
    })),
    whoIsQuery(absentNames(entities)[0] as string),
    ...heldOut.map((query) => ({
      id: `claim-${query}-held-out`,
      text: claims.get(query) as string,
      kind: 'no-answer' as const,
      category: 'held-out',
      relevant: {}
    }))
  ]

  return {
    name: 'scifact',
    domain: 'research',
    source: 'SciFact via BEIR (CC BY-NC 2.0): 5,183 abstracts, test claims',
    template: 'research',
    entities,
    queries
  }
}
