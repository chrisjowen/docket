// SPDX-License-Identifier: AGPL-3.0-only
import { ACCOUNT, grantRoleLabel, listGrants, type Member, type Tx } from '@docket/platform-tenancy'

/**
 * How each member reads across the account, in one word or a few: Owner, the
 * role their grant on the whole account gives (with its adjustments), or, with
 * none, Guest or "Dockets only" when they hold only grants on single dockets.
 */
export async function accountRoles(tx: Tx, orgId: string, members: readonly Pick<Member, 'id' | 'owner' | 'guest'>[]): Promise<Map<string, string>> {
  const onAccount = new Map(
    (await listGrants(tx, orgId, { place: ACCOUNT })).flatMap((grant) => (grant.who.kind === 'user' ? [[grant.who.id, grantRoleLabel(grant)] as const] : [])),
  )
  return new Map(members.map((member) => [member.id, member.owner ? 'Owner' : (onAccount.get(member.id) ?? (member.guest ? 'Guest' : 'Dockets only'))]))
}
