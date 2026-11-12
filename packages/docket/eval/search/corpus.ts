import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { stringify } from 'yaml'

import { sync } from '../../src/commands/sync.js'
import { ONTOLOGY_TEMPLATES } from '../../src/config/defaults.js'
import type { MemoryEvidence } from '../../src/model/index.js'

/*
 * The search evaluation's data model (README.md): a corpus is typed entities
 * and the links between them, written out as a docket under one of the
 * ontology templates, and the queries asked of it, each with the entities
 * that answer it. Relevance is to the query; an entity's confidence is how far
 * its evidence supports it, and the two are never mixed.
 */

/** One entity, as a canonical file holds it. */
export interface CorpusEntity {
  /** `<type>.<slug>`. */
  id: string
  type: string
  title: string
  /** Markdown body, below the title heading. */
  body: string
  tags?: string[]
  attributes?: Record<string, unknown>
  links?: { rel: string; target: string }[]
  /** Where it was seen. Confidence is computed from it by docket, as for any docket. */
  evidence: MemoryEvidence[]
}

/** A question with an answer in the corpus, or one the corpus cannot answer. */
export type QueryKind = 'answerable' | 'no-answer'

export interface EvalQuery {
  /** Unique within its corpus. */
  id: string
  text: string
  kind: QueryKind
  /** What answering takes, for the per-category breakdown: lookup, multi-hop, ... */
  category: string
  /**
   * The entities relevant to the query, by id, with a grade: 2 answers it, 1
   * is partly relevant. Empty for a no-answer query.
   */
  relevant: Record<string, number>
  /** The grade an entity needs to count as relevant in precision, recall and MRR. Defaults to 1. */
  minGrade?: number
}

export interface Corpus {
  /** Short name, used in reports and file names. */
  name: string
  /** The ontology domain it exercises. */
  domain: string
  /** Where the data comes from, for the report. */
  source: string
  /** The `ONTOLOGY_TEMPLATES` name its docket is written under, or a path to its own ontology. */
  template: string
  /** An existing docket to copy instead of writing `entities`: its `.docket` tree, ontology included. */
  directory?: string
  entities: CorpusEntity[]
  queries: EvalQuery[]
}

/** The ids a query counts as relevant, at its `minGrade`. */
export const relevantIds = (query: EvalQuery): Set<string> =>
  new Set(Object.entries(query.relevant).flatMap(([id, grade]) => (grade >= (query.minGrade ?? 1) ? [id] : [])))

/** A stable 32-bit number for a string: seeds, splits and evidence choices that never change between runs. */
export const hash32 = (text: string): number => createHash('sha256').update(text).digest().readUInt32BE(0)

/** Half the queries tune the relevance floor and half measure it, chosen by id so the split never moves. */
export const splitOf = (corpus: string, query: EvalQuery): 'dev' | 'test' => (hash32(`${corpus}/${query.id}`) % 2 === 0 ? 'dev' : 'test')

/** A seeded pseudo-random generator (mulberry32): the same corpus from the same seed, every run. */
export const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Up to `count` items of `items`, chosen with `next`, in their original order. */
export const sample = <T>(items: readonly T[], count: number, next: () => number): T[] => {
  const picked = items.map((item, index) => ({ item, index, key: next() })).sort((a, b) => a.key - b.key).slice(0, count)
  return picked.sort((a, b) => a.index - b.index).map(({ item }) => item)
}

/** A slug for an id: lower case, ascii letters and digits, hyphenated. */
export const slug = (text: string, max = 60): string =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || 'x'

/**
 * Writes the corpus as a docket in `dir` - `.docket.yaml` with the JSONL
 * adapter, the ontology template and one Markdown file per entity - replacing
 * whatever was there, and syncs it.
 */
export const writeDocket = async (corpus: Corpus, dir: string): Promise<{ files: number; syncMs: number }> => {
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, '.docket'), { recursive: true })
  await writeFile(
    join(dir, '.docket.yaml'),
    [
      'version: 2',
      'source:',
      '  root: .docket',
      '  include: ["**/*.md"]',
      '  exclude: [".index/**", ".cache/**"]',
      'ontology:',
      '  file: .docket/entities.yaml',
      'adapters:',
      '  - id: local',
      '    module: "@docket/adapter-jsonl"',
      '    roles: [projection, query]',
      '    config:',
      '      output: .docket/.index',
      ''
    ].join('\n')
  )
  if (corpus.directory) {
    await cp(join(corpus.directory, '.docket'), join(dir, '.docket'), { recursive: true, filter: (path) => !/[\\/]\.(index|cache)([\\/]|$)/.test(path) })
  } else {
    await copyFile(ONTOLOGY_TEMPLATES[corpus.template] ?? corpus.template, join(dir, '.docket', 'entities.yaml'))
  }

  for (const entity of corpus.entities) {
    const frontmatter = {
      id: entity.id,
      type: entity.type,
      title: entity.title,
      ...(entity.tags?.length ? { tags: entity.tags } : {}),
      ...(entity.attributes && Object.keys(entity.attributes).length > 0 ? { attributes: entity.attributes } : {}),
      ...(entity.links?.length ? { links: entity.links } : {}),
      evidence: entity.evidence
    }
    const file = join(dir, '.docket', entity.type, `${entity.id.slice(entity.type.length + 1)}.md`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n\n# ${entity.title}\n\n${entity.body.trim()}\n`)
  }

  const started = performance.now()
  await sync({ cwd: dir })
  return { files: corpus.directory ? (await readIndex(dir)).entities.length : corpus.entities.length, syncMs: performance.now() - started }
}

/** One line of the JSONL adapter's index, as the evaluation reads it. */
export interface IndexedEntity {
  id: string
  type: string
  title: string
  content: string
  tags: string[]
  /** How far the entity's evidence supports it: never a relevance score. */
  confidence: number
}

export interface IndexedEdge {
  source: string
  rel: string
  target: string
  confidence: number
}

/** What a synced docket's JSONL index holds. */
export const readIndex = async (dir: string): Promise<{ entities: IndexedEntity[]; edges: IndexedEdge[] }> => {
  const lines = async <T>(file: string): Promise<T[]> =>
    (await readFile(join(dir, '.docket', '.index', file), 'utf8'))
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T)
  const [documents, nodes, edges] = await Promise.all([
    lines<{ id: string; type: string; title: string; content: string; tags: string[] }>('documents.jsonl'),
    lines<{ id: string; confidence: number }>('nodes.jsonl'),
    lines<IndexedEdge>('edges.jsonl')
  ])
  const confidence = new Map(nodes.map((node) => [node.id, node.confidence]))
  return {
    entities: documents.map((document) => ({ ...document, confidence: confidence.get(document.id) ?? 0.5 })),
    edges
  }
}

/** Evidence for a generated entity: one of `choices`, picked by the entity's id so it never changes. */
export const evidenceFor = (id: string, choices: readonly MemoryEvidence[]): MemoryEvidence[] => [choices[hash32(`evidence/${id}`) % choices.length] as MemoryEvidence]
