// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { hashContent } from '@chrisjowen/docket/source/hashing'
import { insertWorkspace, putDocument, retireDocument } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type Fixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { createConnection, githubApp, linkInstallation, type GitHubApp } from '@docket/platform-github'
import { createWorkspace } from '@docket/platform-ontology-service'
import type { StoreAccess } from '@docket/platform-projections'
import { HAVE_TEST_STORES, TEST_STORES, startFakeEmbedder } from '@docket/platform-projections/testing'
import { mem0Collection, qdrantProvisioner } from '@docket/platform-provisioner'
import { workspaceScope } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import neo4j from 'neo4j-driver'

import { startFakeGitHub, type FakeGit } from '../../../tests/fake-github/server.mjs'

import { reconciler, type ReconcileDeps, type Reconciler } from './reconcile.js'

export const HAVE_STACK = Boolean(TEST_PG_URL && HAVE_TEST_STORES)

/**
 * One org with a workspace on the 12-document fixture ontology, its stores
 * (the test Neo4j, a Qdrant collection of its own, a fake embedder), and
 * counters that read the stores directly.
 */
export interface Harness {
  org: TestOrg
  workspaceId: string
  scope: string
  access: StoreAccess
  deps: ReconcileDeps
  reconciler(overrides?: Partial<ReconcileDeps>): Reconciler
  write(path: string, raw: string): Promise<void>
  retire(path: string): Promise<void>
  /** Non-stub nodes in the workspace's scope, and how many distinct ids they carry. */
  nodes(): Promise<{ count: number; ids: string[] }>
  /** mem0 memories under `userId = ws_<id>`, and the entity ids they belong to. */
  memories(): Promise<{ count: number; ids: string[] }>
  close(): Promise<void>
}

export async function createHarness(): Promise<Harness> {
  const org = await createTestOrg()
  const fixture = await readFixture()
  const workspaceId = await org.withOrg(async (ctx) => {
    const workspace = await insertWorkspace(ctx.tx, { name: 'Platform', slug: `p-${randomUUID().slice(0, 8)}`, createdBy: org.userId })
    await ctx.tx.query(
      `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
       VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
      [workspace.id, fixture.ontology, hashContent(fixture.ontology), org.userId],
    )
    return workspace.id
  })
  const scope = workspaceScope(workspaceId)
  const embedder = await startFakeEmbedder()
  const qdrant = qdrantProvisioner({ url: TEST_STORES.qdrantUrl ?? '', apiKey: TEST_STORES.qdrantApiKey, dimension: embedder.dimension })
  await qdrant.provision({ orgId: org.orgId })
  const access: StoreAccess = {
    neo4j: { url: TEST_STORES.neo4jUrl ?? '', username: 'neo4j', password: TEST_STORES.neo4jPassword },
    qdrant: await qdrant.access({ orgId: org.orgId }, 3_600),
    embedder,
  }
  const driver = neo4j.driver(access.neo4j.url, neo4j.auth.basic('neo4j', access.neo4j.password))
  const deps: ReconcileDeps = { router: org.router, keyring: org.keyring, storeAccess: async () => access }

  return {
    org,
    workspaceId,
    scope,
    access,
    deps,
    reconciler: (overrides = {}) => reconciler({ ...deps, ...overrides }),
    write: (path, raw) =>
      org.withOrg((ctx) => putDocument(ctx, { workspaceId, path, raw, origin: 'cloud', actor: `user:${org.userId}` }).then(() => undefined)),
    retire: (path) => org.withOrg((ctx) => retireDocument(ctx.tx, { workspaceId, path }).then(() => undefined)),
    async nodes() {
      const { records } = await driver.executeQuery(
        'MATCH (n:Memory {scope: $scope}) WHERE n.stub = false RETURN n.id AS id ORDER BY id',
        { scope },
      )
      const ids = records.map((record) => record.get('id') as string)
      return { count: ids.length, ids: [...new Set(ids)] }
    },
    async memories() {
      const response = await fetch(`${access.qdrant.url}/collections/${mem0Collection({ orgId: org.orgId })}/points/scroll`, {
        method: 'POST',
        headers: { 'api-key': TEST_STORES.qdrantApiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ filter: { must: [{ key: 'user_id', match: { value: scope } }] }, limit: 1000, with_payload: true }),
      })
      const body = (await response.json()) as { result: { points: { payload: { memory_id?: string; metadata?: { memory_id?: string } } }[] } }
      const ids = body.result.points.map((point) => point.payload.memory_id ?? point.payload.metadata?.memory_id ?? '').sort()
      return { count: ids.length, ids: [...new Set(ids)] }
    },
    async close() {
      await driver.executeQuery('MATCH (n:Memory {scope: $scope}) DETACH DELETE n', { scope }).catch(() => undefined)
      await driver.close()
      await qdrant.deprovision({ orgId: org.orgId }, 'shred').catch(() => undefined)
      await embedder.close()
      await org.drop()
    },
  }
}

/** The fixture's documents by path. */
export async function fixtureDocument(path: string): Promise<string> {
  const fixture = await readFixture()
  const document = fixture.documents.find((d) => d.path === path)
  if (!document) throw new Error(`no fixture document ${path}`)
  return document.raw
}

/**
 * A provisioned org with a workspace on the 12-document fixture's ontology,
 * a fake GitHub holding a repo with the fixture under `.docket/`, the GitHub
 * App installed on it and linked to the org. Needs `DOCKET_TEST_PG_URL`.
 */
export interface RepoFixture {
  org: TestOrg
  fixture: Fixture
  git: FakeGit
  github: GitHubApp
  workspaceId: string
  repo: { id: number; fullName: string }
  installationId: number
  /** Connects the repo (default branch, `.docket/`) to the workspace and returns the connection id. */
  connect(input?: { path?: string; workspaceId?: string }): Promise<string>
  close(): Promise<void>
}

/** The fixture as repo files: `.docket.yaml` (naming adapters, which the cloud ignores), `.docket/entities.yaml`, and its documents. */
export function repoFiles(fixture: Fixture): Record<string, string> {
  return {
    '.docket.yaml': 'version: 2\nadapters:\n  - id: local\n    module: ./tools/my-adapter.js\n    roles: [projection]\n',
    '.docket/entities.yaml': fixture.ontology,
    ...Object.fromEntries(fixture.documents.map((document) => [document.path, document.raw])),
    'README.md': '# platform\n',
  }
}

export async function createRepoFixture(): Promise<RepoFixture> {
  const org = await createTestOrg()
  const fixture = await readFixture()
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const fake = await startFakeGitHub({ app: { id: '4242', publicKey, setupUrl: 'http://127.0.0.1/github/setup' } })
  const fullName = `acme${org.orgId.slice(0, 4)}/platform`
  const repo = fake.git.createRepo({ fullName, files: repoFiles(fixture) })
  const installation = fake.git.createInstallation({ account: fullName.split('/')[0] as string, repos: [fullName] })
  const github = githubApp({ appId: '4242', privateKey, slug: 'docket-cloud-test', apiBase: fake.url, webBase: fake.url })

  const workspaceId = await org.withOrg(async (ctx) => {
    const { workspace } = await createWorkspace(ctx, {
      name: 'Platform',
      slug: 'platform',
      start: { importYaml: fixture.ontology },
      publisher: { actor: `user:${org.userId}`, login: org.login },
    })
    return workspace.id
  })
  await org.router.withPlatform((tx) =>
    linkInstallation(tx, { installationId: installation.id, orgId: org.orgId, accountLogin: 'acme', accountType: 'User', linkedBy: org.userId }),
  )
  // The org is provisioned; a webhook routes only to active orgs.
  await org.db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [org.orgId])

  return {
    org,
    fixture,
    git: fake.git,
    github,
    workspaceId,
    repo: { id: repo.id, fullName },
    installationId: installation.id,
    async connect(input = {}) {
      const connection = await org.router.withPlatform((tx) =>
        createConnection(tx, {
          orgId: org.orgId,
          installationId: installation.id,
          repo: { id: repo.id, fullName },
          branch: 'main',
          path: input.path ?? '.docket/',
          createdBy: `user:${org.userId}`,
          requestId: randomUUID(),
          enterWorkspace: async (tx) => {
            await org.router.enterTenant(tx, org.orgId)
            return input.workspaceId ?? workspaceId
          },
        }),
      )
      return connection.id
    },
    async close() {
      fake.server.closeAllConnections()
      await new Promise((resolve) => fake.server.close(resolve))
      await org.drop()
    },
  }
}
