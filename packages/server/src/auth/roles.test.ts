import { describe, expect, it } from 'vitest'

import { ROLES, isRole } from './roles.js'

describe('roles', () => {
  it('lists the four roles, most to least privileged', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'editor', 'viewer'])
  })

  it('knows a role from anything else', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true)
    expect(isRole('member')).toBe(false)
    expect(isRole(null)).toBe(false)
  })
})
