import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ORDERS, PAYMENTS, STORES, makeDatabase, makeProject, startTestServe, type TestServe } from '../../test/serve.js'
import { SESSION_COOKIE } from './http.js'
import { createToken } from './tokens.js'

/**
 * `docket serve`'s documents API - the single-tenant alias of Docket Cloud's,
 * which `docket cloud link|push|pull|status` call - its page behind a token
 * sign-in, and the docket CLI driving both.
 */

const CLI = fileURLToPath(new URL('../../../docket/dist/cli.js', import.meta.url))
const SERVER_PACKAGE = fileURLToPath(new URL('../..', import.meta.url))
const run = promisify(execFile)

const docket = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  run(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, DOCKET_OFFLINE: '', ...env } })

describe.each(STORES)("docket serve's documents API over $kind", ({ kind, skip }) => {
  let serve: TestServe
  let database: Awaited<ReturnType<typeof makeDatabase>> | null = null
  let base: string
  const api = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${base}/${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {})
    })

  /** A JSON answer, as the API's routes give one. */
  const body = async (response: Promise<Response>): Promise<Record<string, any>> => (await (await response).json()) as Record<string, any>

  beforeAll(async () => {
    if (skip) return
    database = kind === 'postgres' ? await makeDatabase() : null
    serve = await startTestServe(kind, database ? { database: database.url } : {})
    // Docket Cloud's path, with its org: the server has one tenant, so any org names it.
    base = `${serve.running.url}/api/o/self/w/${serve.config.workspaces[0]?.slug}`
  })
  afterAll(async () => {
    await serve?.close()
    await database?.drop()
  })

  it.skipIf(skip)('says who a token is', async () => {
    const me = await body(api(serve.tokens.editor, 'me'))
    expect(me).toMatchObject({ org: 'self', workspace: serve.config.workspaces[0]?.slug, role: 'editor', scopes: ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'] })
  })

  it.skipIf(skip)("pushes a checkout's documents, validated as one, and lists them by checkout", async () => {
    const push = (request: unknown) => api(serve.tokens.editor, 'documents/push', { method: 'POST', body: request })
    const files = [
      { path: '.docket/resources/teams/payments.md', raw: PAYMENTS },
      { path: '.docket/resources/services/orders.md', raw: ORDERS },
      { path: '.docket/resources/services/billing.md', raw: '---\nid: service.billing\ntype: service\ntitle: Billing\n---\n\nBills.\n' }
    ]
    const dry = await body(push({ checkout: 'docket-co-1', dryRun: true, upsert: files, remove: [] }))
    expect(dry).toMatchObject({ ok: true, dryRun: true })

    const refused = await body(push({ checkout: 'docket-co-1', upsert: [{ path: '.docket/resources/services/bad.md', raw: '---\nid: service.bad\ntype: nonsense\ntitle: Bad\n---\n' }], remove: [] }))
    expect(refused.ok).toBe(false)
    expect(refused.diagnostics.some((d: { severity: string }) => d.severity === 'error')).toBe(true)

    const pushed = await body(push({ checkout: 'docket-co-1', upsert: files, remove: [] }))
    expect(pushed.ok, JSON.stringify(pushed.diagnostics)).toBe(true)
    // Over files, the project already holds payments and orders with the same text: they are left as they are.
    expect([...pushed.created, ...pushed.unchanged].sort()).toEqual(files.map((file) => file.path).sort())

    const listed = await body(api(serve.tokens.editor, 'documents?origin=cli&originRef=docket-co-1'))
    expect(listed.documents.map((document: { path: string }) => document.path)).toContain('.docket/resources/services/billing.md')

    const taken = await body(push({ checkout: 'docket-co-2', upsert: [{ path: '.docket/resources/services/billing.md', raw: '---\nid: service.billing\ntype: service\ntitle: Other\n---\n' }], remove: [] }))
    expect(taken.diagnostics).toEqual([expect.objectContaining({ code: 'path-taken' })])

    const removed = await body(push({ checkout: 'docket-co-1', upsert: [], remove: ['.docket/resources/services/billing.md'] }))
    expect(removed).toMatchObject({ ok: true, removed: ['.docket/resources/services/billing.md'] })
  })

  it.skipIf(skip)("lists the server's own documents with their text, for pull", async () => {
    await serve.call(serve.tokens.owner, 'docket_remember', { id: 'service.vault', type: 'service', title: 'Vault', evidence: [{ source: 'human' }] })
    const listed = await body(api(serve.tokens.editor, 'documents?origin=cloud&include=raw'))
    const vault = listed.documents.find((document: { raw?: string }) => document.raw?.includes('id: service.vault'))
    expect(vault).toBeDefined()
  })

  it.skipIf(skip)('refuses a viewer’s push, a token in the URL, and a bad request', async () => {
    const { token } = await createToken(serve.config, { name: `viewer-${kind}`, role: 'viewer' })
    expect((await api(token, 'documents/push', { method: 'POST', body: { checkout: 'x', upsert: [], remove: [] } })).status).toBe(403)
    expect((await fetch(`${base}/me?token=${serve.tokens.owner}`)).status).toBe(400)
    expect((await api(serve.tokens.editor, 'documents?origin=elsewhere')).status).toBe(400)
    expect((await fetch(`${base}/me`)).status).toBe(401)
  })
})

describe("docket serve's page", () => {
  let serve: TestServe
  beforeAll(async () => {
    serve = await startTestServe('files')
  })
  afterAll(() => serve?.close())

  it('sends a visitor to sign in, and signs them in with a token, never keeping it in the browser', async () => {
    const page = await fetch(`${serve.running.url}/`, { redirect: 'manual' })
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe('/login')
    expect((await fetch(`${serve.running.url}/api/graph`)).status).toBe(401)
    expect(await (await fetch(`${serve.running.url}/login`)).text()).toContain('Sign in to Docket')

    const wrong = await fetch(`${serve.running.url}/login`, { method: 'POST', body: new URLSearchParams({ token: 'dks_nope' }), redirect: 'manual' })
    expect(wrong.status).toBe(401)

    const signedIn = await fetch(`${serve.running.url}/login`, { method: 'POST', body: new URLSearchParams({ token: serve.tokens.editor }), redirect: 'manual' })
    expect(signedIn.status).toBe(303)
    const cookie = signedIn.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]+; Path=/; HttpOnly; SameSite=Lax`))
    expect(cookie).not.toContain(serve.tokens.editor)
    const session = cookie.split(';')[0] as string

    const graph = await fetch(`${serve.running.url}/api/graph`, { headers: { cookie: session } })
    expect(graph.status).toBe(200)
    expect(JSON.stringify(await graph.json())).toContain('service.orders')
    // Reads only: the server keeps its index in sync itself.
    expect((await fetch(`${serve.running.url}/api/sync`, { method: 'POST', headers: { cookie: session, origin: serve.running.url } })).status).toBe(403)
    expect((await fetch(`${serve.running.url}/api/session`, { headers: { cookie: session } })).status).toBe(403)
    // No model is set up on this server, so the page's questions are never summarised.
    expect((await fetch(`${serve.running.url}/api/chat?q=orders`, { headers: { cookie: session } })).status).toBe(403)
    const asked = await fetch(`${serve.running.url}/api/ask`, { method: 'POST', headers: { cookie: session, 'content-type': 'application/json' }, body: JSON.stringify({ question: 'orders', synthesis: true }) })
    expect(((await asked.json()) as { synthesis: unknown }).synthesis).toBeNull()

    await fetch(`${serve.running.url}/logout`, { headers: { cookie: session }, redirect: 'manual' })
    expect((await fetch(`${serve.running.url}/api/graph`, { headers: { cookie: session } })).status).toBe(401)
  })
})

describe('the docket CLI against docket serve', () => {
  let serve: TestServe
  let checkout: string
  beforeAll(async () => {
    serve = await startTestServe('files')
    checkout = await makeProject('docket-serve-checkout-')
    await writeFile(join(checkout, '.docket/resources/services/search.md'), '---\nid: service.search\ntype: service\ntitle: Search\n---\n\nFinds things.\n')
  })
  afterAll(async () => {
    await serve?.close()
    await rm(checkout, { recursive: true, force: true })
  })

  it.skipIf(!existsSync(CLI))('links a checkout to it, pushes, and pulls what was written there', async () => {
    const slug = serve.config.workspaces[0]?.slug as string
    const env = { DOCKET_TOKEN: serve.tokens.editor }
    await docket(checkout, ['cloud', 'link', `self/${slug}`, '--url', serve.running.url, '--token-env', 'DOCKET_TOKEN'])
    expect((await docket(checkout, ['cloud', 'whoami'], env)).stdout).toMatch(/\(editor\) in self\//)
    expect((await docket(checkout, ['cloud', 'push'], env)).stdout).toMatch(/\+ \.docket\/resources\/services\/search\.md/)
    expect(await readFile(join(serve.project, '.docket/resources/services/search.md'), 'utf8')).toContain('id: service.search')

    await serve.call(serve.tokens.owner, 'docket_remember', { id: 'service.cache', type: 'service', title: 'Cache', evidence: [{ source: 'human' }] })
    expect((await docket(checkout, ['cloud', 'pull', '--resources'], env)).stdout).toMatch(/\+ \.docket\/resources\/services\/cache\.md/)
    expect(existsSync(join(checkout, '.docket/resources/services/cache.md'))).toBe(true)
  })

  it.skipIf(!existsSync(CLI) || !existsSync(join(SERVER_PACKAGE, 'dist/serve/index.js')))('manages tokens with docket serve token, from a project that has the server installed', async () => {
    const project = await mkdtemp(join(tmpdir(), 'docket-serve-cli-'))
    try {
      await mkdir(join(project, 'node_modules/@chrisjowen'), { recursive: true })
      await symlink(SERVER_PACKAGE, join(project, 'node_modules/@chrisjowen/docket-server'), 'dir')
      await docket(project, ['init'])
      const created = await docket(project, ['serve', 'token', 'create', 'ada', '--role', 'editor'])
      expect(created.stdout).toMatch(/✓ created ada \(editor\) for \*/)
      const token = /^\s+(dks_\S+)$/m.exec(created.stdout)?.[1]
      expect(token).toBeDefined()
      expect(await readFile(join(project, '.docket-server/tokens.yaml'), 'utf8')).not.toContain(token as string)
      expect((await docket(project, ['serve', 'token', 'list'])).stdout).toMatch(/ada\s+dks_\S+…\s+editor/)
      expect((await docket(project, ['serve', 'token', 'revoke', 'ada'])).stdout).toContain('✓ revoked ada')
      await expect(docket(project, ['serve', 'token', 'create', 'bob', '--role', 'boss'])).rejects.toThrow(/Allowed choices are owner, admin, editor, viewer/)
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })
})
