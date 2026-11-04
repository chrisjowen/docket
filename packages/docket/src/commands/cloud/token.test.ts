import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cloudFixture, type CloudFixture } from '../../../test/cloud.js'
import { cloudTokenCreate, cloudTokenList, cloudTokenRevoke, parseExpiry, parseScopes } from './token.js'

let fixture: CloudFixture

beforeEach(async () => {
  fixture = await cloudFixture()
  await fixture.signIn()
})

afterEach(async () => {
  await fixture.close()
})

describe('docket cloud token', () => {
  it('creates a token for the linked workspace, returning its value once', async () => {
    const { token } = await cloudTokenCreate({ scopes: ['docket:read'], days: 30, description: 'CI' }, { cwd: fixture.root, store: fixture.store })

    expect(token).toMatchObject({ id: 'tok_1', token: expect.stringMatching(/^dkt_live_/), scopes: ['docket:read'] })
    expect(fixture.cloud.tokens).toEqual([expect.objectContaining({ id: 'tok_1', description: 'CI', status: 'live' })])
    expect(JSON.stringify(fixture.cloud.tokens)).not.toContain(token.token)
  })

  it('lists and revokes tokens', async () => {
    await cloudTokenCreate({ scopes: ['docket:read'], days: 7 }, { cwd: fixture.root, store: fixture.store })

    expect((await cloudTokenList({ cwd: fixture.root, store: fixture.store })).tokens.map((token) => token.id)).toEqual(['tok_1'])
    await cloudTokenRevoke('tok_1', { cwd: fixture.root, store: fixture.store })
    expect(fixture.cloud.tokens[0]?.status).toBe('revoked')
    await expect(cloudTokenRevoke('tok_9', { cwd: fixture.root, store: fixture.store })).rejects.toThrow('No such token.')
  })

  it('reads --expires as days, 1 to 90', () => {
    expect(parseExpiry('30d')).toBe(30)
    expect(() => parseExpiry('91d')).toThrow(/1d to 90d/)
    expect(() => parseExpiry('30')).toThrow(/1d to 90d/)
  })

  it('reads --scopes as the scopes the cloud knows', () => {
    expect(parseScopes(['docket:read,docket:write', 'docket:read'])).toEqual(['docket:read', 'docket:write'])
    expect(() => parseScopes(['admin'])).toThrow(/"admin" is not a scope/)
  })
})
