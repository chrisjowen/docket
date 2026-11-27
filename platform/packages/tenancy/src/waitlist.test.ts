// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { isTeamSize } from './waitlist.js'

describe('isTeamSize', () => {
  it('accepts the sizes the form offers and nothing else', () => {
    expect(isTeamSize('2-5')).toBe(true)
    expect(isTeamSize('51+')).toBe(true)
    expect(isTeamSize('3')).toBe(false)
    expect(isTeamSize(null)).toBe(false)
  })
})
