// SPDX-License-Identifier: AGPL-3.0-only
import { CAPABILITIES as WIRE_CAPABILITIES, OPERATIONS, type Operation } from '@docket/api'
import { CAPABILITIES } from '@docket/platform-tenancy'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../runtime', () => ({ getRuntime: () => ({}) }))
const { HANDLERS } = await import('./handlers')

describe('the server against the published /api/v1 definition', () => {
  it('speaks the same capabilities as the resolver', () => {
    expect([...WIRE_CAPABILITIES]).toEqual([...CAPABILITIES])
  })

  it('answers every operation the definition lists, and nothing it does not', () => {
    const ids = (OPERATIONS as readonly Operation[]).map((each) => each.id).sort()
    expect(Object.keys(HANDLERS).sort()).toEqual(ids)
  })
})
