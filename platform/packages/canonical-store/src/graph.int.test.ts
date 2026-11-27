// SPDX-License-Identifier: AGPL-3.0-only
import { join } from 'node:path'

import { readGraph } from '@chrisjowen/docket/open/graph'
import { hashContent as docketHash } from '@chrisjowen/docket/source/hashing'
import { canonicalState } from '@chrisjowen/docket/sync/inputs'
import { workspaceScope } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  insertWorkspace,
  postgresManifests,
  postgresSource,
  putDocument,
  validate,
  workspaceGraph,
  type AdapterManifest,
  type UiGraph,
} from './index.js'
import { createTestOrg, readFixture, type TestOrg } from './testing.js'

/** docket's own worked example, `examples/acme-platform` in the docket repo. */
const ACME = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'acme-platform')

/** What the two graphs must agree on: everything but where the project lives and how far its index lags. */
const without = <T extends object>(value: T, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
// The cloud adds each record's and link's trust (its band, a line per source) beside docket's own fields.
const comparable = (graph: UiGraph) => ({
  entities: graph.entities.map((entity) => without(entity, 'trust')),
  edges: graph.edges.map((edge) => without(edge, 'band')),
  types: graph.types,
  relationships: graph.relationships,
  diagnostics: graph.diagnostics,
})

describe.skipIf(!TEST_PG_URL)('workspaceGraph', () => {
  let org: TestOrg
  let workspace: { id: string; slug: string; name: string }

  beforeAll(async () => {
    org = await createTestOrg()
    const acme = await readFixture(ACME)
    workspace = await org.withOrg(async (ctx) => {
      const created = await insertWorkspace(ctx.tx, { name: 'Acme platform', slug: 'acme', createdBy: org.userId })
      await ctx.tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [created.id, acme.ontology, docketHash(acme.ontology), org.userId],
      )
      // An admin import: every file at the path it has in the repo.
      for (const document of acme.documents) {
        await putDocument(ctx, { workspaceId: created.id, ...document, origin: 'repo', actor: `user:${org.userId}` })
      }
      return created
    })
  })
  afterAll(() => org?.drop())

  it('shows the acme-platform example exactly as docket open does', async () => {
    const cloud = await org.withOrg((ctx) => workspaceGraph(ctx, workspace, { root: '/o/acme/w/acme' }))
    const local = await readGraph(ACME)
    expect(local.entities.length).toBe(21)
    expect(comparable(cloud)).toEqual(comparable(local))
    expect(cloud.project).toEqual({ name: 'Acme platform', root: '/o/acme/w/acme' })
  })

  it('classifies every record and link into the ontology’s bands, with a line per source', async () => {
    const cloud = await org.withOrg((ctx) => workspaceGraph(ctx, workspace, { root: '/' }))
    // The example names no bands: docket's defaults.
    expect(cloud.trust).toEqual({ bands: { established: 0.8, probable: 0.5 }, proposals: [] })
    for (const entity of cloud.entities) {
      const confidence = entity.assessment?.confidence ?? 0
      expect(entity.trust.band).toBe(confidence >= 0.8 ? 'established' : confidence >= 0.5 ? 'probable' : 'unverified')
      expect(entity.trust.sources.length).toBe(new Set(entity.trust.sources.map((line) => `${line.source}:${line.instance ?? ''}`)).size)
    }
    // Unevidenced links stand at the ontology's 0.5: Probable.
    expect(cloud.edges.filter((edge) => edge.assessment?.basis === 'unevidenced').every((edge) => edge.band === 'probable')).toBe(true)
  })

  it('counts every entity behind until a projection records them', async () => {
    const graph = await org.withOrg((ctx) => workspaceGraph(ctx, workspace, { root: '/' }))
    expect(graph.index).toMatchObject({ synced: false, behind: 21 })
    expect(graph.index.instances.map((instance) => instance.id)).toEqual(['neo4j', 'mem0'])
  })

  it('counts only what an instance has not acknowledged', async () => {
    const scope = workspaceScope(workspace.id)
    await org.withOrg(async (ctx) => {
      const { entities, documents } = await validate({ source: postgresSource(ctx, workspace.id) })
      const records: AdapterManifest['records'] = { entity: {}, observation: {}, document: {} }
      const owners: AdapterManifest['owners'] = {}
      for (const { input, owner } of canonicalState(entities, documents, scope).inputs) {
        // mem0 holds everything; neo4j everything but the orders service.
        records[input.kind][input.id] = { revision: input.revision, ...(owner !== input.id ? { owner } : {}) }
      }
      for (const entity of entities) owners[entity.id] = entity.paths
      const manifest = (adapter: string, held: AdapterManifest['records']): AdapterManifest => ({
        version: 2,
        adapter,
        fingerprint: 'test',
        scope,
        definition: { name: adapter, version: '0' },
        inputs: ['entity'],
        checkpoint: 'test',
        owners,
        records: held,
      })
      const manifests = postgresManifests(ctx.tx, workspace.id)
      await manifests.write('mem0', manifest('mem0', records))
      const entity = { ...records.entity }
      delete entity['service.orders']
      await manifests.write('neo4j', manifest('neo4j', { ...records, entity }))
    })
    const graph = await org.withOrg((ctx) => workspaceGraph(ctx, workspace, { root: '/' }))
    expect(graph.index.synced).toBe(true)
    expect(graph.index.behind).toBe(1)
    expect(graph.index.instances.map(({ id, behind }) => ({ id, behind }))).toEqual([
      { id: 'neo4j', behind: 1 },
      { id: 'mem0', behind: 0 },
    ])
  })
})
