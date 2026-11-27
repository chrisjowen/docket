// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { loginList } from './admin'

describe('loginList', () => {
  it('reads comma-separated logins as stored: trimmed, lowercase, without @', () => {
    expect(loginList('X', ' BobSmith, @alice ,,')).toEqual(['bobsmith', 'alice'])
    expect(loginList('X', undefined)).toEqual([])
    expect(loginList('X', '')).toEqual([])
  })

  it('reads other providers\' logins and emails too', () => {
    expect(loginList('X', 'jo.okta, Ops_Admin, Ada@Example.com')).toEqual(['jo.okta', 'ops_admin', 'ada@example.com'])
  })

  it('refuses a value that is neither a login nor an email', () => {
    expect(() => loginList('DOCKET_PLATFORM_ADMINS', 'alice,not a login')).toThrow('DOCKET_PLATFORM_ADMINS lists logins and emails, and "not a login" is neither')
  })
})
