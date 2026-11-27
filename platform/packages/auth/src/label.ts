// SPDX-License-Identifier: AGPL-3.0-only
import type { Tx } from '@docket/platform-tenancy'

import { isMetadataClientId } from './oauth/cimd.js'
import type { Principal } from './principal.js'

/** Printable, single-line, short: a client chooses its own name, so it is cleaned before it names anyone. */
function clean(text: string, max = 60): string {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

/**
 * How evidence names the caller (§9.1): `claude-code via alice (oauth)` for
 * an OAuth client acting for a user, `ci-bot (token tok_8f3a…)` for an API
 * token, by the login of the member or service account it belongs to. The
 * login is always the authenticated one, so a client cannot name itself as
 * someone else.
 */
export async function principalLabel(tx: Tx, principal: Pick<Principal, 'userId' | 'via' | 'clientId' | 'tokenId'>): Promise<string> {
  const { rows } = await tx.query<{ login: string; client_name: string | null }>(
    `SELECT u.login,
            (SELECT c.payload->>'client_name' FROM platform.oauth_store c
              WHERE c.model = 'Client' AND c.client_id = $2 LIMIT 1) AS client_name
       FROM platform.users u WHERE u.id = $1`,
    [principal.userId, principal.clientId ?? null],
  )
  const login = clean(rows[0]?.login ?? principal.userId, 40)
  if (principal.via === 'token') return `${login} (token ${principal.tokenId.slice(0, 8)}…)`
  const clientId = principal.clientId ?? 'client'
  let client = rows[0]?.client_name ? clean(rows[0].client_name) : ''
  if (!client && isMetadataClientId(clientId)) {
    try {
      client = new URL(clientId).host
    } catch {
      client = ''
    }
  }
  return `${client || clean(clientId, 24)} via ${login} (oauth)`
}

/**
 * The person a credential acts for (trust design §3.4), by login: the member
 * an OAuth client or their own API token works for, or a service account's
 * accountable person while they are a member of its org. Evidence is stamped
 * with them, and evidence that cites no source is theirs. Undefined for a
 * service account with no accountable person: it acts for no one, and must
 * cite a source.
 */
export async function actsFor(tx: Tx, userId: string): Promise<string | undefined> {
  const { rows } = await tx.query<{ person: string | null }>(
    `SELECT CASE WHEN u.kind = 'human' THEN u.login ELSE a.login END AS person
       FROM platform.users u
       LEFT JOIN platform.users a ON a.id = u.accountable_user_id AND a.kind = 'human'
         AND EXISTS (SELECT 1 FROM platform.memberships m WHERE m.user_id = a.id AND m.org_id = u.service_org_id)
      WHERE u.id = $1`,
    [userId],
  )
  return rows[0]?.person ?? undefined
}
