// SPDX-License-Identifier: AGPL-3.0-only
import { setMemberAttributes } from '@docket/platform-canonical-store'
import { json } from '@sveltejs/kit'

import { authorise, orgAccess, requireUser } from '$lib/server/request'
import { attest, bodyOf, memberByLogin } from '$lib/server/trust'
import { inOrg } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * Sets what the directory attests about a member, replacing what it said:
 * `{ "attributes": { "role": "lead", "team": "payments", "flags": ["trusted-reviewer"] } }`.
 * Empty attributes take them out of the directory. Owners and admins only;
 * every workspace is scored again.
 */
export const PUT: RequestHandler = async (event) => {
  const user = requireUser(event)
  const access = await orgAccess(event, { api: true })
  authorise(access, 'settings')
  const member = await memberByLogin(access, event.params.login)
  const body = await bodyOf(event)
  const person = await inOrg(access, (ctx) =>
    attest(event, access, ctx, async () => ({
      value: await setMemberAttributes(ctx, { userId: member.id, login: member.login, name: member.name, attributes: body.attributes ?? {}, actor: `user:${user.id}` }),
      action: 'trust.person',
      target: [`user:${member.id}`],
      args: { attributes: body.attributes ?? {} },
    })),
  )
  return json({ login: member.login, attributes: person?.attributes ?? {}, updatedAt: person?.updatedAt.toISOString() ?? null })
}
