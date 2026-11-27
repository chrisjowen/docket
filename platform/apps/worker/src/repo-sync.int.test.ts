// SPDX-License-Identifier: AGPL-3.0-only
import { putDocument } from '@docket/platform-canonical-store'
import { disconnect, recentIngests } from '@docket/platform-github'
import { listDrafts, headOf } from '@docket/platform-ontology-service'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { repoSync, type RepoSync } from './repo-sync.js'
import { createRepoFixture, type RepoFixture } from './testing.js'

type Row = { path: string; origin: string; origin_ref: string | null; revision: number; retired_at: Date | null; exported_to: string | null }

describe.skipIf(!TEST_PG_URL)('repo sync against a fake Trees API', () => {
  let f: RepoFixture
  let sync: RepoSync
  let connectionId: string

  const documents = () =>
    f.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<Row>(
        'SELECT path, origin, origin_ref, revision, retired_at, exported_to FROM documents WHERE workspace_id = $1 ORDER BY path, created_at',
        [f.workspaceId],
      )
      return rows
    })
  const live = async () => (await documents()).filter((row) => row.retired_at === null)

  beforeAll(async () => {
    f = await createRepoFixture()
    sync = repoSync({ router: f.org.router, keyring: f.org.keyring, github: f.github })
    connectionId = await f.connect()
  })
  afterAll(() => f?.close())

  it('imports every docket file as an origin=repo document, as one ingest event with the commit', async () => {
    const head = f.git.repos.get(f.repo.fullName)?.refs.get('main')
    const event = (await sync.syncConnection(connectionId))!
    expect(event.commit).toBe(head)
    expect(event.repository).toBe(f.repo.fullName)
    expect(event.documents.filter((d) => d.change === 'upserted')).toHaveLength(12)
    const rows = await live()
    expect(rows.map((row) => row.path)).toEqual(f.fixture.documents.map((d) => d.path))
    for (const row of rows) {
      expect(row.origin).toBe('repo')
      expect(row.origin_ref).toBe(`${connectionId}:${row.path}`)
    }
    // README.md is outside .docket/ and is not a document; entities.yaml matches v1, so nothing is proposed.
    expect(event.ontologyDraftId).toBeNull()
  })

  it('ignores the adapters section of .docket.yaml and records a notice', async () => {
    const event = (await sync.syncConnection(connectionId, { full: true }))!
    expect(event.notices).toContainEqual(expect.stringMatching(/\.docket\.yaml names adapters; Docket Cloud runs its own adapters and ignores it/))
    // A full resync of an unchanged repo changes nothing.
    expect(event.documents).toEqual([])
  })

  it('upserts a changed blob as a new revision with origin_ref connection:path, and leaves the rest alone', async () => {
    const path = '.docket/resources/service/orders.md'
    const before = f.fixture.documents.find((d) => d.path === path)?.raw ?? ''
    const { sha } = await f.git.push(f.repo.fullName, { files: { [path]: before.replace('Takes and tracks customer orders.', 'Takes, tracks and refunds customer orders.') } })
    const event = (await sync.syncConnection(connectionId))!
    expect(event.commit).toBe(sha)
    expect(event.documents).toEqual([{ path, resourceId: 'service.orders', change: 'upserted' }])
    const row = (await live()).find((r) => r.path === path)
    expect(row).toMatchObject({ origin: 'repo', origin_ref: `${connectionId}:${path}`, revision: 2 })
    const text = await f.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM outbox WHERE workspace_id = $1 AND processed_at IS NULL', [f.workspaceId])
      return Number(rows[0]?.count)
    })
    expect(text).toBeGreaterThan(0)
  })

  it('proposes a differing entities.yaml as a draft "Proposed from owner/repo@sha", never published', async () => {
    const ontology = f.fixture.ontology.replace('resourceTypes:\n', 'resourceTypes:\n  slo:\n    description: A service level objective.\n')
    expect(ontology).not.toBe(f.fixture.ontology)
    const { sha } = await f.git.push(f.repo.fullName, { files: { '.docket/entities.yaml': ontology } })
    const event = (await sync.syncConnection(connectionId))!
    expect(event.ontologyDraftId).not.toBeNull()
    expect(event.notices).toContainEqual(expect.stringMatching(/proposed as a draft \(safe\) for an admin to review\. It is not published\./))
    const { drafts, head } = await f.org.withOrg(async ({ tx }) => ({ drafts: await listDrafts(tx, f.workspaceId), head: await headOf(tx, f.workspaceId) }))
    expect(head?.number).toBe(1)
    const draft = drafts.find((d) => d.id === event.ontologyDraftId)
    expect(draft).toMatchObject({ status: 'draft', number: null, message: `Proposed from ${f.repo.fullName}@${sha.slice(0, 7)}`, source: `repo:${f.repo.fullName}@${sha.slice(0, 7)}` })
    expect(draft?.checkResult?.classification).toBe('safe')

    // The same file on the next push is not proposed twice.
    const again = await f.git.push(f.repo.fullName, { files: { 'README.md': '# platform, again\n' } })
    const next = (await sync.syncConnection(connectionId))!
    expect(next.commit).toBe(again.sha)
    expect(next.ontologyDraftId).toBeNull()
    expect((await f.org.withOrg(({ tx }) => listDrafts(tx, f.workspaceId))).length).toBe(drafts.length)
  })

  it('holds back a file at a path a cloud document holds, and says so', async () => {
    const path = '.docket/resources/team/platform.md'
    const raw = '---\nid: team.platform\ntype: team\ntitle: Platform\n---\nWritten in the cloud.\n'
    await f.org.withOrg((ctx) => putDocument(ctx, { workspaceId: f.workspaceId, path, raw, origin: 'cloud', actor: `user:${f.org.userId}` }))
    const { sha } = await f.git.push(f.repo.fullName, { files: { [path]: raw.replace('Written in the cloud.', 'Written in the repo.') } })
    const event = (await sync.syncConnection(connectionId))!
    expect(event.commit).toBe(sha)
    expect(event.outcome).toBe('partial')
    expect(event.notices).toContainEqual(`${path} was not synced: the workspace already holds the cloud document team.platform at that path.`)
    expect((await live()).find((row) => row.path === path)?.origin).toBe('cloud')
    await f.git.push(f.repo.fullName, { files: { [path]: null } })
  })

  it('moves renamed files in one ingest event: the old paths retired, the new ones written', async () => {
    const moves = ['.docket/resources/team/commerce.md', '.docket/resources/team/discovery.md']
    const files: Record<string, string | null> = {}
    for (const path of moves) {
      files[path] = null
      files[path.replace('/team/', '/teams/')] = f.fixture.documents.find((d) => d.path === path)?.raw ?? ''
    }
    const { sha } = await f.git.push(f.repo.fullName, { files })
    const event = (await sync.syncConnection(connectionId))!
    expect(event.commit).toBe(sha)
    expect(event.documents.filter((d) => d.change === 'retired').map((d) => d.path).sort()).toEqual(moves)
    expect(event.documents.filter((d) => d.change === 'upserted').map((d) => d.path).sort()).toEqual(moves.map((p) => p.replace('/team/', '/teams/')))
    const paths = (await live()).map((row) => row.path)
    for (const path of moves) {
      expect(paths).not.toContain(path)
      expect(paths).toContain(path.replace('/team/', '/teams/'))
    }
  })

  it('directory removed retires every document, in one ingest event', async () => {
    const { sha } = await f.git.push(f.repo.fullName, { files: { '.docket': null } })
    const event = (await sync.syncConnection(connectionId))!
    const retired = event.documents.filter((d) => d.change === 'retired')
    expect(retired.map((d) => d.path).sort()).toEqual(f.fixture.documents.map((d) => d.path.replace('/team/', '/teams/')).sort())
    expect(event.notices).toContainEqual(expect.stringMatching(/has no \.docket\/ directory/))
    const remaining = (await live()).filter((row) => row.origin === 'repo')
    expect(remaining).toEqual([])
    const events = await f.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM ingest_events WHERE commit_sha = $1', [sha])
      return Number(rows[0]?.count)
    })
    expect(events).toBe(1)
  })

  it('records the error on the connection when GitHub has no such branch', async () => {
    await f.org.db.admin.query("UPDATE platform.repo_routes SET branch = 'gone' WHERE connection_id = $1", [connectionId])
    await expect(sync.syncConnection(connectionId)).rejects.toThrow(/answered 404/)
    const error = await f.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ last_sync_error: string | null }>('SELECT last_sync_error FROM repo_connections WHERE id = $1', [connectionId])
      return rows[0]?.last_sync_error
    })
    expect(error).toMatch(/answered 404/)
  })
})

describe.skipIf(!TEST_PG_URL)('reconnecting a disconnected repo', () => {
  let f: RepoFixture
  let sync: RepoSync

  beforeAll(async () => {
    f = await createRepoFixture()
    sync = repoSync({ router: f.org.router, keyring: f.org.keyring, github: f.github })
  })
  afterAll(() => f?.close())

  it("takes over the earlier connection's documents in one ingest event, so its first full sync imports cleanly", async () => {
    const first = await f.connect()
    await sync.syncConnection(first, { full: true })
    await f.org.router.withPlatform((tx) =>
      disconnect(tx, { orgId: f.org.orgId, connectionId: first, enterWorkspace: (tx) => f.org.router.enterTenant(tx, f.org.orgId) }),
    )

    const second = await f.connect()
    const { rows, events } = await f.org.withOrg(async ({ tx }) => ({
      rows: (
        await tx.query<{ path: string; origin_ref: string }>(
          "SELECT path, origin_ref FROM documents WHERE workspace_id = $1 AND origin = 'repo' AND retired_at IS NULL ORDER BY path",
          [f.workspaceId],
        )
      ).rows,
      events: await recentIngests(tx, { workspaceId: f.workspaceId, connectionId: second }),
    }))
    expect(rows.map((row) => row.path)).toEqual(f.fixture.documents.map((d) => d.path).sort())
    for (const row of rows) expect(row.origin_ref).toBe(`${second}:${row.path}`)
    expect(events).toHaveLength(1)
    expect(events[0]?.documents.map((d) => d.change)).toEqual(f.fixture.documents.map(() => 'adopted'))

    const event = (await sync.syncConnection(second, { full: true }))!
    expect(event.outcome).toBe('ok')
    expect(event.notices).not.toContainEqual(expect.stringMatching(/already holds/))
    expect(event.documents).toEqual([])
  })
})
