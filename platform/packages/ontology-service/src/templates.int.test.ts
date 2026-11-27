// SPDX-License-Identifier: AGPL-3.0-only
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEMPLATES } from './templates.js'
import { headOf } from './versions.js'
import { createWorkspace } from './workspaces.js'

const publisher = { actor: 'user:owner', login: 'owner' }

describe.skipIf(!TEST_PG_URL)('starting a workspace from a template', () => {
  let org: TestOrg

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s publishes as the workspace’s first ontology', async (id, t) => {
    await org.withOrg(async (ctx) => {
      // One org holds a workspace per template, more than the beta's member limit.
      const { workspace, version } = await createWorkspace(ctx, { name: t.name, slug: id, start: { template: id }, publisher, maxWorkspaces: TEMPLATES.length })
      expect(version.number).toBe(1)
      expect(version.source).toBe(`template:${id}`)
      expect(version.yaml).toBe(t.yaml)
      expect((await headOf(ctx.tx, workspace.id))?.number).toBe(1)
    })
  })
})
