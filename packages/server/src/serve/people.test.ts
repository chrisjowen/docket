import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { STORES, makeDatabase, makeProject } from '../../test/serve.js'
import { loadServeConfig } from './config.js'
import { startServe, type RunningServe } from './index.js'
import { createToken } from './tokens.js'

/**
 * `docket serve` with a people directory in its config and tokens that act
 * for people, over a project's files and over Postgres: evidence citing no
 * source is the token's person, scored by their role, and evidence citing
 * someone else counts as the token's person and asks that one to confirm.
 */

const SERVER = (project: string) => `workspaces:
  - slug: platform
    path: ${project}
people:
  dana:
    name: Dana Ruiz
    aliases: [dana@acme.com]
    role: lead
  tom:
    role: intern
`

describe.each(STORES)('people over $kind', ({ kind, skip }) => {
  let project: string
  let running: RunningServe
  let database: Awaited<ReturnType<typeof makeDatabase>> | null = null
  const tokens: Record<string, string> = {}
  let id = 1

  const call = async (token: string, name: string, args: unknown) => {
    const response = await fetch(`${running.url}/mcp/platform`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } })
    })
    const body = (await response.json()) as { result: { content: { text: string }[]; structuredContent: Record<string, any> } }
    return body.result
  }

  beforeAll(async () => {
    if (skip) return
    project = await makeProject('docket-serve-people-')
    database = kind === 'postgres' ? await makeDatabase() : null
    await writeFile(join(project, 'docket-server.yaml'), SERVER(project), 'utf8')
    const config = await loadServeConfig({
      cwd: project,
      env: { DOCKET_DATA_DIR: join(project, '.docket-server'), ...(database ? { DOCKET_DATABASE_URL: database.url } : {}) },
      port: 0
    })
    expect(config.people?.people.dana?.attributes).toEqual({ role: 'lead' })
    tokens.dana = (await createToken(config, { name: 'dana-agent', role: 'editor', actsFor: 'dana@acme.com' })).token
    tokens.tom = (await createToken(config, { name: 'tom-agent', role: 'editor', actsFor: 'tom' })).token
    tokens.nobody = (await createToken(config, { name: 'ci', role: 'editor' })).token
    running = await startServe(config, { syncIntervalMs: 0, loopIntervalMs: 200 })
  })
  afterAll(async () => {
    await running?.close()
    await database?.drop()
    if (project) await rm(project, { recursive: true, force: true })
  })

  it.skipIf(skip)('takes evidence citing no source as the token\'s person, scored by their role in the directory', async () => {
    const written = await call(tokens.dana as string, 'docket_remember', {
      id: 'service.billing',
      type: 'service',
      title: 'Billing',
      evidence: [{ note: 'I decided billing runs nightly.' }]
    })
    expect(written.structuredContent).toMatchObject({ ok: true, diagnostics: [] })
    const got = (await call(tokens.tom as string, 'docket_get', { id: 'service.billing' })).structuredContent as {
      resource: { confidence: number; evidence: Record<string, unknown>[] }
    }
    expect(got.resource.evidence).toEqual([expect.objectContaining({ source: 'person', principal: 'dana@acme.com', observedBy: expect.stringContaining('dana-agent') })])
    // "A lead said so", from the template's policies.
    expect(got.resource.confidence).toBe(0.85)
  })

  it.skipIf(skip)('counts a person cited second-hand as the token\'s person, and asks them to confirm', async () => {
    const written = await call(tokens.tom as string, 'docket_remember', {
      id: 'service.ledger',
      type: 'service',
      title: 'Ledger',
      evidence: [{ source: 'person', sourceRef: 'dana', note: 'Dana said the ledger is append-only.' }]
    })
    expect(written.structuredContent).toMatchObject({ ok: true, diagnostics: [expect.objectContaining({ code: 'confirm-requested' })] })
    expect(written.content[0]?.text).toContain('until dana confirms it')
    const got = (await call(tokens.tom as string, 'docket_get', { id: 'service.ledger' })).structuredContent as { resource: { confidence: number } }
    // Tom is an intern, which the template prices only as a person: 0.70, not Dana's 0.85.
    expect(got.resource.confidence).toBe(0.7)
  })

  it.skipIf(skip)('refuses evidence citing no source from a token that acts for no one', async () => {
    const refused = await call(tokens.nobody as string, 'docket_remember', {
      id: 'service.audit',
      type: 'service',
      title: 'Audit',
      evidence: [{ note: 'No one in particular said so.' }]
    })
    expect(refused.structuredContent).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'missing-evidence-source' })] })
  })
})
