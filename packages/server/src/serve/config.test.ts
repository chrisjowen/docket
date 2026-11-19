import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeProject } from '../../test/serve.js'
import { ServeConfigError, loadServeConfig, slugOf } from './config.js'
import { createToken, listTokens, revokeToken, tokenAuth } from './tokens.js'

let project: string

beforeEach(async () => {
  project = await makeProject('docket-serve-config-')
})
afterEach(async () => {
  await rm(project, { recursive: true, force: true })
})

describe("docket serve's configuration", () => {
  it('serves the project here from its own files with nothing set: no database, jsonl, owners publish, ask off', async () => {
    const config = await loadServeConfig({ cwd: project, env: {} })
    expect(config).toMatchObject({
      file: null,
      listen: { host: '127.0.0.1', port: 4390 },
      publicUrl: null,
      dataDir: join(project, '.docket-server'),
      database: null,
      codec: { kind: 'plaintext' },
      projections: [{ id: 'jsonl', module: '@docket/adapter-jsonl' }],
      auth: { tokensFile: join(project, '.docket-server', 'tokens.yaml'), tokens: [] },
      ontology: { mcpWriters: ['owner'] },
      ai: null,
      ui: true
    })
    expect(config.workspaces).toEqual([{ slug: slugOf(project), path: project, ontology: null }])
  })

  it('opts into Postgres, its projections and its writers from the environment', async () => {
    const config = await loadServeConfig({
      cwd: project,
      env: { DOCKET_DATABASE_URL: 'postgres://u:p@db:5432/docket', DOCKET_PROJECTIONS: 'postgres,sqlite', DOCKET_ONTOLOGY_MCP_WRITERS: 'owner,admin', DOCKET_SERVE_PORT: '8080', DOCKET_WORKSPACES: 'platform,data' }
    })
    expect(config.database).toEqual({ url: 'postgres://u:p@db:5432/docket', schema: 'public' })
    expect(config.projections.map((projection) => projection.id)).toEqual(['postgres', 'sqlite'])
    expect(config.ontology.mcpWriters).toEqual(['owner', 'admin'])
    expect(config.listen.port).toBe(8080)
    expect(config.workspaces.map((workspace) => workspace.slug)).toEqual(['platform', 'data'])
  })

  it('takes a variable set to nothing as unset, as Compose and Helm pass an option left out', async () => {
    const blank = Object.fromEntries(
      [
        'DOCKET_SERVE_HOST',
        'DOCKET_SERVE_PORT',
        'DOCKET_PUBLIC_URL',
        'DOCKET_DATA_DIR',
        'DOCKET_WORKSPACES',
        'DOCKET_DATABASE_URL',
        'DOCKET_DATABASE_SCHEMA',
        'DOCKET_CODEC_KEY_FILE',
        'DOCKET_PROJECTIONS',
        'DOCKET_TOKENS_FILE',
        'DOCKET_ONTOLOGY_MCP_WRITERS',
        'DOCKET_SERVE_UI'
      ].map((name) => [name, ''])
    )
    expect(await loadServeConfig({ cwd: project, env: blank })).toEqual(await loadServeConfig({ cwd: project, env: {} }))
  })

  it('reads docket-server.yaml, resolving its paths from its own directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docket-serve-file-'))
    try {
      await writeFile(
        join(dir, 'docket-server.yaml'),
        [
          'listen: { host: 0.0.0.0, port: 9000 }',
          'publicUrl: https://docket.example.com/',
          'dataDir: ./state',
          'workspaces:',
          `  - slug: platform`,
          `    path: ${project}`,
          'ontology: { mcpWriters: [owner, editor] }',
          'ai: { provider: claude, model: haiku }'
        ].join('\n')
      )
      const config = await loadServeConfig({ cwd: dir, env: {} })
      expect(config).toMatchObject({
        file: join(dir, 'docket-server.yaml'),
        listen: { host: '0.0.0.0', port: 9000 },
        publicUrl: 'https://docket.example.com',
        dataDir: join(dir, 'state'),
        workspaces: [{ slug: 'platform', path: project }],
        ontology: { mcpWriters: ['owner', 'editor'] },
        ai: { provider: 'claude', model: 'haiku' }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses what it cannot serve: a viewer publishing, a slug, a workspace with no docket', async () => {
    await expect(loadServeConfig({ cwd: project, env: { DOCKET_ONTOLOGY_MCP_WRITERS: 'viewer' } })).rejects.toThrow(/a viewer never changes the ontology/)
    await expect(loadServeConfig({ cwd: project, env: { DOCKET_WORKSPACES: 'Not A Slug' } })).rejects.toThrow(ServeConfigError)
    const empty = await mkdtemp(join(tmpdir(), 'docket-serve-empty-'))
    try {
      await expect(loadServeConfig({ cwd: empty, env: {} })).rejects.toThrow(/has no docket at/)
      // Over Postgres a workspace needs no project.
      await expect(loadServeConfig({ cwd: empty, env: { DOCKET_DATABASE_URL: 'postgres://db/docket' } })).resolves.toMatchObject({ database: { url: 'postgres://db/docket' } })
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

describe("docket serve's tokens", () => {
  it('keeps only a hash of each token, shown once, and lists and revokes them by name', async () => {
    const config = await loadServeConfig({ cwd: project, env: {} })
    const { token, record } = await createToken(config, { name: 'ada', role: 'editor' })
    expect(token).toMatch(/^dks_[A-Za-z0-9_-]{43}$/)
    expect(record).toMatchObject({ name: 'ada', role: 'editor', workspaces: ['*'], scopes: ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'] })
    const file = await readFile(config.auth.tokensFile, 'utf8')
    expect(file).not.toContain(token)
    expect(file).toContain(record.sha256)
    await expect(createToken(config, { name: 'ada', role: 'owner' })).rejects.toThrow(/already a token named "ada"/)
    await expect(createToken(config, { name: 'bob', role: 'owner', workspaces: ['elsewhere'] })).rejects.toThrow(/serves no workspace elsewhere/)
    expect((await listTokens(config)).map((each) => each.name)).toEqual(['ada'])
    expect(await revokeToken(config, 'ada')).toBe(true)
    expect(await revokeToken(config, 'ada')).toBe(false)
  })

  it('resolves a token for the workspaces it opens only, with its role read on every call', async () => {
    const config = await loadServeConfig({ cwd: project, env: { DOCKET_WORKSPACES: `platform=${project},data=${project}` } })
    const { token } = await createToken(config, { name: 'ci', role: 'editor', scopes: ['docket:read'], workspaces: ['platform'] })
    const auth = tokenAuth(config)
    const resource = (slug: string) => ({ url: `https://docket.test/mcp/${slug}`, workspaceId: slug, slug })
    const principal = await auth.authenticator.resolve(token, resource('platform'))
    expect(principal).toMatchObject({ actor: 'token:ci', workspaceId: 'platform', scopes: ['docket:read'] })
    expect(await auth.authenticator.resolve(token, resource('data'))).toBeNull()
    expect(await auth.authenticator.resolve('dks_not-a-token', resource('platform'))).toBeNull()
    expect(await auth.authorizer.role(principal as never)).toBe('editor')
    await revokeToken(config, 'ci')
    expect(await auth.authorizer.role(principal as never)).toBeNull()
  })

  it('resolves a token that acts for a person to a principal that does, and keeps that in its record', async () => {
    const config = await loadServeConfig({ cwd: project, env: {} })
    const { token, record } = await createToken(config, { name: 'dana-agent', role: 'editor', actsFor: ' dana ' })
    expect(record.actsFor).toBe('dana')
    expect(await listTokens(config)).toEqual([expect.objectContaining({ name: 'dana-agent', actsFor: 'dana' })])
    const slug = config.workspaces[0]?.slug as string
    const principal = await tokenAuth(config).authenticator.resolve(token, { url: 'https://docket.test/mcp', workspaceId: slug, slug })
    expect(principal).toMatchObject({ actor: 'token:dana-agent', actsFor: 'dana' })
  })

  it('reads a people directory from the config, and refuses one it cannot read', async () => {
    const dir = join(project, 'people-conf')
    await mkdir(dir)
    const file = join(dir, 'docket-server.yaml')
    await writeFile(file, `workspaces: [{ slug: platform, path: ${project} }]\npeople:\n  dana: { aliases: [druiz], role: lead, flags: [reviewer] }\n`)
    expect((await loadServeConfig({ cwd: dir, env: {} })).people).toEqual({
      people: { dana: { aliases: ['druiz'], attributes: { role: 'lead', flags: ['reviewer'] } } }
    })
    await writeFile(file, `workspaces: [{ slug: platform, path: ${project} }]\npeople:\n  dana: { aliases: druiz }\n`)
    await expect(loadServeConfig({ cwd: dir, env: {} })).rejects.toThrow(/people\.dana\.aliases/)
    expect((await loadServeConfig({ cwd: project, env: {} })).people).toBeNull()
  })

  it('accepts tokens given in the config file, which the commands leave alone', async () => {
    const dir = join(project, 'conf')
    await mkdir(dir)
    await writeFile(
      join(dir, 'docket-server.yaml'),
      `workspaces: [{ slug: platform, path: ${project} }]\nauth:\n  tokens:\n    - { name: robot, sha256: "${'a'.repeat(64)}", role: viewer, scopes: [docket:read] }\n`
    )
    const config = await loadServeConfig({ cwd: dir, env: {} })
    expect(await listTokens(config)).toEqual([expect.objectContaining({ name: 'robot', inConfig: true })])
    await expect(revokeToken(config, 'robot')).rejects.toThrow(/in the server's config file/)
  })
})
