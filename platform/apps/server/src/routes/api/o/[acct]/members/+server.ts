// SPDX-License-Identifier: AGPL-3.0-only
import { listMembers } from '@docket/platform-tenancy'
import { json } from '@sveltejs/kit'

import { accountRoles } from '$lib/server/members'
import { orgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

/** The org's members. 404 for anyone outside the org, whether or not it exists (§5.5). The hook audits the call. */
export const GET: RequestHandler = async (event) => {
  const access = await orgAccess(event, { api: true })
  const { members, roles } = await getRuntime().router.withPlatform(async (tx) => {
    const members = await listMembers(tx, access.org.id)
    return { members, roles: await accountRoles(tx, access.org.id, members) }
  })
  return json({
    org: access.org.slug,
    members: members.map((member) => ({ login: member.login, kind: member.kind, role: roles.get(member.id) ?? '', owner: member.owner, guest: member.guest })),
  })
}
