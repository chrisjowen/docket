import { DEFAULT_SEARCH_LIMIT, search } from '../commands/search.js'
import { iconFor } from '../ontology/icons.js'
import { readGraph } from '../open/graph.js'
import { describePath } from '../query/legacy.js'
import { SEARCH_SCHEMA, type SearchGraph, type SearchLink, type SearchMatch, type SearchNode, type SearchPath, type SearchVia } from './types.js'

/** The most hits `docket_search` asks of each projection. */
export const MAX_SEARCH_LIMIT = 50

/** The most entities the board carries: every match, then returned nodes, then neighbours, until it is full. */
export const MAX_NODES = 60

export interface SearchGraphOptions {
  /** The docket's directory: `.docket.yaml` is resolved from it. */
  cwd: string
  query: string
  /** Hits asked of each projection. */
  limit?: number | undefined
  /** `docket open`'s address, when it serves the search. */
  viewer?: string | null | undefined
}

/**
 * `docket search`, with the board drawn for it (docs/mcp.md): every resource
 * the projections found, most relevant first (the order the first answering
 * projection ranked them in), then the subgraphs the projections returned -
 * their nodes, relationships and paths, as returned (docs/adapter-spec.md
 * §13). Then, as canonical context, the resources one link away from the
 * matches and the links between everything on the board, read from the
 * canonical files.
 */
export const searchGraph = async (options: SearchGraphOptions): Promise<SearchGraph> => {
  const [result, graph] = await Promise.all([
    search(options.query, { cwd: options.cwd, limit: options.limit ?? DEFAULT_SEARCH_LIMIT }),
    readGraph(options.cwd)
  ])

  const documents = new Map(result.documents.map((document) => [document.id, document]))
  const ranked = [...new Set([...result.sources.flatMap((source) => source.hits.map((hit) => hit.id)), ...documents.keys()])]
  const matches: SearchMatch[] = ranked.flatMap((id) => {
    const document = documents.get(id)
    return document ? [{ ...document, foundBy: [...document.foundBy] }] : []
  })

  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]))
  const nodeOf = (id: string, match: boolean, via: SearchVia, returned?: { label: string; type?: string }): SearchNode => {
    const entity = entities.get(id)
    if (entity) return { id, type: entity.type, title: entity.title, path: entity.path, match, ghost: false, via }
    const found = documents.get(id)
    return found
      ? { id, type: found.type, title: found.title, path: found.path, match, ghost: false, via }
      : { id, type: returned?.type ?? '', title: returned?.label || id, match, ghost: true, via }
  }

  const board = new Map<string, SearchNode>(matches.map((match) => [match.id, nodeOf(match.id, true, 'adapter')]))
  const subgraphs = result.sources.flatMap((source) => (source.graph ? [{ by: source.name, ...source.graph }] : []))
  const returned = new Map<string, SearchNode>()
  for (const subgraph of subgraphs) {
    for (const node of subgraph.nodes) {
      if (!board.has(node.id) && !returned.has(node.id)) returned.set(node.id, nodeOf(node.id, false, 'adapter', node))
    }
  }
  const neighbours: string[] = []
  for (const match of matches) {
    for (const edge of graph.edges) {
      const other = edge.source === match.id ? edge.target : edge.target === match.id ? edge.source : null
      if (other !== null && !board.has(other) && !returned.has(other) && !neighbours.includes(other)) neighbours.push(other)
    }
  }
  const room = Math.max(0, MAX_NODES - board.size)
  const kept = [...returned.values()].slice(0, room)
  for (const node of kept) board.set(node.id, node)
  const left = Math.max(0, room - kept.length)
  for (const id of neighbours.slice(0, left)) board.set(id, nodeOf(id, false, 'canonical'))

  const keyOf = (link: { source: string; rel: string; target: string }): string => `${link.source}\u0000${link.rel}\u0000${link.target}`
  const links = new Map<string, SearchLink>()
  for (const subgraph of subgraphs) {
    for (const edge of subgraph.edges) {
      if (!board.has(edge.source) || !board.has(edge.target)) continue
      const key = keyOf(edge)
      const known = links.get(key)
      if (!known) {
        links.set(key, {
          source: edge.source,
          rel: edge.rel,
          target: edge.target,
          via: 'adapter',
          foundBy: [subgraph.by],
          ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
          ...(edge.why.length > 0 ? { why: [...edge.why] } : {})
        })
        continue
      }
      if (!known.foundBy?.includes(subgraph.by)) known.foundBy = [...(known.foundBy ?? []), subgraph.by]
      if (edge.confidence !== undefined && (known.confidence === undefined || edge.confidence > known.confidence)) known.confidence = edge.confidence
      const why = [...new Set([...(known.why ?? []), ...edge.why])]
      if (why.length > 0) known.why = why
    }
  }
  for (const edge of graph.edges) {
    const key = keyOf(edge)
    if (!board.has(edge.source) || !board.has(edge.target) || links.has(key)) continue
    links.set(key, { source: edge.source, rel: edge.rel, target: edge.target, via: 'canonical' })
  }

  const paths = new Map<string, SearchPath>()
  for (const subgraph of subgraphs) {
    for (const path of subgraph.paths) {
      if (!path.every((id) => board.has(id))) continue
      const key = path.join('\u0000')
      const known = paths.get(key)
      if (!known) paths.set(key, { nodes: [...path], foundBy: [subgraph.by] })
      else if (!known.foundBy.includes(subgraph.by)) known.foundBy.push(subgraph.by)
    }
  }
  for (const path of paths.values()) {
    const steps = new Set(path.nodes.slice(1).flatMap((id, index) => [`${path.nodes[index]}\u0000${id}`, `${id}\u0000${path.nodes[index]}`]))
    const why = [...new Set([...links.values()].filter((link) => link.via === 'adapter' && steps.has(`${link.source}\u0000${link.target}`)).flatMap((link) => link.why ?? []))]
    if (why.length > 0) path.why = why
  }

  const counts = new Map<string, number>()
  for (const entity of graph.entities) counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1)
  const icons = new Map(graph.types.map((type) => [type.name, type.icon]))

  return {
    schema: SEARCH_SCHEMA,
    query: result.query,
    project: graph.project,
    matches,
    nodes: [...board.values()],
    links: [...links.values()],
    paths: [...paths.values()],
    omitted: returned.size - kept.length + Math.max(0, neighbours.length - left),
    types: [...new Set([...icons.keys(), ...counts.keys()])].map((name) => ({
      name,
      icon: icons.get(name) ?? iconFor(name),
      count: counts.get(name) ?? 0
    })),
    sources: result.sources.map((source) => ({
      name: source.name,
      hits: source.hits.length,
      ...(source.note ? { note: source.note } : {}),
      ...(source.error ? { error: source.error } : {})
    })),
    index: graph.index,
    viewer: options.viewer ?? null,
    warnings: result.diagnostics.map((diagnostic) => diagnostic.message)
  }
}

/** At most this much of one piece of evidence goes in the text: the file holds the rest. */
const WHY_CHARS = 200

const brief = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > WHY_CHARS ? `${flat.slice(0, WHY_CHARS - 1)}…` : flat
}

/** A returned link's provenance: who returned it, and how far it holds it supported. */
const provenance = (link: SearchLink): string =>
  `${(link.foundBy ?? []).join(', ')}${link.confidence === undefined ? '' : `, confidence ${link.confidence}`}`

/**
 * The same result as text, for the model reading the tool's answer: each
 * match with its file and its links on the board, the paths and relationships
 * the projections returned with why they hold, then how each projection
 * answered.
 */
export const searchText = (found: SearchGraph): string => {
  const lines: string[] = []
  const count = found.matches.length
  lines.push(
    `Docket search for "${found.query}" in ${found.project.name} (${found.project.root}): ` +
      `${count === 0 ? 'nothing found' : `${count} ${count === 1 ? 'resource' : 'resources'}`}.`
  )
  const by = (link: SearchLink): string => (link.via === 'adapter' ? ` (${provenance(link)})` : '')
  for (const match of found.matches) {
    const confidence = match.confidence === undefined ? '' : `, confidence ${match.confidence}`
    lines.push('', `- ${match.id} (${match.type}) "${match.title}": ${match.path}${confidence}`)
    const outgoing = found.links.filter((link) => link.source === match.id).map((link) => `${link.rel} -> ${link.target}${by(link)}`)
    const incoming = found.links.filter((link) => link.target === match.id).map((link) => `${link.source} ${link.rel} ->${by(link)}`)
    if (outgoing.length > 0) lines.push(`  links: ${outgoing.join('; ')}`)
    if (incoming.length > 0) lines.push(`  linked from: ${incoming.join('; ')}`)
  }
  const label = (node: SearchNode): string => (node.ghost ? `${node.id} (no file yet)` : `${node.id} "${node.title}"`)
  const returned = found.nodes.filter((node) => !node.match && node.via === 'adapter')
  if (returned.length > 0) lines.push('', `Also returned by the projections: ${returned.map(label).join(', ')}.`)
  const relationships = found.links.filter((link) => link.via === 'adapter')
  if (found.paths.length > 0) {
    lines.push('', 'Paths the projections returned:')
    for (const path of found.paths) {
      lines.push(`- ${describePath(relationships, path.nodes)} (${path.foundBy.join(', ')})`)
      for (const why of path.why ?? []) lines.push(`  why: ${brief(why)}`)
    }
  }
  if (relationships.length > 0) {
    lines.push('', 'Relationships the projections returned, and why they hold:')
    for (const link of relationships) {
      lines.push(`- ${link.source} -${link.rel}-> ${link.target} (${provenance(link)})`)
      for (const why of link.why ?? []) lines.push(`  why: ${brief(why)}`)
    }
  }
  const neighbours = found.nodes.filter((node) => !node.match && node.via === 'canonical')
  if (neighbours.length > 0) {
    lines.push('', `One link away: ${neighbours.map(label).join(', ')}` + (found.omitted > 0 ? `, and ${found.omitted} more` : '') + '.')
  } else if (found.omitted > 0) {
    lines.push('', `${found.omitted} more returned resources are left off.`)
  }
  lines.push('')
  if (found.sources.length === 0) lines.push('No configured projection can search.')
  for (const source of found.sources) {
    const how = source.error ? `unavailable: ${source.error}` : `${source.hits} ${source.hits === 1 ? 'hit' : 'hits'}`
    lines.push(`${source.name}: ${how}${source.note ? ` (${source.note.replace(/\s+/g, ' ')})` : ''}`)
  }
  if (!found.index.synced || found.index.behind > 0) {
    lines.push(`The search index is behind the files${found.index.behind > 0 ? ` by ${found.index.behind} resources` : ''}: run \`docket sync\`.`)
  }
  for (const warning of found.warnings) lines.push(`Warning: ${warning}`)
  lines.push('', 'Read the canonical files above for the full record.')
  return lines.join('\n')
}
