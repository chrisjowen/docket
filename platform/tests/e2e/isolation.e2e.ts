// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'
import neo4j from 'neo4j-driver'

import { orgCollections, qdrantProvisioner } from '../../packages/provisioner/src/qdrant'

import { createOrg, requestRole, signIn, unique } from './helpers'

/** §5.5, the Postgres part: org A's session and org A's role see nothing of org B. */
test.describe('isolation (Postgres)', () => {
  test("org A's member gets 404 for org B, exactly as for an org that does not exist", async ({ browser }) => {
    const suffix = unique()
    const alice = await (await browser.newContext()).newPage()
    await signIn(alice, 'alice')
    const orgA = await createOrg(alice, `Alpha ${suffix}`)

    const carol = await (await browser.newContext()).newPage()
    await signIn(carol, 'carol')
    const orgB = await createOrg(carol, `Bravo ${suffix}`)

    const own = await alice.request.get(`/api/o/${orgA}/members`)
    expect(own.status()).toBe(200)

    const other = await alice.request.get(`/api/o/${orgB}/members`)
    const missing = await alice.request.get(`/api/o/nosuch${suffix}/members`)
    expect(other.status()).toBe(404)
    expect(missing.status()).toBe(404)
    expect(await other.text()).toBe(await missing.text())
    expect(await other.text()).not.toContain('carol')
    // What org B attests about its people and sources is org B's alone.
    for (const path of [`/api/o/${orgB}/people`, `/api/o/${orgB}/sources`]) {
      const read = await alice.request.get(path)
      expect(read.status(), path).toBe(404)
      expect(await read.text()).toBe(await missing.text())
    }

    // Carol's workspace, its ontology, its export and its check: all 404 to Alice.
    await carol.goto(`/o/${orgB}/workspaces/new`)
    await carol.getByLabel('Name').fill('Secret')
    await carol.getByRole('button', { name: 'Create docket' }).click()
    await expect(carol).toHaveURL(new RegExp(`/o/${orgB}/w/secret/ontology$`))
    const workspace = `/o/${orgB}/w/secret`
    for (const path of [
      `/o/${orgB}`,
      `/o/${orgB}/members`,
      `/o/${orgB}/audit`,
      workspace,
      `${workspace}/ontology`,
      `${workspace}/ontology/history`,
      `${workspace}/ontology/export`,
      `${workspace}/documents`,
      `/o/${orgA}/w/secret/ontology`,
    ]) {
      const page = await alice.request.get(path)
      expect(page.status(), path).toBe(404)
    }
    expect((await alice.request.get(`/api/o/${orgB}/w/secret/proposals`)).status()).toBe(404)
    const csrf = { 'x-csrf-token': await alice.locator('input[name="csrf"]').first().inputValue() }
    expect((await alice.request.put(`/api/o/${orgB}/people/carol`, { data: { attributes: { role: 'lead' } }, headers: csrf })).status()).toBe(404)
    expect((await alice.request.put(`/api/o/${orgB}/sources`, { data: { source: 'document', instance: 'x', attributes: {} }, headers: csrf })).status()).toBe(404)
    const check = await alice.request.post(`${workspace}/ontology/check`, {
      data: { yaml: 'version: 1\n' },
      headers: { 'x-csrf-token': await alice.locator('input[name="csrf"]').first().inputValue() },
    })
    expect(check.status()).toBe(404)
    const signedOut = await (await browser.newContext()).request.get(`/api/o/${orgB}/members`)
    expect(signedOut.status()).toBe(401)
  })

  test("with SET ROLE org_A, org B's documents are permission denied", async ({ browser }) => {
    const suffix = unique()
    const alice = await (await browser.newContext()).newPage()
    await signIn(alice, 'alice')
    const slugA = await createOrg(alice, `Charlie ${suffix}`)
    const carol = await (await browser.newContext()).newPage()
    await signIn(carol, 'carol')
    const slugB = await createOrg(carol, `Delta ${suffix}`)

    const sql = requestRole()
    await sql.connect()
    try {
      const { rows } = await sql.query<{ slug: string; id: string }>(
        'SELECT slug, id FROM platform.orgs WHERE slug = ANY($1)',
        [[slugA, slugB]],
      )
      const id = Object.fromEntries(rows.map((row) => [row.slug, row.id]))
      const a = id[slugA]
      const b = id[slugB]
      expect(a && b).toBeTruthy()

      await sql.query('BEGIN')
      await sql.query(`SET LOCAL ROLE org_${a}`)
      await expect(sql.query(`SELECT count(*) FROM org_${a}.documents`)).resolves.toBeTruthy()
      await sql.query('SAVEPOINT cross_org')
      await expect(sql.query(`SELECT * FROM org_${b}.documents`)).rejects.toThrow(/permission denied/)
      await sql.query('ROLLBACK TO SAVEPOINT cross_org')
      await expect(sql.query('SELECT * FROM platform.sessions')).rejects.toThrow(/permission denied/)
      await sql.query('ROLLBACK')

      // Without SET ROLE the request role reads no org's data at all.
      await expect(sql.query(`SELECT * FROM org_${a}.documents`)).rejects.toThrow(/permission denied/)
    } finally {
      await sql.end()
    }
  })
})

/**
 * §5.5, the projection stores. Each org's Neo4j is a pod of its own with its
 * own password (CI runs two, standing in for two orgs' pods); each org's
 * Qdrant JWT reaches only its own collections.
 */
test.describe('isolation (Neo4j and Qdrant)', () => {
  const neo4jA = { url: process.env.DOCKET_TEST_NEO4J_URL, password: process.env.DOCKET_TEST_NEO4J_PASSWORD ?? '' }
  const neo4jB = { url: process.env.DOCKET_TEST_NEO4J_B_URL, password: process.env.DOCKET_TEST_NEO4J_B_PASSWORD ?? '' }
  const qdrantUrl = process.env.DOCKET_TEST_QDRANT_URL
  const qdrantKey = process.env.DOCKET_TEST_QDRANT_API_KEY ?? ''

  test("org A's Neo4j credentials against org B's pod give an auth failure", async () => {
    test.skip(!neo4jA.url || !neo4jB.url, 'needs DOCKET_TEST_NEO4J_URL and DOCKET_TEST_NEO4J_B_URL')
    const connect = async (url: string, password: string) => {
      const driver = neo4j.driver(url, neo4j.auth.basic('neo4j', password))
      try {
        await driver.verifyConnectivity()
        await driver.executeQuery('RETURN 1')
        return 'ok'
      } catch (error) {
        return (error as { code?: string }).code ?? String(error)
      } finally {
        await driver.close()
      }
    }
    expect(await connect(neo4jB.url ?? '', neo4jB.password)).toBe('ok')
    expect(await connect(neo4jB.url ?? '', neo4jA.password)).toBe('Neo.ClientError.Security.Unauthorized')
  })

  test("org A's Qdrant JWT on org_B__mem0 gives 403", async () => {
    test.skip(!qdrantUrl, 'needs DOCKET_TEST_QDRANT_URL')
    // The orgs the Postgres tests made: real org ids from the platform schema.
    const sql = requestRole()
    await sql.connect()
    const ids = await sql
      .query<{ id: string }>("SELECT id FROM platform.orgs WHERE name LIKE 'Charlie %' OR name LIKE 'Delta %' ORDER BY name LIMIT 2")
      .then(({ rows }) => rows.map((row) => row.id))
      .finally(() => sql.end())
    expect(ids).toHaveLength(2)
    const [a, b] = ids.map((orgId) => ({ orgId: orgId ?? '' })) as [{ orgId: string }, { orgId: string }]
    const qdrant = qdrantProvisioner({ url: qdrantUrl ?? '', apiKey: qdrantKey, dimension: 32 })
    await qdrant.provision(a)
    await qdrant.provision(b)
    try {
      const tokenA = (await qdrant.access(a, 60)).token
      const read = (collection: string) =>
        fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 1 }),
        }).then((response) => response.status)
      expect(await read(`org_${a.orgId}__mem0`)).toBe(200)
      for (const collection of orgCollections(b)) expect(await read(collection)).toBe(403)
    } finally {
      await qdrant.deprovision(a, 'shred')
      await qdrant.deprovision(b, 'shred')
    }
  })
})
