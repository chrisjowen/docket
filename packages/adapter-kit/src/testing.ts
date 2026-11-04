import type { EntityInput, EntityRelationship } from '@docket/contracts'

/**
 * An entity input with every field filled, for adapter tests that only care
 * about a few. Unevidenced unless the overrides say otherwise: an adapter
 * projects the assessment it is handed, it never computes one.
 */
export const entityInput = (overrides: Partial<EntityInput> & { id: string }): EntityInput => {
  const path = overrides.path ?? `.docket/${overrides.id}.md`
  return {
    kind: 'entity',
    revision: `sha256:${overrides.id}`,
    scope: 'default',
    type: overrides.id.split('.')[0] ?? 'service',
    title: overrides.id,
    path,
    paths: [path],
    tags: [],
    attributes: {},
    links: [],
    content: '',
    mentions: [],
    evidence: [],
    index: { graph: true, fts: true, vector: true },
    confidence: 0.5,
    basis: 'unevidenced',
    evidenceCount: 0,
    sources: [],
    ...overrides
  }
}

/** A relationship as an entity input carries it, unevidenced unless the overrides say otherwise. */
export const entityLink = (
  overrides: Partial<EntityRelationship> & Pick<EntityRelationship, 'rel' | 'target'>
): EntityRelationship => ({
  evidence: [],
  confidence: 0.5,
  basis: 'unevidenced',
  evidenceCount: 0,
  sources: [],
  ...overrides
})

// ---------------------------------------------------------------------------
// A fake Docket Cloud, for the `docket cloud` commands and the cloud adapter

export interface FakeCloudDocument {
  path: string
  raw: string
  hash: string
  origin: 'repo' | 'cloud' | 'cli'
  originRef?: string
}

export interface FakeCloudOptions {
  /** Advertise the device authorization grant. Default true. */
  deviceFlow?: boolean
  /** Device-flow polls answered `authorization_pending` before the token is issued. */
  pendingPolls?: number
  /** The `interval` the device authorization advertises, in seconds. */
  interval?: number
  /** Offer the REST API (`/api/o/...`); off, its routes answer 404 as today's cloud does. */
  restApi?: boolean
  /** Access tokens live this long, in seconds. */
  expiresIn?: number
}

export interface FakeCloud {
  url: string
  /** Every request, as `METHOD /path`, in order. */
  requests: string[]
  /** Bodies of the token endpoint's requests, in order. */
  tokenRequests: URLSearchParams[]
  /** Every MCP tool call, in order. */
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
  /** Push requests, in order. */
  pushes: { checkout: string; dryRun?: boolean; upsert: { path: string; raw: string }[]; remove: string[] }[]
  documents: FakeCloudDocument[]
  ontology: { version: number; yaml: string }
  /** Search matches `docket_search` returns. */
  matches: { id: string; type: string; title: string; path: string; confidence?: number }[]
  tokens: { id: string; prefix: string; scopes: string[]; description?: string; expiresAt: string; status: string }[]
  /** Diagnostics a push answers with; an error one refuses a push carrying its path, or every push when it has none. */
  pushDiagnostics: { severity: 'error' | 'warning'; code: string; message: string; path?: string }[]
  /** Issues an access token as login would, for tests that start signed in. */
  issue(): { accessToken: string; refreshToken: string }
  /** Makes every access token issued so far stop working, as expiry does. */
  expireAccessTokens(): void
  close(): Promise<void>
}

const sha256 = async (text: string): Promise<string> => {
  const { createHash } = await import('node:crypto')
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/** Starts a fake cloud on 127.0.0.1 holding one org `acme` with the workspace `platform`. */
export const startFakeCloud = async (options: FakeCloudOptions = {}): Promise<FakeCloud> => {
  const { createServer } = await import('node:http')
  const access = new Set<string>()
  const refresh = new Set<string>()
  const devices = new Map<string, number>()
  let issued = 0
  let url = ''

  const cloud: FakeCloud = {
    url: '',
    requests: [],
    tokenRequests: [],
    toolCalls: [],
    pushes: [],
    documents: [],
    ontology: { version: 1, yaml: 'version: 1\nresourceTypes: {}\nrelationships: {}\n' },
    matches: [],
    tokens: [],
    pushDiagnostics: [],
    issue() {
      issued += 1
      const tokens = { accessToken: `at-${issued}`, refreshToken: `rt-${issued}` }
      access.add(tokens.accessToken)
      refresh.add(tokens.refreshToken)
      return tokens
    },
    expireAccessTokens() {
      access.clear()
    },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }

  const tokenResponse = () => {
    const { accessToken, refreshToken } = cloud.issue()
    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: options.expiresIn ?? 900, scope: 'docket:read docket:write ontology:read ontology:propose' }
  }

  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    request.on('end', () => {
      void (async () => {
        const target = new URL(request.url ?? '/', url)
        const route = `${request.method} ${target.pathname}`
        cloud.requests.push(route)
        const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
          response.writeHead(status, { 'content-type': 'application/json', ...headers })
          response.end(value === undefined ? undefined : JSON.stringify(value))
        }
        const bearer = (request.headers.authorization ?? '').replace(/^Bearer /, '')
        const authorized = access.has(bearer)

        if (route === 'GET /.well-known/oauth-authorization-server') {
          return json(200, {
            issuer: url,
            token_endpoint: `${url}/oauth/token`,
            revocation_endpoint: `${url}/oauth/revoke`,
            ...(options.deviceFlow === false ? {} : { device_authorization_endpoint: `${url}/oauth/device/auth` })
          })
        }
        if (route === 'POST /oauth/device/auth' && options.deviceFlow !== false) {
          const code = `device-${devices.size + 1}`
          devices.set(code, options.pendingPolls ?? 0)
          return json(200, {
            device_code: code,
            user_code: 'WDJB-MJHT',
            verification_uri: `${url}/device`,
            verification_uri_complete: `${url}/device?user_code=WDJB-MJHT`,
            expires_in: 600,
            interval: options.interval ?? 5
          })
        }
        if (route === 'POST /oauth/revoke') {
          const form = new URLSearchParams(body)
          refresh.delete(form.get('token') ?? '')
          access.delete(form.get('token') ?? '')
          return json(200, {})
        }
        if (route === 'POST /oauth/token') {
          const form = new URLSearchParams(body)
          cloud.tokenRequests.push(form)
          const grant = form.get('grant_type')
          if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
            const pending = devices.get(form.get('device_code') ?? '')
            if (pending === undefined) return json(400, { error: 'expired_token' })
            if (pending > 0) {
              devices.set(form.get('device_code') ?? '', pending - 1)
              return json(400, { error: 'authorization_pending' })
            }
            devices.delete(form.get('device_code') ?? '')
            return json(200, tokenResponse())
          }
          if (grant === 'refresh_token') {
            const token = form.get('refresh_token') ?? ''
            if (!refresh.delete(token)) return json(400, { error: 'invalid_grant' })
            return json(200, tokenResponse())
          }
          return json(400, { error: 'unsupported_grant_type' })
        }

        const mcp = /^\/mcp\/acme\/platform$/.exec(target.pathname)
        const api = /^\/api\/o\/acme\/w\/platform\/(.+)$/.exec(target.pathname)
        if (!mcp && !(api && options.restApi !== false)) return json(404, { message: 'Not Found' })
        if (!authorized) return json(401, { error: 'invalid_token', error_description: 'The access token is missing, expired or revoked.' })

        if (mcp) {
          const message = JSON.parse(body) as { id: number; method: string; params: { name?: string; arguments?: Record<string, unknown> } }
          const result = (value: unknown) => json(200, { jsonrpc: '2.0', id: message.id, result: value })
          if (message.method === 'tools/list') return result({ tools: [{ name: 'docket_search' }, { name: 'docket_ontology' }] })
          const name = message.params.name ?? ''
          const args = message.params.arguments ?? {}
          cloud.toolCalls.push({ name, arguments: args })
          const tool = (structured: unknown, text = '') => result({ content: [{ type: 'text', text }], structuredContent: structured })
          if (name === 'docket_search') {
            const limit = typeof args.limit === 'number' ? args.limit : 10
            const matches = cloud.matches.slice(0, limit).map((match) => ({ ...match, foundBy: ['graph'] }))
            return tool({ schema: 'docket-search.v1', query: args.query, matches, nodes: [], links: [], paths: [], viewer: `${url}/o/acme/w/platform/graph` })
          }
          if (name === 'docket_ontology') {
            return tool({ schema: 'docket-ontology.v1', version: cloud.ontology.version, revision: await sha256(cloud.ontology.yaml), yaml: cloud.ontology.yaml })
          }
          if (name === 'docket_propose_ontology_change') {
            return tool({ schema: 'docket-ontology-proposal.v1', draftId: 'draft-1', head: cloud.ontology.version, classification: 'additive', changes: [] })
          }
          return result({ content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true })
        }

        const path = api?.[1] ?? ''
        if (route.startsWith('GET') && path === 'me') {
          return json(200, { login: 'octocat', org: 'acme', workspace: 'platform', role: 'member', scopes: ['docket:read', 'docket:write'], token: { kind: 'oauth', expiresAt: new Date(Date.now() + 900_000).toISOString() } })
        }
        if (path === 'tokens' && request.method === 'GET') return json(200, { tokens: cloud.tokens })
        if (path === 'tokens' && request.method === 'POST') {
          const input = JSON.parse(body) as { scopes: string[]; days?: number; description?: string }
          const id = `tok_${cloud.tokens.length + 1}`
          const expiresAt = new Date(Date.now() + (input.days ?? 30) * 86_400_000).toISOString()
          const token = { id, prefix: 'dkt_live_abcdefgh', scopes: input.scopes, ...(input.description ? { description: input.description } : {}), expiresAt, status: 'live' }
          cloud.tokens.push(token)
          return json(201, { id, token: `dkt_live_${'a'.repeat(43)}_00000000`, prefix: token.prefix, scopes: input.scopes, expiresAt })
        }
        const revoke = /^tokens\/(.+)$/.exec(path)
        if (revoke && request.method === 'DELETE') {
          const token = cloud.tokens.find((candidate) => candidate.id === revoke[1])
          if (!token) return json(404, { error: 'not_found', error_description: 'No such token.' })
          token.status = 'revoked'
          return json(204, undefined)
        }
        if (path === 'documents' && request.method === 'GET') {
          const origin = target.searchParams.get('origin')
          const ref = target.searchParams.get('originRef')
          const raw = target.searchParams.get('include') === 'raw'
          const documents = cloud.documents
            .filter((document) => (origin === null || document.origin === origin) && (ref === null || document.originRef === ref))
            .map(({ raw: text, ...document }) => ({ ...document, revision: document.hash, updatedAt: '2026-11-04T00:00:00.000Z', ...(raw ? { raw: text } : {}) }))
          return json(200, { documents })
        }
        if (path === 'documents/push' && request.method === 'POST') {
          const push = JSON.parse(body) as FakeCloud['pushes'][number]
          cloud.pushes.push(push)
          const diagnostics = cloud.pushDiagnostics.filter(
            (diagnostic) => diagnostic.path === undefined || push.upsert.some((upsert) => upsert.path === diagnostic.path)
          )
          const ok = !diagnostics.some((diagnostic) => diagnostic.severity === 'error')
          const created: string[] = []
          const updated: string[] = []
          for (const upsert of push.upsert) {
            const existing = cloud.documents.find((document) => document.origin === 'cli' && document.originRef === push.checkout && document.path === upsert.path)
            ;(existing ? updated : created).push(upsert.path)
            if (!ok || push.dryRun) continue
            const hash = await sha256(upsert.raw)
            if (existing) Object.assign(existing, { raw: upsert.raw, hash })
            else cloud.documents.push({ path: upsert.path, raw: upsert.raw, hash, origin: 'cli', originRef: push.checkout })
          }
          if (ok && !push.dryRun) {
            cloud.documents = cloud.documents.filter((document) => !(document.origin === 'cli' && document.originRef === push.checkout && push.remove.includes(document.path)))
          }
          return json(200, { ok, dryRun: push.dryRun === true, created, updated, unchanged: [], removed: push.remove, diagnostics })
        }
        return json(404, { message: 'Not Found' })
      })().catch((cause: unknown) => {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'server_error', error_description: String(cause) }))
      })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fake cloud did not start')
  url = `http://127.0.0.1:${address.port}`
  cloud.url = url
  return cloud
}
