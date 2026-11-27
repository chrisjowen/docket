// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { loginList } from './admin'

describe('loginList', () => {
  it('reads comma-separated logins as stored: trimmed, lowercase, without @', () => {
    expect(loginList('X', ' BobSmith, @alice ,,')).toEqual(['bobsmith', 'alice'])
    expect(loginList('X', undefined)).toEqual([])
    expect(loginList('X', '')).toEqual([])
  })

  it('refuses a value that is not a GitHub login', () => {
    expect(() => loginList('DOCKET_PLATFORM_ADMINS', 'alice,not a login')).toThrow('DOCKET_PLATFORM_ADMINS lists GitHub logins, and "not a login" is not one')
  })
})
