// SPDX-License-Identifier: AGPL-3.0-only
import { listAudit, verifyChainIn } from '@docket/platform-audit'
import { listMembers } from '@docket/platform-tenancy'

import { authorise, orgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { PageServerLoad } from './$types'

/** The org's audit log: in full for owners and admins, a member's own entries otherwise (§4). */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  authorise(access, 'audit.view-own')
  const full = access.can('audit.view-full')
  const actor = `user:${event.locals.user?.id}`
  // An activity log entry links here with its request id.
  const request = event.url.searchParams.get('request')?.slice(0, 100) || null
  const filter = request ? { requestId: request } : {}
  const { router } = getRuntime()
  const [events, verdict, members] = await Promise.all([
    router.withTenant(access.org.id, (tx) => listAudit(tx, full ? { ...filter, limit: 200 } : { ...filter, actor, limit: 200 })),
    full ? router.withTenant(access.org.id, verifyChainIn) : Promise.resolve(null),
    router.withPlatform((tx) => listMembers(tx, access.org.id)),
  ])
  const names = new Map(members.map((member) => [`user:${member.id}`, member.login]))
  return {
    full,
    verdict,
    request,
    events: events.map((entry) => ({
      id: entry.id,
      at: entry.at.toISOString(),
      actor: names.get(entry.actor) ? `@${names.get(entry.actor)}` : entry.actor,
      action: entry.action,
      target: entry.target,
      outcome: entry.outcome,
      ip: entry.ip,
      latencyMs: entry.latencyMs,
    })),
  }
}
