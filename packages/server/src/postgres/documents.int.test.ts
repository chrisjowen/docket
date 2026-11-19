import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validate, type CanonicalDocument } from '@chrisjowen/docket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FIXTURE_ROOT, readFixture, type Fixture } from '../../test/fixture.js'
import { STORE_KINDS, TEST_PG_URL, createTestStore, seedWorkspace, type TestStore } from '../../test/postgres.js'
import { hashContent, readCanonical, type AdapterManifest } from '../docket.js'
import {
  documentHistory,
  insertWorkspace,
  listDocumentPage,
  listDocuments,
  postgresManifests,
  postgresSource,
  putDocument,
  readDocuments,
  retireDocument
} from './index.js'

/** The fixture's ontology with `pod` removed and `depends_on` narrowed to services, so validation has findings. */
function broken(ontology: string): string {
  return ontology
    .replace(/ {2}pod:\n {4}description: A running instance of a service.\n {4}icon: box\n/, '')
    .replace(/ {4}- name: code evidence of pod\n.*\n.*\n/, '')
    .replace('to: [service, datasource]', 'to: [service]')
}

describe.skipIf(!TEST_PG_URL).each(STORE_KINDS)('the canonical source over $name', (kind) => {
  let test: TestStore
  let fixture: Fixture
  let workspaceId: string

  beforeAll(async () => {
    test = await createTestStore(kind)
    fixture = await readFixture()
    workspaceId = await test.as(async (ctx) => {
      const id = await seedWorkspace(ctx, { slug: 'platform', ontology: fixture.ontology })
      for (const document of fixture.documents) await putDocument(ctx, { workspaceId: id, ...document, origin: 'cloud', actor: 'user:seed' })
      return id
    })
  })
  afterAll(() => test?.drop())

  it('returns the documents written, with the hash docket computes, and the published head', async () => {
    const read = await test.as(async (ctx) => {
      const out: CanonicalDocument[] = []
      for await (const document of postgresSource(ctx, workspaceId).documents()) if ('raw' in document) out.push(document)
      return out
    })
    expect(read.map((d) => d.path).sort()).toEqual(fixture.documents.map((d) => d.path))
    for (const document of fixture.documents) {
      const back = read.find((d) => d.path === document.path)
      expect(back?.raw).toBe(document.raw)
      expect(back?.hash).toBe(hashContent(document.raw))
    }
    expect(await test.as((ctx) => postgresSource(ctx, workspaceId).ontology())).toEqual({ text: fixture.ontology, revision: hashContent(fixture.ontology) })
  })

  it('runs one query at a time on the transaction while docket reads it', async () => {
    let inFlight = 0
    let most = 0
    const read = await test.as(async (ctx) => {
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

  it('stores the body as the codec seals it, with the key version beside it', async () => {
    const { rows } = await test.pool.query<{ raw_ciphertext: Buffer; dek_version: number; resource_id: string }>(
      `SELECT raw_ciphertext, dek_version, resource_id FROM ${test.schema}.documents`
    )
    expect(rows).toHaveLength(12)
    for (const row of rows) {
      expect(row.resource_id).toMatch(/^[a-z]+\./)
      if (kind.name.includes('plaintext')) {
        expect(row.dek_version).toBe(0)
        expect(row.raw_ciphertext.toString('utf8')).toContain('title:')
      } else {
        expect(row.dek_version).toBe(3)
        expect(row.raw_ciphertext.toString('utf8')).not.toContain('title:')
      }
    }
  })

  it('matches docket validate over the same files, with findings and without', async () => {
    const fromPostgres = await test.as((ctx) => validate({ source: postgresSource(ctx, workspaceId) }))
    const fromFiles = await validate({ cwd: FIXTURE_ROOT })
    expect(fromPostgres.diagnostics).toEqual(fromFiles.diagnostics)
    expect(fromPostgres.entities).toEqual(fromFiles.entities)
    expect(fromPostgres.documents).toEqual(fromFiles.documents)

    const dir = await mkdtemp(join(tmpdir(), 'docket-fixture-'))
    await cp(FIXTURE_ROOT, dir, { recursive: true })
    await writeFile(join(dir, '.docket', 'entities.yaml'), broken(fixture.ontology))
    const filesBroken = await validate({ cwd: dir })
    const postgresBroken = await test.as((ctx) => validate({ source: postgresSource(ctx, workspaceId, { ontology: broken(fixture.ontology) }) }))
    expect(filesBroken.diagnostics.map((d) => d.code).sort()).toEqual([
      'relationship-to-violation',
      'relationship-to-violation',
      'relationship-to-violation',
      'unknown-type',
      'unknown-type'
    ])
    expect(postgresBroken.diagnostics).toEqual(filesBroken.diagnostics)
    expect(postgresBroken.entities).toEqual(filesBroken.entities)
  })

  it('keeps every revision, writes nothing for unchanged text, and a retired document leaves the source', async () => {
    const path = '.docket/resources/team/discovery.md'
    const original = fixture.documents.find((d) => d.path === path)?.raw ?? ''
    const edited = original.replace('title: Discovery', 'title: Discovery and search')
    await test.as(async (ctx) => {
      expect((await putDocument(ctx, { workspaceId, path, raw: original, origin: 'cloud', actor: 'user:x' })).changed).toBe(false)
      const { document } = await putDocument(ctx, { workspaceId, path, raw: edited, origin: 'cloud', actor: 'user:x' })
      expect(document.revision).toBe(2)
      expect((await documentHistory(ctx, workspaceId, document.id)).map((r) => [r.revision, r.raw])).toEqual([
        [2, edited],
        [1, original]
      ])
      await retireDocument(ctx.tx, { workspaceId, path })
      expect((await readCanonical(postgresSource(ctx, workspaceId))).documents.map((d) => d.path)).not.toContain(path)
      expect((await listDocuments(ctx.tx, workspaceId)).length).toBe(11)
      await putDocument(ctx, { workspaceId, path, raw: original, origin: 'cloud', actor: 'user:x' })
    })
  })

  it('pages through the live documents, with their text when asked', async () => {
    const first = await test.as((ctx) => listDocumentPage(ctx, { workspaceId, limit: 5, raw: true }))
    expect(first.documents).toHaveLength(5)
    expect(first.documents[0]?.raw).toBe(fixture.documents.find((d) => d.path === first.documents[0]?.path)?.raw)
    const rest = await test.as((ctx) => listDocumentPage(ctx, { workspaceId, limit: 50, after: first.next as string }))
    expect(rest.next).toBeNull()
    expect([...first.documents, ...rest.documents].map((d) => d.path)).toEqual(fixture.documents.map((d) => d.path))
    expect(rest.documents[0]?.raw).toBeUndefined()
  })

  it('refuses a body moved to another row: it is bound to its document', async () => {
    const before = await test.as((ctx) => readDocuments(ctx, workspaceId))
    await test.pool.query(
      `UPDATE ${test.schema}.documents SET raw_ciphertext = (SELECT raw_ciphertext FROM ${test.schema}.documents WHERE path = $1),
              raw_nonce = (SELECT raw_nonce FROM ${test.schema}.documents WHERE path = $1)
        WHERE path = $2`,
      ['.docket/resources/team/commerce.md', '.docket/resources/api/orders.md']
    )
    const opened = await test.as((ctx) => readDocuments(ctx, workspaceId))
    const swapped = opened.find((d) => d.path === '.docket/resources/api/orders.md')
    expect(swapped?.raw).toBeUndefined()
    // The local key's associated data refuses it; plaintext has none, so the recorded hash does.
    expect(swapped?.error).toMatch(kind.name.includes('plaintext') ? /does not match its recorded hash/ : /does not open/)
    const { diagnostics } = await test.as((ctx) => readCanonical(postgresSource(ctx, workspaceId)))
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'unreadable-file', path: '.docket/resources/api/orders.md' })])
    // Put it back, for the tests after.
    const orders = before.find((d) => d.path === '.docket/resources/api/orders.md')
    await test.as((ctx) => putDocument(ctx, { workspaceId, path: '.docket/resources/api/orders.md', raw: `${orders?.raw}\n`, origin: 'cloud', actor: 'user:x' }))
  })

  it('refuses a malformed, misplaced or oversized document, and holds a workspace to its document limit', async () => {
    await expect(test.as((ctx) => putDocument(ctx, { workspaceId, path: '.docket/x.md', raw: 'no frontmatter', origin: 'cloud', actor: 'user:x' }))).rejects.toMatchObject({
      code: 'invalid'
    })
    const raw = fixture.documents[0]?.raw ?? ''
    await expect(test.as((ctx) => putDocument(ctx, { workspaceId, path: '../escape.md', raw, origin: 'cloud', actor: 'user:x' }))).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      test.as((ctx) => putDocument(ctx, { workspaceId, path: '.docket/big.md', raw: `${raw}\n${'x'.repeat(70_000)}`, origin: 'cloud', actor: 'user:x' }))
    ).rejects.toMatchObject({ code: 'too-large' })
    const limited = test.limited({ documentsPerWorkspace: 12 })
    await expect(
      limited.run((ctx) => putDocument(ctx, { workspaceId, path: '.docket/one-more.md', raw: '---\nid: team.more\ntype: team\ntitle: More\n---\n', origin: 'cloud', actor: 'user:x' }))
    ).rejects.toMatchObject({ code: 'limit', message: 'A workspace holds at most 12 documents.' })
  })

  it('round-trips a manifest per instance and workspace', async () => {
    const manifest = {
      version: 2,
      adapter: 'ignored',
      fingerprint: 'sha256:abc',
      scope: 'ws_one',
      definition: { name: 'neo4j', version: '1.0.0' },
      inputs: ['entity'],
      checkpoint: '0',
      owners: { 'service.orders': ['.docket/resources/service/orders.md'] },
      records: { entity: { 'service.orders': { revision: 'sha256:1' } }, link: {}, chunk: {} }
    } as unknown as AdapterManifest
    await test.as(async ({ tx }) => {
      const two = await insertWorkspace(tx, { name: 'Two', slug: 'two', createdBy: 'user:x' })
      const store = postgresManifests(tx, workspaceId)
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
