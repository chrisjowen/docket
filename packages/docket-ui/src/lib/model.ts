import type { UiAnswer, UiChatAnswer, UiEdge, UiEntity, UiGraph } from './types.js'

/** Hand-picked categorical slots; types past these get generated colours. */
export const SERIES_SLOTS = 8

/**
 * One slot per type, by how many entities have it - most common first - so a
 * type keeps its colour however the view is filtered.
 */
export const typeSlots = (entities: readonly UiEntity[]): Map<string, number> => {
  const counts = countBy(entities, (entity) => entity.type)
  const ordered = [...counts.entries()].sort(([a, x], [b, y]) => y - x || compare(a, b))
  return new Map(ordered.map(([type], index) => [type, index + 1]))
}

/**
 * Hue bands, in degrees, the palette leaves free - yellow-green, teal to sky,
 * purple to magenta - so a generated colour never passes for a palette one.
 */
const FREE_HUES: readonly (readonly [number, number])[] = [
  [175, 240],
  [300, 340],
  [95, 130]
]
const FREE_WIDTH = FREE_HUES.reduce((sum, [from, to]) => sum + to - from, 0)

/** The golden ratio's fraction: successive positions land as far from all earlier ones as they can. */
const GOLDEN = 0.618034

/** Generated colours step lightness too, so two close hues still read apart. */
const LIGHTNESS_STEPS = [0, 0.1, -0.08] as const

const freeHue = (index: number): number => {
  let offset = ((index * GOLDEN + 0.25) % 1) * FREE_WIDTH
  for (const [from, to] of FREE_HUES) {
    if (offset < to - from) return from + offset
    offset -= to - from
  }
  return FREE_HUES[0]?.[0] ?? 0
}

/**
 * A slot's colour. The first eight come from the palette; every one after gets
 * its own hue in the bands the palette leaves free, at the lightness and
 * chroma the theme sets, so no two types share a colour and colours never
 * cycle.
 */
export const slotColour = (slot: number | undefined): string => {
  if (!slot) return 'var(--graph-other)'
  if (slot <= SERIES_SLOTS) return `var(--series-${slot})`
  const index = slot - SERIES_SLOTS - 1
  const step = LIGHTNESS_STEPS[index % LIGHTNESS_STEPS.length] ?? 0
  const lightness = step === 0 ? 'var(--series-generated-l)' : `calc(var(--series-generated-l) + ${step})`
  return `oklch(${lightness} var(--series-generated-c) ${freeHue(index).toFixed(1)})`
}

export const countBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

export const edgeKey = (edge: Pick<UiEdge, 'source' | 'rel' | 'target'>): string =>
  `${edge.source}\u0000${edge.rel}\u0000${edge.target}`

/** An entity's own links and the links pointing at it. */
export const linksOf = (graph: UiGraph, id: string): { outgoing: UiEdge[]; incoming: UiEdge[] } => ({
  outgoing: graph.edges.filter((edge) => edge.source === id),
  incoming: graph.edges.filter((edge) => edge.target === id)
})

/** The entity and everything one link away, either direction. */
export const neighbourhood = (edges: readonly UiEdge[], id: string): Set<string> => {
  const ids = new Set([id])
  for (const edge of edges) {
    if (edge.source === id) ids.add(edge.target)
    if (edge.target === id) ids.add(edge.source)
  }
  return ids
}

// --- Quick search -----------------------------------------------------------

export type QuickResult =
  | { kind: 'entity'; entity: UiEntity; score: number; field: MatchField; snippet?: string }
  | { kind: 'relationship'; edge: UiEdge; score: number }

export type MatchField = 'id' | 'title' | 'type' | 'tag' | 'attribute' | 'body'

interface Query {
  /** `type:`, `rel:` and `tag:` narrow the results; the rest are free words. */
  type: string[]
  rel: string[]
  tag: string[]
  words: string[]
}

const FILTERS = ['type', 'rel', 'tag'] as const

export const parseQuery = (text: string): Query => {
  const query: Query = { type: [], rel: [], tag: [], words: [] }
  for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const [prefix, ...rest] = token.split(':')
    const value = rest.join(':')
    const filter = FILTERS.find((name) => name === prefix)
    if (filter && rest.length > 0) {
      if (value) query[filter].push(value)
    } else {
      query.words.push(token)
    }
  }
  return query
}

/** How strongly `word` matches `text`: whole, at the start, at a word start, anywhere. */
const matchStrength = (text: string, word: string): number => {
  const lower = text.toLowerCase()
  if (lower === word) return 4
  if (lower.startsWith(word)) return 3
  if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}`).test(lower)) return 2
  return lower.includes(word) ? 1 : 0
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Field weights: what a match in that field says about the entity. */
const FIELD_WEIGHT: Record<MatchField, number> = {
  id: 5,
  title: 5,
  type: 3,
  tag: 3,
  attribute: 2,
  body: 1
}

const entityFields = (entity: UiEntity): [MatchField, string][] => [
  ['id', entity.id],
  ['title', entity.title],
  ['type', entity.type],
  ...entity.tags.map((tag): [MatchField, string] => ['tag', tag]),
  ...Object.values(entity.attributes)
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map((value): [MatchField, string] => ['attribute', String(value)]),
  ['body', entity.content]
]

/** A window of the body around the first match, so a body hit shows why. */
const snippet = (content: string, word: string): string => {
  const flat = content.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(word)
  if (at < 0) return ''
  const start = Math.max(0, at - 30)
  return `${start > 0 ? '…' : ''}${flat.slice(start, at + word.length + 50)}${at + word.length + 50 < flat.length ? '…' : ''}`
}

const scoreEntity = (entity: UiEntity, words: readonly string[]): QuickResult | null => {
  let score = 0
  let best: { field: MatchField; value: number; word: string } = { field: 'body', value: 0, word: '' }
  for (const word of words) {
    let wordBest = 0
    let wordField: MatchField = 'body'
    for (const [field, text] of entityFields(entity)) {
      const value = matchStrength(text, word) * FIELD_WEIGHT[field]
      if (value > wordBest) {
        wordBest = value
        wordField = field
      }
    }
    // Every word must match somewhere: type-ahead narrows, it never widens.
    if (wordBest === 0) return null
    score += wordBest
    if (wordBest > best.value) best = { field: wordField, value: wordBest, word }
  }
  const result: QuickResult = { kind: 'entity', entity, score, field: best.field }
  if (best.field === 'body') result.snippet = snippet(entity.content, best.word)
  return result
}

const scoreEdge = (edge: UiEdge, words: readonly string[], titles: Map<string, string>): number | null => {
  const fields = [edge.rel, edge.source, edge.target, titles.get(edge.source) ?? '', titles.get(edge.target) ?? '']
  let score = 0
  for (const word of words) {
    const value = Math.max(...fields.map((text, index) => matchStrength(text, word) * (index === 0 ? 3 : 1)))
    if (value === 0) return null
    score += value
  }
  return score
}

/**
 * Instant search over what is loaded: entities by id, title, type, tag,
 * attribute and body, and relationships by name and by the entities they
 * join. `type:service`, `rel:depends_on` and `tag:core` narrow the results;
 * on their own they list everything that matches.
 */
export const quickSearch = (graph: UiGraph, text: string, limit = 20): QuickResult[] => {
  const query = parseQuery(text)
  const hasFilter = query.type.length + query.rel.length + query.tag.length > 0
  if (query.words.length === 0 && !hasFilter) return []

  const results: QuickResult[] = []
  const typeMatches = (type: string) => query.type.every((wanted) => type.toLowerCase().startsWith(wanted))

  // A `rel:` filter asks for relationships, so it does not list entities.
  if (query.rel.length === 0) {
    for (const entity of graph.entities) {
      if (!typeMatches(entity.type)) continue
      if (!query.tag.every((wanted) => entity.tags.some((tag) => tag.toLowerCase().startsWith(wanted)))) continue
      if (query.words.length === 0) {
        results.push({ kind: 'entity', entity, score: 1, field: query.type.length ? 'type' : 'tag' })
        continue
      }
      const result = scoreEntity(entity, query.words)
      if (result) results.push(result)
    }
  }

  // Free words or `rel:` find relationships; `type:` and `tag:` alone are about entities.
  if (query.tag.length === 0 && (query.rel.length > 0 || query.words.length > 0)) {
    const titles = new Map(graph.entities.map((entity) => [entity.id, entity.title]))
    const typeOf = new Map(graph.entities.map((entity) => [entity.id, entity.type]))
    for (const edge of graph.edges) {
      if (!query.rel.every((wanted) => edge.rel.toLowerCase().startsWith(wanted))) continue
      if (query.type.length > 0) {
        const ends = [typeOf.get(edge.source), typeOf.get(edge.target)]
        if (!ends.some((type) => type !== undefined && typeMatches(type))) continue
      }
      const score = query.words.length === 0 ? 1 : scoreEdge(edge, query.words, titles)
      // Relationships rank below an equally good entity: they are found through their ends.
      if (score !== null) results.push({ kind: 'relationship', edge, score: score - 0.5 })
    }
  }

  return results
    .sort((a, b) => b.score - a.score || compare(resultLabel(a), resultLabel(b)))
    .slice(0, limit)
}

const resultLabel = (result: QuickResult): string =>
  result.kind === 'entity' ? result.entity.id : edgeKey(result.edge)

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// --- Provenance ---------------------------------------------------------------

/** Where an observation points, in one line: `src/a.ts:12-40 · handler`, `GET /v1/orders`. */
export const evidenceLocation = (evidence: Record<string, unknown>): string => {
  const text = (key: string): string => (typeof evidence[key] === 'string' ? (evidence[key] as string) : '')
  const file = text('path') ? `${text('path')}${text('lines') ? `:${text('lines')}` : ''}` : ''
  const endpoint = [text('method'), text('endpoint')].filter(Boolean).join(' ')
  return [text('repository'), file, text('symbol'), text('key'), endpoint].filter(Boolean).join(' · ')
}

/** Fields `evidenceLocation`, the URL list and the byline already show. */
export const EVIDENCE_SHOWN = new Set([
  'source', 'repository', 'path', 'lines', 'symbol', 'key', 'method', 'endpoint', 'urls', 'observedAt', 'observedBy', 'note'
])

const BASIS_LABEL: Record<string, string> = {
  evidence: 'from evidence',
  stated: 'stated in the file',
  unevidenced: 'default - no evidence'
}

export const basisLabel = (basis: string): string => BASIS_LABEL[basis] ?? basis

/** A link-ish string worth making clickable. */
export const isUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\/\S+$/.test(value)

// --- Notes --------------------------------------------------------------------

/** A run of inline text: plain, `code`, a `[[mention]]` or a link. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'mention'; id: string }
  | { kind: 'link'; text: string; href: string }

export type Block =
  | { kind: 'heading'; level: number; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'code'; text: string }

const INLINE = /`([^`\n]+)`|\[\[([^\]\n]+)\]\]|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)<>]+[^\s)<>.,;:!?'"])/g

export const inline = (text: string): Inline[] => {
  const runs: Inline[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > last) runs.push({ kind: 'text', text: text.slice(last, at) })
    if (match[1] !== undefined) runs.push({ kind: 'code', text: match[1] })
    else if (match[2] !== undefined) runs.push({ kind: 'mention', id: match[2].trim() })
    else if (match[3] !== undefined && match[4] !== undefined) runs.push({ kind: 'link', text: match[3], href: match[4] })
    else if (match[5] !== undefined) runs.push({ kind: 'link', text: match[5], href: match[5] })
    last = at + match[0].length
  }
  if (last < text.length) runs.push({ kind: 'text', text: text.slice(last) })
  return runs
}

/**
 * Just enough Markdown to read notes comfortably - headings, paragraphs,
 * lists, fenced code, inline code, links and mentions - as data, never HTML,
 * so nothing in a file can inject markup into the page.
 */
export const blocks = (markdown: string): Block[] => {
  const result: Block[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: string[] | null = null

  const flush = (): void => {
    if (paragraph.length > 0) result.push({ kind: 'paragraph', text: inline(paragraph.join(' ')) })
    if (list) result.push({ kind: 'list', items: list.map(inline) })
    paragraph = []
    list = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      for (index += 1; index < lines.length && !(lines[index] ?? '').trim().startsWith(fence[1] ?? '```'); index += 1) {
        code.push(lines[index] ?? '')
      }
      result.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      result.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: inline(heading[2] ?? '') })
    } else if (item) {
      if (paragraph.length > 0) flush()
      list ??= []
      list.push(item[1] ?? '')
    } else if (line.trim() === '') {
      flush()
    } else if (list && /^\s+/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`
    } else {
      if (list) flush()
      paragraph.push(line.trim())
    }
  }
  flush()
  return result
}

// --- Chat ---------------------------------------------------------------------

/**
 * A summary's citations - `[id]`, or an id in backticks - as `[[id]]`
 * mentions, so its text reads like any exhibit's notes with each cited exhibit
 * one click away. Only ids it cites change: other brackets and code, and
 * Markdown links, stay as they were.
 */
export const citationsAsMentions = (text: string, cited: ReadonlySet<string>): string =>
  text.replace(/(?<!\[)\[([^[\]\s]+)\](?![\](])|`([^`\s]+)`/g, (whole, bracketed?: string, quoted?: string) => {
    const id = bracketed ?? quoted ?? ''
    return cited.has(id) ? `[[${id}]]` : whole
  })

/**
 * What the board shows for a chat reply: the exhibits its summary cites and
 * the paths joining them - else, with no summary or no citations, everything
 * search found, as Ask shows it.
 */
export const boardAnswer = (reply: UiChatAnswer): UiAnswer => {
  const cited = new Set(reply.summary?.cited ?? [])
  if (cited.size === 0) return reply.answer
  return {
    ...reply.answer,
    documents: reply.answer.documents.filter((document) => cited.has(document.id)),
    paths: reply.answer.paths.filter((path) => cited.has(path.nodes[0] ?? '') && cited.has(path.nodes.at(-1) ?? ''))
  }
}
