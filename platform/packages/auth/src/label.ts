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
 * How evidence names the caller (§9.1; tenancy v2 §3.4): who, and through
 * what. `alice via 'Claude Code - work laptop'` for a named OAuth connection,
 * `github-sync with token 'actions'` for an API token, by the login of the
 * member or system account it belongs to (a token with no name goes by its
 * id: `alice with token tok_8f3a…`). A grant made before connections were
 * named reads `claude-code via alice (oauth)`. The login is always the
 * authenticated one, so a client cannot name itself as someone else.
 */
export async function principalLabel(tx: Tx, principal: Pick<Principal, 'userId' | 'via' | 'clientId' | 'tokenId'>): Promise<string> {
  const { rows } = await tx.query<{ login: string; client_name: string | null; credential: string | null }>(
    `SELECT u.login,
            (SELECT c.payload->>'client_name' FROM platform.oauth_store c
              WHERE c.model = 'Client' AND c.client_id = $2 LIMIT 1) AS client_name,
            CASE WHEN $3 = 'token' THEN (SELECT t.description FROM platform.api_tokens t WHERE t.id = $4)
                 ELSE (SELECT n.name FROM platform.oauth_connections n WHERE n.grant_id = $4) END AS credential
       FROM platform.users u WHERE u.id = $1`,
    [principal.userId, principal.clientId ?? null, principal.via, principal.tokenId],
  )
  const login = clean(rows[0]?.login ?? principal.userId, 40)
  const credential = rows[0]?.credential ? clean(rows[0].credential).replace(/'/g, '’') : ''
  if (principal.via === 'token') return credential ? `${login} with token '${credential}'` : `${login} with token ${principal.tokenId.slice(0, 8)}…`
  if (credential) return `${login} via '${credential}'`
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
 * an OAuth connection or their own API token works for. Evidence is stamped
 * with them, and evidence that cites no source is theirs. Undefined for a
 * system account: no person acts for it (tenancy v2 §3.3), its writes are its
 * own, and it must cite a source.
 */
export async function actsFor(tx: Tx, userId: string): Promise<string | undefined> {
  const { rows } = await tx.query<{ person: string | null }>(
    `SELECT CASE WHEN u.kind = 'human' THEN u.login END AS person FROM platform.users u WHERE u.id = $1`,
    [userId],
  )
  return rows[0]?.person ?? undefined
}
