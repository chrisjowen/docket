// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { checkoutProblem } from './index.js'

const CHECKOUT = 'docket-platform-0123456789ab'

describe('checkoutProblem', () => {
  it('takes docket checkout ids and refuses whitespace, control characters and empty or long ids', () => {
    expect(checkoutProblem(CHECKOUT)).toBeNull()
    expect(checkoutProblem('docket-mon-projet-é-0123456789ab')).toBeNull()
    for (const bad of ['', 'a b', 'a\nb', 'x'.repeat(201), 42, undefined]) expect(checkoutProblem(bad), String(bad)).not.toBeNull()
  })
})
