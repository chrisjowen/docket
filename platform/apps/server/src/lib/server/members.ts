// SPDX-License-Identifier: AGPL-3.0-only
import { ACCOUNT, GENERAL_SPACE_ID, grantRoleLabel, listGrants, spacePlace, type Member, type Tx } from '@docket/platform-tenancy'

/**
 * How each member reads across the account, in one word or a few: Owner, the
 * role their grant on the whole account gives (with its adjustments), or,
 * with none, the role they hold on General ("Writer on General", where
 * account-wide Writers and Readers went with spaces), or Guest, or "Spaces
 * and dockets" when they hold only grants on single spaces or dockets.
 */
export async function accountRoles(tx: Tx, orgId: string, members: readonly Pick<Member, 'id' | 'owner' | 'guest'>[]): Promise<Map<string, string>> {
  const labels = async (place: typeof ACCOUNT) =>
    new Map((await listGrants(tx, orgId, { place })).flatMap((grant) => (grant.who.kind === 'user' ? [[grant.who.id, grantRoleLabel(grant)] as const] : [])))
  const onAccount = await labels(ACCOUNT)
  const onGeneral = await labels(spacePlace(GENERAL_SPACE_ID))
  const role = (member: Pick<Member, 'id' | 'owner' | 'guest'>) => {
    if (member.owner) return 'Owner'
    const account = onAccount.get(member.id)
    if (account) return account
    const general = onGeneral.get(member.id)
    if (general) return `${general} on General`
    return member.guest ? 'Guest' : 'Spaces and dockets'
  }
  return new Map(members.map((member) => [member.id, role(member)]))
}
