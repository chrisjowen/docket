// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { checkScope } from './effective-permission.js'

describe('checkScope', () => {
  it('refuses with 403 insufficient_scope, or 401 when nothing is left', () => {
    expect(checkScope(['docket:read', 'docket:write'], 'docket:write')).toBeNull()
    expect(checkScope(['docket:read'], 'docket:write')).toMatchObject({ status: 403, error: 'insufficient_scope', scope: 'docket:write' })
    expect(checkScope([], 'docket:read')).toMatchObject({ status: 401, error: 'invalid_token' })
  })
})
