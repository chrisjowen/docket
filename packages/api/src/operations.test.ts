import { describe, expect, it } from 'vitest'

import { OPERATIONS, matchOperation, openApiDocument, operation, pathOf, type Operation } from './index.js'

const all = OPERATIONS as readonly Operation[]

describe('the /api/v1 operations', () => {
  it('have unique ids and unique method and path pairs', () => {
    expect(new Set(all.map((each) => each.id)).size).toBe(all.length)
    expect(new Set(all.map((each) => `${each.method} ${each.path}`)).size).toBe(all.length)
  })

  it('name every path parameter in their params schema, and only those', () => {
    for (const each of all) {
      const named = [...each.path.matchAll(/\{(\w+)\}/g)].map((found) => found[1])
      expect(Object.keys(each.params?.shape ?? {}).sort(), each.id).toEqual(named.sort())
    }
  })

  it('are read-only exactly when they are GETs, and a body only on writes', () => {
    for (const each of all) {
      expect(each.readOnly, each.id).toBe(each.method === 'GET')
      if (each.method === 'GET' || each.method === 'DELETE') expect(each.body, each.id).toBeUndefined()
      expect(each.status === 204, each.id).toBe(each.response === null)
    }
  })

  it('never mint a token over MCP, and only management calls become MCP tools', () => {
    for (const each of all.filter((candidate) => candidate.mcpTool)) {
      expect(each.mcpTool).toMatch(/^admin_/)
      expect(each.id).not.toMatch(/tokens/)
    }
  })

  it('keep minting a personal token and making an account to a browser session', () => {
    expect(operation('me.tokens.create').auth).toEqual(['session'])
    expect(operation('accounts.create').auth).toEqual(['session'])
  })

  it('match a request to its operation, its path parameters, or the methods the path takes', () => {
    expect(matchOperation('GET', '/api/v1/accounts/acme/grants')).toMatchObject({ operation: { id: 'grants.list' }, params: { acct: 'acme' } })
    expect(matchOperation('DELETE', '/api/v1/accounts/acme/system-accounts/s1/tokens/tok_1')).toMatchObject({
      operation: { id: 'system-accounts.tokens.revoke' },
      params: { acct: 'acme', id: 's1', token: 'tok_1' },
    })
    expect(matchOperation('POST', '/api/v1/accounts/acme/usage')).toEqual({ allowed: ['GET'] })
    expect(matchOperation('GET', '/api/v1/nowhere')).toBeNull()
    expect(pathOf(operation('dockets.get'), { acct: 'acme', docket: 'pay ments' })).toBe('/api/v1/accounts/acme/dockets/pay%20ments')
  })

  it('validate bodies and queries with their schemas', () => {
    expect(operation('grants.create').body?.safeParse({ who: 'sam', place: 'docket:payments', role: 'writer', add: ['publish'] }).success).toBe(true)
    expect(operation('grants.create').body?.safeParse({ who: 'sam', place: 'docket:Pay', role: 'writer' }).success).toBe(false)
    expect(operation('grants.create').body?.safeParse({ who: 'sam', place: 'account', role: 'writer', add: ['fly'] }).success).toBe(false)
    expect(operation('audit.list').query?.safeParse({ limit: '20' })).toMatchObject({ success: true, data: { limit: 20 } })
  })

  it('generate an OpenAPI document with each operation’s credentials, capability and errors', () => {
    const document = openApiDocument('https://docket.example')
    const grants = document.paths['/api/v1/accounts/{acct}/grants'] as Record<string, Record<string, unknown>>
    expect(grants.post).toMatchObject({
      operationId: 'grants.create',
      security: [{ session: [] }, { bearer: [] }, { oauth: [] }],
      'x-docket-needs': { capability: 'access', on: 'place' },
      'x-docket-read-only': false,
      'x-docket-mcp-tool': 'admin_set_access',
    })
    expect(Object.keys(grants.post?.responses as object)).toEqual(expect.arrayContaining(['201', '400', '401', '403', '404', '409']))
    expect(JSON.parse(JSON.stringify(document))).toEqual(document)
  })
})
