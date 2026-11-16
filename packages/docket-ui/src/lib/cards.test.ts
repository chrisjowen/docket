import { describe, expect, it } from 'vitest'

import { CARD, boxOf, connector, layoutCards } from './cards.js'

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < CARD.w && Math.abs(a.y - b.y) < CARD.h

const ring = (count: number) => {
  const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, type: ['service', 'api', 'team'][index % 3] ?? 'service' }))
  const links = nodes.slice(1).map((node, index) => ({ source: `n${index}`, target: node.id }))
  return { nodes, links }
}

describe('the card layout', () => {
  it('places every card, none overlapping another', () => {
    const { nodes, links } = ring(40)
    const placed = layoutCards(nodes, links)
    expect(placed.size).toBe(40)
    const all = [...placed.values()]
    for (const [index, a] of all.entries()) for (const b of all.slice(index + 1)) expect(overlaps(a, b)).toBe(false)
  })

  it('snaps cards to the canvas dot grid', () => {
    const { nodes, links } = ring(12)
    for (const { x, y } of layoutCards(nodes, links).values()) {
      expect(Math.abs(x % CARD.grid)).toBe(0)
      expect(Math.abs(y % CARD.grid)).toBe(0)
    }
  })

  it('lays the same graph out the same way every time, whatever order it arrives in', () => {
    const { nodes, links } = ring(20)
    const first = layoutCards(nodes, links)
    const again = layoutCards([...nodes].reverse(), [...links].reverse())
    for (const [id, at] of first) expect(again.get(id)).toEqual(at)
  })

  it('keeps a type together', () => {
    const nodes = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `svc${index}`, type: 'service' })),
      ...Array.from({ length: 6 }, (_, index) => ({ id: `team${index}`, type: 'team' }))
    ]
    const placed = layoutCards(nodes, [])
    const centre = (prefix: string) => {
      const mine = [...placed].filter(([id]) => id.startsWith(prefix)).map(([, at]) => at)
      return { x: mine.reduce((sum, at) => sum + at.x, 0) / mine.length, y: mine.reduce((sum, at) => sum + at.y, 0) / mine.length }
    }
    const spread = (prefix: string) => {
      const middle = centre(prefix)
      return Math.max(...[...placed].filter(([id]) => id.startsWith(prefix)).map(([, at]) => Math.hypot(at.x - middle.x, at.y - middle.y)))
    }
    const apart = Math.hypot(centre('svc').x - centre('team').x, centre('svc').y - centre('team').y)
    expect(apart).toBeGreaterThan(spread('svc'))
  })

  it('copes with nothing at all', () => {
    expect(layoutCards([], []).size).toBe(0)
  })
})

describe('a connector', () => {
  it('leaves from the side edges when the cards sit side by side', () => {
    const path = connector({ x: 0, y: 0 }, { x: 600, y: 40 })
    expect(path.d.startsWith(`M${CARD.w / 2},0`)).toBe(true)
    expect(path.d.endsWith(`${600 - CARD.w / 2},40`)).toBe(true)
  })

  it('leaves from the top or bottom edge when one card sits above the other', () => {
    const path = connector({ x: 0, y: 0 }, { x: 40, y: 400 })
    expect(path.d.startsWith(`M0,${CARD.h / 2}`)).toBe(true)
    expect(path.d.endsWith(`40,${400 - CARD.h / 2}`)).toBe(true)
  })

  it('puts its label between the two cards', () => {
    const path = connector({ x: 0, y: 0 }, { x: 600, y: 0 })
    expect(path.mx).toBeCloseTo(300)
    expect(path.my).toBeCloseTo(0)
  })
})

describe('the box round some cards', () => {
  it('takes in the whole of every card', () => {
    const placed = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 500, y: 300 }]
    ])
    expect(boxOf(['a', 'b', 'missing'], placed)).toEqual({ x: -CARD.w / 2, y: -CARD.h / 2, w: 500 + CARD.w, h: 300 + CARD.h })
    expect(boxOf(['missing'], placed)).toBeNull()
  })
})
