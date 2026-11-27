// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { insertWorkspace, recordIngest } from '@docket/platform-canonical-store'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { queryService } from './query.js'
import { CUT_MODEL } from './relevance-model.js'
import { RERANKER_MODEL } from './reranker.js'
import { createHarness, fixtureDocument, HAVE_STACK, type Harness } from './testing.js'

const TEAM = '.docket/resources/team/commerce.md'
const LEDGER = '.docket/resources/datasource/ledger-db.md'

describe.skipIf(!HAVE_STACK)('the workspace search', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness()
    for (const path of [TEAM, LEDGER]) await h.write(path, await fixtureDocument(path))
    expect(await h.reconciler().reconcile(h.org.orgId, h.workspaceId)).toMatchObject({ failed: 0 })
    const logged = (workspaceId: string, resourceId: string, path: string) =>
      h.org.withOrg((ctx) =>
        recordIngest(ctx, {
          workspaceId,
          channel: 'mcp',
          actor: `user:${h.org.userId}`,
          actorLabel: 'Alice',
          action: 'remember',
          documents: [{ documentId: randomUUID(), path, resourceId, revision: 2, change: 'updated' }],
          outcome: 'ok',
          requestId: randomUUID(),
        }),
      )
    const other = await h.org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Other', slug: `o-${randomUUID().slice(0, 8)}`, createdBy: h.org.userId }))
    await logged(h.workspaceId, 'team.commerce', TEAM)
    // The same resource id, changed in another workspace of the org.
    await logged(other.id, 'datasource.ledger-db', LEDGER)
  })
  afterAll(async () => {
    await h?.close()
  })

  it("reads its timeline from the workspace's own activity log only", async () => {
    const service = queryService({
      router: h.org.router,
      keyring: h.org.keyring,
      storeAccess: async () => h.access,
      models: () => null,
      // Reads every candidate as answering the question: what is in question here is where candidates come from.
      reranker: { model: RERANKER_MODEL.name, score: async (_query, texts) => texts.map(() => 8) },
      log: { info: () => undefined, error: () => undefined },
    })
    const found = await service.search({ orgId: h.org.orgId, workspaceId: h.workspaceId, query: 'commerce ledger', limit: 10, userId: 'u-alice', include: ['timeline'] })
    expect(found.matches.map((match) => [match.id, match.foundIn])).toEqual([['team.commerce', ['timeline']]])
    expect(found.matches[0]?.score).toBeGreaterThanOrEqual(CUT_MODEL.answer)
  })
})
