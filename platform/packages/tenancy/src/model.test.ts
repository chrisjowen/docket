// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { normaliseLogin } from './model.js'

describe('normaliseLogin', () => {
  it('strips @, lowercases, and refuses what GitHub would', () => {
    expect(normaliseLogin(' @Alice-B ')).toBe('alice-b')
    expect(normaliseLogin('-alice')).toBeNull()
    expect(normaliseLogin('a--b')).toBeNull()
    expect(normaliseLogin('a'.repeat(40))).toBeNull()
  })
})
