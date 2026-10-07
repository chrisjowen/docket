import type { UiPath, UiPathStep } from './types.js'

/** Longer chains connect almost anything to anything, which says nothing. */
export const MAX_PATH_LENGTH = 3

/** Found entities considered for paths. Pairs grow quadratically. */
export const MAX_PATH_ENDPOINTS = 8

interface Edge {
  source: string
  rel: string
  target: string
}

interface Neighbour {
  id: string
  step: UiPathStep
}

const adjacency = (edges: readonly Edge[]): Map<string, Neighbour[]> => {
  const neighbours = new Map<string, Neighbour[]>()
  const add = (from: string, neighbour: Neighbour): void => {
    const list = neighbours.get(from)
    if (list) list.push(neighbour)
    else neighbours.set(from, [neighbour])
  }
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    add(edge.source, { id: edge.target, step: { rel: edge.rel, forward: true } })
    add(edge.target, { id: edge.source, step: { rel: edge.rel, forward: false } })
  }
  // Sorted so the same files always give the same paths.
  for (const list of neighbours.values()) {
    list.sort((a, b) => compare(a.id, b.id) || compare(a.step.rel, b.step.rel) || Number(b.step.forward) - Number(a.step.forward))
  }
  return neighbours
}

/** Breadth-first, ignoring direction: a shortest chain from `from` to `to`, or null. */
const shortestPath = (
  neighbours: Map<string, Neighbour[]>,
  from: string,
  to: string,
  maxLength: number
): UiPath | null => {
  const previous = new Map<string, { id: string; step: UiPathStep } | null>([[from, null]])
  let frontier = [from]
  for (let depth = 0; depth < maxLength && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbour of neighbours.get(id) ?? []) {
        if (previous.has(neighbour.id)) continue
        previous.set(neighbour.id, { id, step: neighbour.step })
        if (neighbour.id === to) return walkBack(previous, to)
        next.push(neighbour.id)
      }
    }
    frontier = next
  }
  return null
}

const walkBack = (
  previous: Map<string, { id: string; step: UiPathStep } | null>,
  to: string
): UiPath => {
  const nodes = [to]
  const steps: UiPathStep[] = []
  for (let link = previous.get(to); link; link = previous.get(link.id)) {
    nodes.unshift(link.id)
    steps.unshift(link.step)
  }
  return { nodes, steps }
}

/**
 * How the entities a search found relate to each other: the shortest chain of
 * relationships, in either direction, between each pair of them. A search hit
 * says which entities matter; the paths say why they belong together.
 */
export const connectingPaths = (
  edges: readonly Edge[],
  ids: readonly string[],
  maxLength: number = MAX_PATH_LENGTH
): UiPath[] => {
  const neighbours = adjacency(edges)
  const endpoints = [...new Set(ids)].slice(0, MAX_PATH_ENDPOINTS)
  const paths: UiPath[] = []
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const path = shortestPath(neighbours, endpoints[i] as string, endpoints[j] as string, maxLength)
      if (path) paths.push(path)
    }
  }
  return paths.sort((a, b) => a.steps.length - b.steps.length || compare(a.nodes.join(' '), b.nodes.join(' ')))
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
