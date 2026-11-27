// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { chatTitle } from './index.js'

describe('chatTitle', () => {
  it('keeps a short question as it is, on one line', () => {
    expect(chatTitle('  Who owns\n the orders service? ')).toBe('Who owns the orders service?')
  })

  it('cuts a long one at 120 characters with an ellipsis', () => {
    const title = chatTitle('why '.repeat(60))
    expect(title).toHaveLength(120)
    expect(title.endsWith('…')).toBe(true)
  })
})
