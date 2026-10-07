import { describe, expect, it } from 'vitest'

import { ICON_NAMES } from '../../../docket/src/ontology/icons.js'
import { ICONS, iconOf } from './icons.js'

describe('ICONS', () => {
  it('bundles exactly the icons docket validates an ontology against', () => {
    expect(Object.keys(ICONS).sort()).toEqual([...ICON_NAMES].sort())
    for (const name of ICON_NAMES) expect(ICONS[name], name).toBeTypeOf('function')
  })

  it('resolves a type the way the server does, falling back for one nobody declared', () => {
    expect(iconOf('service', 'rocket')).toBe(ICONS.rocket)
    expect(iconOf('service')).toBe(ICONS.server)
    expect(iconOf('ledger')).toBe(ICONS['circle-dot'])
  })
})
