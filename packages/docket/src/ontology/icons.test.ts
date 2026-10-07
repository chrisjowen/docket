import { describe, expect, it } from 'vitest'

import { DEFAULT_TYPE_ICONS, FALLBACK_ICON, ICON_NAMES, iconFor } from './icons.js'

describe('iconFor', () => {
  it('uses the icon a type declares', () => {
    expect(iconFor('service', 'rocket')).toBe('rocket')
    expect(iconFor('ledger', 'database')).toBe('database')
  })

  it('falls back to the built-in icon for a starter type, then to the generic one', () => {
    expect(iconFor('service')).toBe('server')
    expect(iconFor('service', 'piggy-bank')).toBe('server')
    expect(iconFor('ledger')).toBe(FALLBACK_ICON)
    expect(iconFor('constructor')).toBe(FALLBACK_ICON)
  })

  it('only gives out icons it bundles', () => {
    const known = new Set<string>(ICON_NAMES)
    expect(known.has(FALLBACK_ICON)).toBe(true)
    for (const icon of Object.values(DEFAULT_TYPE_ICONS)) expect(known, icon).toContain(icon)
    expect([...ICON_NAMES].sort()).toEqual([...ICON_NAMES])
  })
})
