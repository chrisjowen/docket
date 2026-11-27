// SPDX-License-Identifier: AGPL-3.0-only
import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hashContent as docketHash, validate } from '@chrisjowen/docket'
import { insertWorkspace } from '@docket/platform-canonical-store'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readCanonical, type AdapterManifest, type CanonicalDocument } from './docket.js'
import { documentHistory, listDocuments, postgresManifests, postgresSource, putDocument, readDocuments, retireDocument } from './index.js'
import { FIXTURE_ROOT, createTestOrg, readFixture, type Fixture, type TestOrg } from './testing.js'

/** The fixture's ontology with `pod` removed and `depends_on` narrowed to services, so validation has findings. */
function broken(ontology: string): string {
  return ontology
    .replace(/ {2}pod:\n {4}description: A running instance of a service.\n {4}icon: box\n/, '')
    .replace('to: [service, datasource]', 'to: [service]')
}

describe.skipIf(!TEST_PG_URL)('postgresSource', () => {
  let org: TestOrg
  let fixture: Fixture
  let workspaceId: string

  beforeAll(async () => {
    org = await createTestOrg()
    fixture = await readFixture()
    workspaceId = await org.withOrg(async (ctx) => {
      const workspace = await insertWorkspace(ctx.tx, { name: 'Platform', slug: 'platform', createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, fixture.ontology, docketHash(fixture.ontology), org.userId],
      )
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'cloud', actor: `user:${org.userId}` })
      }
      return workspace.id
    })
  })
  afterAll(() => org?.drop())

  it('returns documents written encrypted with the hash docket computes', async () => {
    const read = await org.withOrg(async (ctx) => {
      const out: CanonicalDocument[] = []
      for await (const document of postgresSource(ctx, workspaceId).documents()) {
        if ('raw' in document) out.push(document)
      }
      return out
    })
    expect(read.map((d) => d.path).sort()).toEqual(fixture.documents.map((d) => d.path))
    for (const document of fixture.documents) {
      const back = read.find((d) => d.path === document.path)
      expect(back?.raw).toBe(document.raw)
      expect(back?.hash).toBe(docketHash(document.raw))
    }
    const ontology = await org.withOrg((ctx) => postgresSource(ctx, workspaceId).ontology())
    expect(ontology).toEqual({ text: fixture.ontology, revision: docketHash(fixture.ontology) })
  })

  it('runs one query at a time on the transaction while docket reads it', async () => {
    let inFlight = 0
    let most = 0
    const read = await org.withOrg(async (ctx) => {
      const query = ctx.tx.query.bind(ctx.tx) as (...args: unknown[]) => Promise<unknown>
      const tx = Object.create(ctx.tx) as typeof ctx.tx
      tx.query = (async (...args: unknown[]) => {
        most = Math.max(most, ++inFlight)
        try {
          return await query(...args)
        } finally {
          inFlight--
        }
      }) as typeof ctx.tx.query
      return readCanonical(postgresSource({ ...ctx, tx }, workspaceId))
    })
    expect(read.documents.length).toBe(fixture.documents.length)
    expect(most).toBe(1)
  })

  it('stores no plaintext: titles and bodies are only in the ciphertext', async () => {
    const { rows } = await org.db.superuser.query<{ raw_ciphertext: Buffer; hash: string; resource_id: string }>(
      `SELECT raw_ciphertext, hash, resource_id FROM org_${org.orgId}.documents`,
    )
    expect(rows).toHaveLength(12)
    for (const row of rows) {
      expect(row.raw_ciphertext.toString('utf8')).not.toContain('title:')
      expect(row.resource_id).toMatch(/^[a-z]+\./)
    }
  })

  it('matches docket validate over the same files', async () => {
    const fromPostgres = await org.withOrg((ctx) => validate({ source: postgresSource(ctx, workspaceId) }))
    const fromFiles = await validate({ cwd: FIXTURE_ROOT })
    expect(fromPostgres.diagnostics).toEqual(fromFiles.diagnostics)
    expect(fromPostgres.entities).toEqual(fromFiles.entities)
    expect(fromPostgres.documents).toEqual(fromFiles.documents)

    // And with findings: the same broken ontology over the files and over Postgres.
    const dir = await mkdtemp(join(tmpdir(), 'docket-fixture-'))
    await cp(FIXTURE_ROOT, dir, { recursive: true })
    await writeFile(join(dir, '.docket', 'entities.yaml'), broken(fixture.ontology))
    const filesBroken = await validate({ cwd: dir })
    const postgresBroken = await org.withOrg((ctx) =>
      validate({ source: postgresSource(ctx, workspaceId, { ontology: broken(fixture.ontology) }) }),
    )
    expect(filesBroken.diagnostics.map((d) => d.code).sort()).toEqual([
      'relationship-to-violation',
      'relationship-to-violation',
      'relationship-to-violation',
      // A policy still prices evidence about the type the broken ontology drops.
      'unknown-policy-subject',
      'unknown-type',
      'unknown-type',
    ])
    // The ontology's own diagnostics name its file: the temporary directory's, or the workspace's.
    const ontologyPath = (diagnostics: typeof filesBroken.diagnostics) =>
      diagnostics.map((d) => (d.path?.endsWith('.docket/entities.yaml') ? { ...d, path: '.docket/entities.yaml' } : d))
    expect(ontologyPath(postgresBroken.diagnostics)).toEqual(ontologyPath(filesBroken.diagnostics))
    expect(postgresBroken.entities).toEqual(filesBroken.entities)
  })

  it('keeps every revision, and a retired document leaves the source', async () => {
    const path = '.docket/resources/team/discovery.md'
    const original = fixture.documents.find((d) => d.path === path)?.raw ?? ''
    const edited = original.replace('title: Discovery', 'title: Discovery and search')
    await org.withOrg(async (ctx) => {
      const unchanged = await putDocument(ctx, { workspaceId, path, raw: original, origin: 'cloud', actor: 'user:x' })
      expect(unchanged.changed).toBe(false)
      const { document } = await putDocument(ctx, { workspaceId, path, raw: edited, origin: 'cloud', actor: 'user:x' })
      expect(document.revision).toBe(2)
      const history = await documentHistory(ctx, workspaceId, document.id)
      expect(history.map((r) => [r.revision, r.raw])).toEqual([
        [2, edited],
        [1, original],
      ])
      await retireDocument(ctx.tx, { workspaceId, path })
      const { documents } = await readCanonical(postgresSource(ctx, workspaceId))
      expect(documents.map((d) => d.path)).not.toContain(path)
      expect((await listDocuments(ctx.tx, workspaceId)).length).toBe(11)
      // Put back, for the other tests.
      await putDocument(ctx, { workspaceId, path, raw: original, origin: 'cloud', actor: 'user:x' })
    })
  })

  it('refuses a ciphertext moved to another row: the associated data binds it to its document', async () => {
    const schema = `org_${org.orgId}`
    await org.db.superuser.query(
      `UPDATE ${schema}.documents SET raw_ciphertext = (SELECT raw_ciphertext FROM ${schema}.documents WHERE path = $1),
              raw_nonce = (SELECT raw_nonce FROM ${schema}.documents WHERE path = $1)
        WHERE path = $2`,
      ['.docket/resources/team/commerce.md', '.docket/resources/api/orders.md'],
    )
    const opened = await org.withOrg((ctx) => readDocuments(ctx, workspaceId))
    const swapped = opened.find((d) => d.path === '.docket/resources/api/orders.md')
    expect(swapped?.raw).toBeUndefined()
    expect(swapped?.error).toMatch(/does not open/)
    const { diagnostics } = await org.withOrg((ctx) => readCanonical(postgresSource(ctx, workspaceId)))
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'unreadable-file', path: '.docket/resources/api/orders.md' }),
    ])
  })

  it('refuses a malformed or oversized document', async () => {
    await expect(
      org.withOrg((ctx) =>
        putDocument(ctx, { workspaceId, path: '.docket/x.md', raw: 'no frontmatter', origin: 'cloud', actor: 'user:x' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      org.withOrg((ctx) =>
        putDocument(ctx, { workspaceId, path: '../escape.md', raw: fixture.documents[0]?.raw ?? '', origin: 'cloud', actor: 'user:x' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid' })
    const huge = `${fixture.documents[0]?.raw}\n${'x'.repeat(70_000)}`
    await expect(
      org.withOrg((ctx) => putDocument(ctx, { workspaceId, path: '.docket/big.md', raw: huge, origin: 'cloud', actor: 'user:x' })),
    ).rejects.toMatchObject({ code: 'too-large' })
  })
})

describe.skipIf(!TEST_PG_URL)('postgresManifests', () => {
  let org: TestOrg
  afterAll(() => org?.drop())

  it('round-trips a manifest per instance and workspace', async () => {
    org = await createTestOrg()
    const manifest = {
      version: 2,
      adapter: 'ignored',
      fingerprint: 'sha256:abc',
      scope: 'ws_one',
      definition: { name: 'neo4j', version: '1.0.0' },
      inputs: ['entity'],
      checkpoint: '0',
      owners: { 'service.orders': ['.docket/resources/service/orders.md'] },
      records: { entity: { 'service.orders': { revision: 'sha256:1' } }, link: {}, chunk: {} },
    } as unknown as AdapterManifest
    await org.withOrg(async ({ tx }) => {
      const one = await insertWorkspace(tx, { name: 'One', slug: 'one', createdBy: org.userId })
      const two = await insertWorkspace(tx, { name: 'Two', slug: 'two', createdBy: org.userId })
      const store = postgresManifests(tx, one.id)
      expect(await store.read('graph')).toBeUndefined()
      await store.write('graph', manifest)
      await store.write('memories', manifest)
      expect(await store.read('graph')).toEqual({ ...manifest, adapter: 'graph' })
      expect(await store.list()).toEqual(['graph', 'memories'])
      expect(await postgresManifests(tx, two.id).list()).toEqual([])
      await store.remove('graph')
      expect(await store.list()).toEqual(['memories'])
    })
  })
})
