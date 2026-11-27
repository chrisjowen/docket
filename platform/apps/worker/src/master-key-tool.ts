// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

import { audit } from '@docket/platform-audit'
import { notifyRevoked } from '@docket/platform-auth/revocation'
import { TenancyError, listMasterKeys, mintMasterKey, revokeMasterKeys, type TenantRouter, type Tx } from '@docket/platform-tenancy'

/**
 * The operator's org master keys (docs/org-api.md §1, ops/runbooks/master-keys.md):
 * mint one, list them, revoke one or all. Mint and revoke are recorded in the
 * org's audit log as `system:operator:<by>`, or in the platform log while the
 * org is not active. A minted key goes to stdout once, alone and without a
 * newline, for the operator to pipe straight into a secret store; what the
 * mint did goes to stderr, and a mint into a terminal is refused. The list
 * shows metadata only.
 */
export const USAGE = `usage: master-keys.js mint <org> --by <operator> [--ttl-days <1-730>] [--database-limit <n>]
       master-keys.js list <org>
       master-keys.js revoke <org> <key id> --by <operator>
       master-keys.js revoke <org> --all --by <operator>`

export type MasterKeyCommand =
  | { command: 'mint'; org: string; by: string; ttlDays?: number; databaseLimit?: number }
  | { command: 'list'; org: string }
  | { command: 'revoke'; org: string; by: string; keyId: string | 'all' }

const WHOLE = /^\d+$/

/** The command the operator typed, or null for anything else (print the usage). */
export function parseMasterKeyCommand(argv: string[]): MasterKeyCommand | null {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { by: { type: 'string' }, 'ttl-days': { type: 'string' }, 'database-limit': { type: 'string' }, all: { type: 'boolean' } },
    })
  } catch {
    return null
  }
  const { values, positionals } = parsed
  const [command, org, keyId] = positionals
  const ttl = values['ttl-days']
  const limit = values['database-limit']
  if (!org || (ttl !== undefined && !WHOLE.test(ttl)) || (limit !== undefined && !WHOLE.test(limit))) return null
  if (command === 'mint' && positionals.length === 2 && values.by && !values.all) {
    return { command, org, by: values.by, ...(ttl !== undefined ? { ttlDays: Number(ttl) } : {}), ...(limit !== undefined ? { databaseLimit: Number(limit) } : {}) }
  }
  if (ttl !== undefined || limit !== undefined) return null
  if (command === 'list' && positionals.length === 2 && !values.by && !values.all) return { command, org }
  if (command === 'revoke' && values.by && (values.all ? positionals.length === 2 : positionals.length === 3 && keyId)) {
    return { command, org, by: values.by, keyId: values.all ? 'all' : (keyId as string) }
  }
  return null
}

export interface ToolIo {
  /** A minted key, alone, or the key list. */
  stdout: { isTTY?: boolean; write(text: string): unknown }
  stderr: { write(text: string): unknown }
}

class Refused extends Error {}

async function orgOf(tx: Tx, slug: string): Promise<{ id: string; active: boolean }> {
  const { rows } = await tx.query<{ id: string; status: string }>('SELECT id, status FROM platform.orgs WHERE slug = $1', [slug])
  if (!rows[0]) throw new Refused(`no org ${slug}`)
  return { id: rows[0].id, active: rows[0].status === 'active' }
}

/** Records an operator's change, last in its transaction: in the org's log, or the platform's while the org cannot be entered. */
async function record(router: TenantRouter, tx: Tx, org: { id: string; active: boolean }, event: { by: string; action: string; target: string[] }) {
  if (org.active) await router.enterTenant(tx, org.id)
  await audit(tx, {
    orgId: org.id,
    actor: `system:operator:${event.by}`,
    action: event.action,
    target: event.target,
    outcome: 'ok',
    latencyMs: 0,
    requestId: randomUUID(),
  })
}

/** Runs one command; returns the exit code: 0 done, 1 refused. */
export async function masterKeyTool(command: MasterKeyCommand, deps: { router: TenantRouter } & ToolIo): Promise<number> {
  const { router, stdout, stderr } = deps
  const say = (line: string) => stderr.write(`${line}\n`)
  const { org } = command
  try {
    if (command.command === 'mint') {
      if (stdout.isTTY) throw new Refused('stdout is a terminal; pipe the key straight into a secret store, for example `| kubectl create secret generic docket-master-key-<org> --from-file=key=/dev/stdin`')
      const { by, ttlDays, databaseLimit } = command
      const minted = await router.withPlatform(async (tx) => {
        const target = await orgOf(tx, org)
        const key = await mintMasterKey(tx, { orgId: target.id, ...(ttlDays !== undefined ? { ttlDays } : {}), ...(databaseLimit !== undefined ? { databaseLimit } : {}) })
        await record(router, tx, target, { by, action: 'org.admin.master-key.mint', target: [`master-key:${key.id}`] })
        return key
      })
      // Committed: the key is live, so it goes out now, once.
      stdout.write(minted.key)
      say(`minted ${minted.id} (${minted.prefix}…) for org ${org}, expires ${minted.expiresAt.toISOString()}; the org admin API may hold ${minted.databaseLimit} databases`)
      return 0
    }

    if (command.command === 'list') {
      const keys = await router.withPlatform(async (tx) => listMasterKeys(tx, (await orgOf(tx, org)).id))
      if (!keys.length) say(`org ${org} has no master keys`)
      const now = Date.now()
      for (const key of keys) {
        const state = key.revokedAt ? `revoked ${key.revokedAt.toISOString()}` : key.expiresAt.getTime() <= now ? 'expired' : 'live'
        const used = key.lastUsedAt ? `last used ${key.lastUsedAt.toISOString()}` : 'never used'
        stdout.write(`${key.id}  ${key.prefix}…  ${state}  created ${key.createdAt.toISOString()}  expires ${key.expiresAt.toISOString()}  ${used}\n`)
      }
      return 0
    }

    const { by, keyId } = command
    const outcome = await router.withPlatform(async (tx) => {
      const target = await orgOf(tx, org)
      const result = await revokeMasterKeys(tx, { orgId: target.id, ...(keyId === 'all' ? {} : { keyId }), by: `system:operator:${by}` })
      if (result.accessKeys > 0) await notifyRevoked(tx, `org-admin:${target.id}`)
      await record(router, tx, target, {
        by,
        action: 'org.admin.master-key.revoke',
        target: [...result.revoked.map((key) => `master-key:${key.id}`), ...(result.retired ? ['service:org-admin'] : [])],
      })
      return result
    })
    say(outcome.revoked.length ? `revoked ${outcome.revoked.map((key) => `${key.id} (${key.prefix}…)`).join(', ')}` : `org ${org} had no unrevoked master key`)
    if (outcome.retired) say(`no live master key is left: retired org-admin, revoking the ${outcome.accessKeys} access key(s) the API issued`)
    return 0
  } catch (error) {
    if (error instanceof Refused || error instanceof TenancyError) {
      say(`refused: ${error.message}`)
      return 1
    }
    throw error
  }
}
