// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where the Record's network puts each case card, and how its connectors
 * run. Records settle by force-directed placement, gathered by type, then
 * are pushed clear of one another and snapped to the canvas's dot grid. The
 * same graph always lays out the same way, so a record stays where it was
 * found between visits.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'

/** A card's size and the room kept round it, in canvas units; the grid matches the canvas's dots. */
export const CARD = { w: 228, h: 80, gapX: 56, gapY: 44, grid: 24 } as const

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  w: number
  h: number
}

interface Body extends SimulationNodeDatum {
  id: string
}

/** A small seeded generator, so the simulation's jiggle is the same every time. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

/** Cards are wider than tall: the simulation runs with height stretched by this, so round collisions keep oblong cards apart. */
const STRETCH = (CARD.w + CARD.gapX) / (CARD.h + CARD.gapY)

const snap = (value: number) => Math.round(value / CARD.grid) * CARD.grid || 0

/** Push apart any two cards closer than a card and its gap, along whichever axis needs the smaller move. */
function separate(bodies: Point[]): void {
  const needX = CARD.w + CARD.gapX
  const needY = CARD.h + CARD.gapY
  for (let pass = 0; pass < 80; pass += 1) {
    let moved = false
    const order = [...bodies].sort((a, b) => a.x - b.x)
    for (let i = 0; i < order.length; i += 1) {
      const a = order[i] as Point
      for (let j = i + 1; j < order.length; j += 1) {
        const b = order[j] as Point
        const dx = b.x - a.x
        if (dx >= needX) break
        const dy = b.y - a.y
        const overX = needX - Math.abs(dx)
        const overY = needY - Math.abs(dy)
        if (overX <= 0 || overY <= 0) continue
        moved = true
        // Move the shorter way: oblong cards mostly stack, unless they already sit side by side.
        if (overY / needY <= overX / needX) {
          const push = (overY / 2 + 1) * (dy < 0 ? -1 : 1)
          a.y -= push
          b.y += push
        } else {
          const push = (overX / 2 + 1) * (dx < 0 ? -1 : 1)
          a.x -= push
          b.x += push
        }
      }
    }
    if (!moved) return
  }
}

/** Every card's centre, by record id. */
export function layoutCards(nodes: readonly { id: string; type: string }[], links: readonly { source: string; target: string }[]): Map<string, Point> {
  const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (sorted.length === 0) return new Map()
  const types = [...new Set(sorted.map((node) => node.type))].sort()
  // Each type gathers round its own point on a ring, sized to the graph.
  const radius = types.length > 1 ? Math.max(220, Math.sqrt(sorted.length) * 110) : 0
  const anchor = new Map(
    types.map((type, index) => {
      const angle = (2 * Math.PI * index) / types.length - Math.PI / 2
      return [type, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.7 * STRETCH }]
    }),
  )
  const bodies: Body[] = sorted.map((node, index) => {
    const home = anchor.get(node.type) ?? { x: 0, y: 0 }
    // A phyllotaxis spiral round the type's point: spread, and the same every time.
    const turn = index * 2.399963
    const spiral = 40 * Math.sqrt(index + 0.5)
    return { id: node.id, x: home.x + Math.cos(turn) * spiral, y: home.y + Math.sin(turn) * spiral }
  })
  const ids = new Set(sorted.map((node) => node.id))
  const edges = links
    .filter((link) => link.source !== link.target && ids.has(link.source) && ids.has(link.target))
    .map((link) => ({ source: link.source, target: link.target }))
    .sort((a, b) => (`${a.source}\u0000${a.target}` < `${b.source}\u0000${b.target}` ? -1 : 1))
  const typeOf = new Map(sorted.map((node) => [node.id, node.type]))
  const home = (body: Body) => anchor.get(typeOf.get(body.id) ?? '') ?? { x: 0, y: 0 }

  const simulation = forceSimulation<Body>(bodies)
    .randomSource(seeded(7))
    .force('link', forceLink<Body, { source: string | Body; target: string | Body }>(edges).id((body) => body.id).distance(CARD.w + CARD.gapX).strength(0.6))
    .force('charge', forceManyBody<Body>().strength(-420).distanceMax(900))
    .force('collide', forceCollide<Body>((CARD.w + CARD.gapX) / 2).strength(0.9))
    .force('x', forceX<Body>((body) => home(body).x).strength(0.035))
    .force('y', forceY<Body>((body) => home(body).y).strength(0.035))
    .stop()
  for (let i = 0; i < 300; i += 1) simulation.tick()

  const placed = bodies.map((body) => ({ id: body.id, x: body.x ?? 0, y: (body.y ?? 0) / STRETCH }))
  separate(placed)
  return new Map(placed.map((body) => [body.id, { x: snap(body.x), y: snap(body.y) }]))
}

/** A cubic Bézier's path and its midpoint. */
const bezier = (p0: Point, p1: Point, p2: Point, p3: Point) => ({
  d: `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`,
  mx: 0.125 * p0.x + 0.375 * p1.x + 0.375 * p2.x + 0.125 * p3.x,
  my: 0.125 * p0.y + 0.375 * p1.y + 0.375 * p2.y + 0.125 * p3.y,
})

const round = (value: number) => Math.round(value * 10) / 10

/** A curved connector from one card to another, leaving from whichever edges face each other; its label sits at `mx, my`. */
export function connector(a: Point, b: Point): { d: string; mx: number; my: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) > Math.abs(dy) * 1.3) {
    const side = Math.sign(dx)
    const from = { x: round(a.x + (CARD.w / 2) * side), y: round(a.y) }
    const to = { x: round(b.x - (CARD.w / 2) * side), y: round(b.y) }
    const pull = Math.min(160, Math.abs(to.x - from.x) * 0.5 + 20)
    return bezier(from, { x: from.x + pull * side, y: from.y }, { x: to.x - pull * side, y: to.y }, to)
  }
  const side = Math.sign(dy) || 1
  const from = { x: round(a.x), y: round(a.y + (CARD.h / 2) * side) }
  const to = { x: round(b.x), y: round(b.y - (CARD.h / 2) * side) }
  const pull = Math.min(140, Math.abs(to.y - from.y) * 0.5 + 20)
  return bezier(from, { x: from.x, y: from.y + pull * side }, { x: to.x, y: to.y - pull * side }, to)
}

/** The box round these cards, whole; null when none of them is placed. */
export function boxOf(ids: Iterable<string>, placed: ReadonlyMap<string, Point>): Box | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const id of ids) {
    const at = placed.get(id)
    if (!at) continue
    x0 = Math.min(x0, at.x - CARD.w / 2)
    y0 = Math.min(y0, at.y - CARD.h / 2)
    x1 = Math.max(x1, at.x + CARD.w / 2)
    y1 = Math.max(y1, at.y + CARD.h / 2)
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
