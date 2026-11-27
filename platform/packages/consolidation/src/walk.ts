// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import type { CloudGraph } from '@docket/platform-canonical-store'

type Entity = CloudGraph['entities'][number]
type Edge = CloudGraph['edges'][number]

/**
 * A neighbourhood snapshot: the target entity, its direct neighbours (1 hop)
 * and their neighbours for context (2 hops), with the evidence on the target
 * and its direct links. The input to summarization.
 */
export interface Neighbourhood {
  target: {
    id: string
    type: string
    title: string
    /** How far the documents' evidence supports the resource, 0 to 1. */
    confidence: number
    attributes?: Record<string, unknown>
    content?: string
  }
  direct: Array<{
    id: string
    type: string
    title: string
    rel: string
    attributes?: Record<string, unknown>
  }>
  context: Array<{
    id: string
    type: string
    title: string
    via: string
  }>
  /** Each entry with the confidence of the resource or link it supports. */
  evidence: Array<{ id: string; path: string; note?: string; confidence: number }>
  /**
   * A digest of everything the neighbourhood was read from, past what the
   * model is shown: the target's full notes, each direct neighbour's notes,
   * attributes and evidence, and all the context and evidence.
   */
  digest: string
}

/** A workspace graph indexed once per run: entities by id, edges by either end. */
export interface GraphIndex {
  entities: ReadonlyMap<string, Entity>
  edges: ReadonlyMap<string, readonly Edge[]>
}

export function indexGraph(graph: Pick<CloudGraph, 'entities' | 'edges'>): GraphIndex {
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]))
  const edges = new Map<string, Edge[]>()
  const add = (id: string, edge: Edge) => {
    const list = edges.get(id)
    if (list) list.push(edge)
    else edges.set(id, [edge])
  }
  for (const edge of graph.edges) {
    add(edge.source, edge)
    if (edge.target !== edge.source) add(edge.target, edge)
  }
  return { entities, edges }
}

/** What the model is shown, and so all a summary can cite or be trusted for. */
const CONTEXT = 10
const EVIDENCE = 10

const confidenceOf = (on: { assessment?: { confidence: number } | undefined }): number => on.assessment?.confidence ?? 0

const evidenceOf = (on: { evidence?: readonly Record<string, unknown>[] | undefined; assessment?: { confidence: number } | undefined }): Neighbourhood['evidence'] =>
  (on.evidence ?? []).flatMap((entry) => {
    const id = entry.symbol ?? entry.path
    if (id === undefined || entry.path === undefined) return []
    return [{ id: String(id), path: String(entry.path), ...(entry.note ? { note: String(entry.note) } : {}), confidence: confidenceOf(on) }]
  })

/** The neighbourhood of one entity, read from the index; null when the graph has no such entity. */
export function walkNeighbourhood(index: GraphIndex, resourceId: string): Neighbourhood | null {
  const target = index.entities.get(resourceId)
  if (!target) return null

  const directEdges = new Map<string, Edge>()
  const direct: Neighbourhood['direct'] = []
  for (const edge of index.edges.get(resourceId) ?? []) {
    const other = edge.source === resourceId ? edge.target : edge.source
    if (directEdges.has(other)) continue
    const entity = index.entities.get(other)
    if (!entity) continue
    directEdges.set(other, edge)
    direct.push({
      id: entity.id,
      type: entity.type,
      title: entity.title,
      rel: edge.source === resourceId ? edge.rel : `~${edge.rel}`,
      ...(edge.attributes ? { attributes: edge.attributes } : {}),
    })
  }

  const contextIds = new Set<string>()
  const context: Neighbourhood['context'] = []
  for (const d of direct) {
    for (const edge of index.edges.get(d.id) ?? []) {
      const other = edge.source === d.id ? edge.target : edge.source
      if (other === resourceId || directEdges.has(other) || contextIds.has(other)) continue
      const entity = index.entities.get(other)
      if (!entity) continue
      contextIds.add(other)
      context.push({ id: entity.id, type: entity.type, title: entity.title, via: `${d.id} ${edge.source === d.id ? edge.rel : `~${edge.rel}`}` })
    }
  }

  const evidence = [...evidenceOf(target), ...[...directEdges.values()].flatMap((edge) => evidenceOf(edge))]
  // Notes are trimmed: adding a summary document re-joins them without their leading blank line.
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        target: [target.attributes, target.content.trim()],
        direct: direct.map((d) => {
          const entity = index.entities.get(d.id)
          return [d.id, entity?.attributes, entity?.content.trim(), entity?.evidence]
        }),
        context,
        evidence,
      }),
    )
    .digest('hex')

  return {
    target: {
      id: target.id,
      type: target.type,
      title: target.title,
      confidence: confidenceOf(target),
      ...(Object.keys(target.attributes).length ? { attributes: target.attributes } : {}),
      ...(target.content.trim() ? { content: target.content.trim() } : {}),
    },
    direct,
    context: context.slice(0, CONTEXT),
    evidence: evidence.slice(0, EVIDENCE),
    digest,
  }
}

/**
 * The entities of one's type within two hops of it, which could be the same
 * thing: not counting a path that runs only through an owner they share, as
 * everything a team owns is two hops from everything else it owns.
 */
export function duplicateCandidates(index: GraphIndex, resourceId: string): Entity[] {
  const target = index.entities.get(resourceId)
  if (!target) return []
  const hops = (id: string) =>
    (index.edges.get(id) ?? []).map((edge) => ({
      other: edge.source === id ? edge.target : edge.source,
      toOwner: edge.rel === 'owned_by' && edge.source === id,
      fromOwned: edge.rel === 'owned_by' && edge.target === id,
    }))
  const near = new Set<string>()
  for (const first of hops(resourceId)) {
    near.add(first.other)
    for (const second of hops(first.other)) if (!(first.toOwner && second.fromOwned)) near.add(second.other)
  }
  near.delete(resourceId)
  return [...near].flatMap((id) => {
    const entity = index.entities.get(id)
    return entity && entity.type === target.type ? [entity] : []
  })
}
