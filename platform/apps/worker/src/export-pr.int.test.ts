// SPDX-License-Identifier: AGPL-3.0-only
import { putDocument } from '@docket/platform-canonical-store'
import { setExportEnabled } from '@docket/platform-github'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ExportError, exportPr, type ExportPr } from './export-pr.js'
import { repoSync, type RepoSync } from './repo-sync.js'
import { createRepoFixture, type RepoFixture } from './testing.js'

const CLOUD = [
  {
    path: '.docket/resources/service/ledger.md',
    raw: `---
id: service.ledger
type: service
title: Ledger
links:
  - rel: depends_on
    target: datasource.ledger-db
    evidence:
      - source: code
        path: src/db.ts
evidence:
  - source: human
    observedBy: alice
    note: told in the incident review
---
Keeps the books.
`,
  },
  {
    path: '.docket/resources/team/finance.md',
    raw: `---
id: team.finance
type: team
title: Finance
---
Owns the ledger.
`,
  },
]

describe.skipIf(!TEST_PG_URL)('export PRs', () => {
  let f: RepoFixture
  let sync: RepoSync
  let exporter: ExportPr
  let connectionId: string
  const at = new Date('2026-11-04T09:30:00Z')

  const rows = () =>
    f.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ path: string; origin: string; retired_at: Date | null; exported_to: string | null }>(
        'SELECT path, origin, retired_at, exported_to FROM documents WHERE workspace_id = $1 ORDER BY path, created_at',
        [f.workspaceId],
      )
      return rows
    })

  beforeAll(async () => {
    f = await createRepoFixture()
    sync = repoSync({ router: f.org.router, keyring: f.org.keyring, github: f.github })
    exporter = exportPr({ router: f.org.router, keyring: f.org.keyring, github: f.github, origin: 'https://docket.example', now: () => at })
    connectionId = await f.connect()
    await sync.syncConnection(connectionId)
  })
  afterAll(() => f?.close())

  it('refuses a connection without export enabled', async () => {
    await expect(exporter.exportConnection(connectionId)).rejects.toMatchObject({ code: 'disabled' })
  })

  it('says there is nothing to export when the repo already has everything', async () => {
    await f.org.withOrg(({ tx }) => setExportEnabled(tx, connectionId, true))
    await expect(exporter.exportConnection(connectionId)).rejects.toBeInstanceOf(ExportError)
  })

  it('renders two cloud documents at their paths on docket-cloud/export-<yyyymmdd-hhmm>, as one PR with the summary table', async () => {
    await f.org.withOrg(async (ctx) => {
      for (const document of CLOUD) {
        await putDocument(ctx, { workspaceId: f.workspaceId, ...document, origin: 'cloud', actor: `user:${f.org.userId}` })
      }
    })
    const result = await exporter.exportConnection(connectionId, { requestedBy: `user:${f.org.userId}` })
    expect(result.documents).toBe(2)
    expect(result.prUrl).toBe(`https://github.com/${f.repo.fullName}/pull/1`)

    const repo = f.git.repos.get(f.repo.fullName)
    const pull = repo?.pulls[0]
    expect(pull).toMatchObject({ number: 1, head: 'docket-cloud/export-20261104-0930', base: 'main', state: 'open' })
    expect(repo?.pulls).toHaveLength(1)
    expect(pull?.body).toContain('| Resource | Type | Links | Evidence | Written by | File |')
    expect(pull?.body).toContain(`| \`service.ledger\` | service | 1 | 2 | @${f.org.login} | \`.docket/resources/service/ledger.md\` |`)
    expect(pull?.body).toContain(`| \`team.finance\` | team | 0 | 0 | @${f.org.login} | \`.docket/resources/team/finance.md\` |`)
    expect(pull?.body).toContain('https://docket.example/o/')

    // The branch holds the files, byte for byte; the base branch has not moved.
    const onBranch = f.git.filesAt(f.repo.fullName, 'docket-cloud/export-20261104-0930')
    const onMain = f.git.filesAt(f.repo.fullName, 'main')
    for (const document of CLOUD) {
      expect(onBranch.has(document.path)).toBe(true)
      expect(onMain.has(document.path)).toBe(false)
    }
    // entities.yaml matches the published head, so the export leaves it alone.
    expect(onBranch.get('.docket/entities.yaml')).toBe(onMain.get('.docket/entities.yaml'))

    const audit = await f.org.withOrg(async ({ tx }) => {
      const { rows } = await tx.query<{ target: string[] }>("SELECT target FROM audit_event WHERE action = 'repo.export'")
      return rows
    })
    expect(audit[0]?.target.sort()).toEqual(['service.ledger', 'team.finance'])
  })

  it('takes the next name when an export branch for the same minute exists', async () => {
    await f.org.withOrg((ctx) =>
      putDocument(ctx, {
        workspaceId: f.workspaceId,
        path: '.docket/resources/team/payroll.md',
        raw: '---\nid: team.payroll\ntype: team\ntitle: Payroll\n---\n',
        origin: 'cloud',
        actor: `user:${f.org.userId}`,
      }),
    )
    await exporter.exportConnection(connectionId)
    expect(f.git.repos.get(f.repo.fullName)?.pulls[1]?.head).toBe('docket-cloud/export-20261104-0930-2')
  })

  it('marks the cloud documents exported_to once the merged PR syncs back, and they leave the projections', async () => {
    const merged = await f.git.mergePull(f.repo.fullName, 1)
    const event = (await sync.syncConnection(connectionId))!
    expect(event.commit).toBe(merged.sha)
    const exported = event.documents.filter((d) => d.change === 'exported').map((d) => d.resourceId).sort()
    expect(exported).toEqual(['service.ledger', 'team.finance'])

    const all = await rows()
    for (const document of CLOUD) {
      const cloud = all.find((row) => row.path === document.path && row.origin === 'cloud')
      expect(cloud?.retired_at).not.toBeNull()
      expect(cloud?.exported_to).toBe(`${connectionId}:${document.path}`)
      const repo = all.find((row) => row.path === document.path && row.origin === 'repo')
      expect(repo?.retired_at).toBeNull()
    }
    // The second export's document is still only in the cloud.
    expect(all.find((row) => row.path === '.docket/resources/team/payroll.md')).toMatchObject({ origin: 'cloud', retired_at: null, exported_to: null })
  })

  it('carries the published entities.yaml when the repo’s differs', async () => {
    await f.git.push(f.repo.fullName, { files: { '.docket/entities.yaml': `${f.fixture.ontology}\n# edited in the repo\n` }, webhook: false })
    await exporter.exportConnection(connectionId)
    const pull = f.git.repos.get(f.repo.fullName)?.pulls.at(-1)
    expect(pull?.body).toContain('The ontology is updated to the published version v1 (`.docket/entities.yaml`).')
    const branch = f.git.filesAt(f.repo.fullName, pull?.head)
    expect(branch.get('.docket/entities.yaml')).not.toBe(f.git.filesAt(f.repo.fullName, 'main').get('.docket/entities.yaml'))
  })
})
