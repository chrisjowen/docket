// SPDX-License-Identifier: AGPL-3.0-only
import { isRedirect } from '@sveltejs/kit'
import { describe, expect, it } from 'vitest'

import { load } from './+page.server'

type Event = Parameters<typeof load>[0]

const visit = async (address: string, parent: () => Promise<unknown> = async () => ({})) => {
  try {
    await load({ url: new URL(address, 'http://docket.test'), parent } as unknown as Event)
  } catch (thrown) {
    return thrown
  }
  throw new Error('expected the load to throw')
}

describe('GET /a/{acct}/d/{docket}', () => {
  it("redirects to the docket's overview", async () => {
    const thrown = await visit('/a/acme/d/platform')
    expect(isRedirect(thrown)).toBe(true)
    expect(thrown).toMatchObject({ status: 307, location: '/a/acme/d/platform/overview' })
  })

  it('sends a query, which only the graph read, to the graph and keeps it', async () => {
    expect(await visit('/a/acme/d/platform?focus=service.orders')).toMatchObject({ location: '/a/acme/d/platform/graph?focus=service.orders' })
  })

  it("answers the layout's 404 for a workspace the org does not have, without redirecting", async () => {
    const missing = Object.assign(new Error('Not found'), { status: 404 })
    expect(await visit('/a/acme/d/nosuch', () => Promise.reject(missing))).toBe(missing)
  })
})
