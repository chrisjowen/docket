// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { listAudit, verifyChainIn } from '@docket/platform-audit'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { lookupMasterKey } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { masterKeyTool, parseMasterKeyCommand } from './master-key-tool.js'

const KEY = /^dmk_[0-9A-Za-z]{43}$/

describe.skipIf(!TEST_PG_URL)('master-keys.js', () => {
  let org: TestOrg
  const slug = () => `o-${org.orgId}`

  beforeAll(async () => {
    org = await createTestOrg()
  })
  afterAll(() => org?.drop())

  /** Runs one command line against the test org, collecting what it printed. */
  async function run(argv: string[], options: { tty?: boolean } = {}) {
    const out: string[] = []
    const err: string[] = []
    const command = parseMasterKeyCommand(argv)
    if (!command) throw new Error(`not a command: ${argv.join(' ')}`)
    const code = await masterKeyTool(command, {
      router: org.router,
      stdout: { isTTY: options.tty ?? false, write: (text) => out.push(text) },
      stderr: { write: (text) => err.push(text) },
    })
    return { code, stdout: out.join(''), stderr: err.join('') }
  }

  const events = (action: string) => org.withOrg(async ({ tx }) => listAudit(tx, { action }))

  it('mints a key onto stdout alone, once, and records the mint in the org log', async () => {
    const minted = await run(['mint', slug(), '--by', 'alice', '--ttl-days', '30', '--database-limit', '40'])
    expect(minted.code).toBe(0)
    expect(minted.stdout).toMatch(KEY)
    expect(minted.stderr).not.toContain(minted.stdout)
    expect(minted.stderr).toContain(minted.stdout.slice(0, 12))
    expect(minted.stderr).toContain('may hold 40 databases')

    const principal = await org.router.withPlatform((tx) => lookupMasterKey(tx, minted.stdout))
    expect(principal).toMatchObject({ orgId: org.orgId, databaseLimit: 40 })
    expect(await events('org.admin.master-key.mint')).toEqual([
      expect.objectContaining({ actor: 'system:operator:alice', outcome: 'ok', target: [`master-key:${principal?.id}`] }),
    ])
    expect((await org.withOrg(({ tx }) => verifyChainIn(tx))).ok).toBe(true)

    // The list shows it by id and prefix, never the key.
    const listed = await run(['list', slug()])
    expect(listed.code).toBe(0)
    expect(listed.stdout).toContain(`${principal?.id}  ${minted.stdout.slice(0, 12)}…  live`)
    expect(listed.stdout).not.toContain(minted.stdout)
  })

  it('refuses to mint into a terminal, and mints nothing', async () => {
    const before = await run(['list', slug()])
    const refused = await run(['mint', slug(), '--by', 'alice'], { tty: true })
    expect(refused).toMatchObject({ code: 1, stdout: '' })
    expect(refused.stderr).toContain('pipe the key')
    expect((await run(['list', slug()])).stdout).toBe(before.stdout)
  })

  it('revokes one key, then all of them, recording each revocation', async () => {
    const one = (await run(['mint', slug(), '--by', 'alice'])).stdout
    const two = (await run(['mint', slug(), '--by', 'alice'])).stdout
    const oneId = (await org.router.withPlatform((tx) => lookupMasterKey(tx, one)))?.id as string

    const revoked = await run(['revoke', slug(), oneId, '--by', 'bob'])
    expect(revoked.code).toBe(0)
    expect(revoked.stderr).toContain(`revoked ${oneId}`)
    expect(revoked.stderr).not.toContain('retired')
    expect(await org.router.withPlatform((tx) => lookupMasterKey(tx, one))).toBeNull()
    expect(await org.router.withPlatform((tx) => lookupMasterKey(tx, two))).not.toBeNull()
    expect((await run(['list', slug()])).stdout).toContain(`${oneId}  ${one.slice(0, 12)}…  revoked `)

    expect(await run(['revoke', slug(), oneId, '--by', 'bob'])).toMatchObject({ code: 1, stderr: expect.stringContaining('refused:') })

    const all = await run(['revoke', slug(), '--all', '--by', 'bob'])
    expect(all.code).toBe(0)
    expect(all.stderr).toContain('retired org-admin')
    expect(await org.router.withPlatform((tx) => lookupMasterKey(tx, two))).toBeNull()
    const recorded = await events('org.admin.master-key.revoke')
    expect(recorded.map((event) => event.actor)).toEqual(['system:operator:bob', 'system:operator:bob'])
    expect(recorded[0]?.target).toContain('service:org-admin')
    expect((await org.withOrg(({ tx }) => verifyChainIn(tx))).ok).toBe(true)
  })

  it('revokes the keys of a suspended org, recording it in the platform log', async () => {
    const key = (await run(['mint', slug(), '--by', 'alice'])).stdout
    await org.db.admin.query("UPDATE platform.orgs SET status = 'suspended' WHERE id = $1", [org.orgId])
    try {
      expect((await run(['revoke', slug(), '--all', '--by', 'dana'])).code).toBe(0)
      expect(await org.router.withPlatform((tx) => lookupMasterKey(tx, key))).toBeNull()
      const { rows } = await org.db.admin.query<{ org_id: string; action: string }>(
        "SELECT org_id, action FROM platform.audit_event WHERE actor = 'system:operator:dana'",
      )
      expect(rows).toEqual([{ org_id: org.orgId, action: 'org.admin.master-key.revoke' }])
    } finally {
      await org.db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [org.orgId])
    }
  })

  it('refuses an org that does not exist', async () => {
    expect(await run(['list', 'no-such-org'])).toMatchObject({ code: 1, stderr: 'refused: no org no-such-org\n' })
    expect(await run(['mint', 'no-such-org', '--by', 'alice'])).toMatchObject({ code: 1, stdout: '' })
  })

  it('pipes exactly the key out of the built script', async () => {
    const root = join(import.meta.dirname, '..')
    const outDir = join(root, 'node_modules', '.master-keys-test')
    await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true, sourcemap: false } })
    try {
      const url = new URL(org.db.url('app'))
      const env = {
        PATH: process.env.PATH ?? '',
        PGHOST: url.hostname,
        PGPORT: url.port || '5432',
        PGDATABASE: url.pathname.slice(1),
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: 'disable',
      }
      const child = spawn(process.execPath, [join(outDir, 'master-keys.js'), 'mint', slug(), '--by', 'carol'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
      const code = await new Promise<number | null>((done) => child.on('close', done))
      const key = Buffer.concat(out).toString('utf8')
      expect(code, Buffer.concat(err).toString('utf8')).toBe(0)
      expect(key).toMatch(KEY)
      expect(await org.router.withPlatform((tx) => lookupMasterKey(tx, key))).toMatchObject({ orgId: org.orgId })
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  }, 120_000)
})
