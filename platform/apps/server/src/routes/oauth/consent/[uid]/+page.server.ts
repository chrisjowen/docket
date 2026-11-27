// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import {
  ConnectionError,
  ConsentError,
  approveConsent,
  connectionName,
  createConnection,
  denyConsent,
  describeConsent,
  interactionCookieValid,
  newGrantId,
  parseMcpResourceUrl,
  type ConsentRequest,
} from '@docket/platform-auth'
import { listWorkspaces, workspaceBySlug } from '@docket/platform-canonical-store'
import { accessOf, capsAt, docketPlace, membershipBySlug, summarise, type Capability } from '@docket/platform-tenancy'
import { error, fail, type RequestEvent } from '@sveltejs/kit'

import { auditInput, requireUser, type SignedIn } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/**
 * The consent screen of the MCP OAuth flow (§8.2 step 4; tenancy v2 §3.4):
 * who is asking, the host the code will be sent to, and the docket. Allowing
 * it makes a named connection, which acts as the user: they name it
 * (prefilled from the client's name and where it signs in from), choose the
 * dockets it reaches - the one it asked for, more of the account's, or every
 * docket they reach - and whether it only reads. A member with no access to
 * the docket cannot let a client in. Only the browser that started the
 * request sees it.
 */

type Target = {
  orgId: string
  orgSlug: string
  orgName: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  /** What the user may do on the docket asked for. */
  caps: ReadonlySet<Capability>
  owner: boolean
  /** The account's dockets the user reaches, the asked-for one first. */
  dockets: { id: string; slug: string; name: string; readOnly: boolean }[]
}

async function consentOf(event: RequestEvent, user: SignedIn): Promise<{ consent: ConsentRequest; target: Target | null }> {
  const runtime = getRuntime()
  const uid = event.params.uid ?? ''
  const gone = 'This sign-in request expired, or it was started in another browser. Start again from your MCP client.'
  if (!interactionCookieValid(event.cookies, uid, runtime.oauthCookieKeys)) error(404, gone)
  const consent = await describeConsent(runtime.oauth.provider, uid)
  if (!consent) error(404, gone)
  const named = consent.resource ? parseMcpResourceUrl(runtime.origin, consent.resource) : null
  if (!named) return { consent, target: null }
  const membership = await runtime.router.withPlatform((tx) => membershipBySlug(tx, named.orgSlug, user.id))
  if (!membership) return { consent, target: null }
  const { workspace, all } = await runtime.router.withTenant(membership.org.id, async (tx) => ({
    workspace: await workspaceBySlug(tx, named.workspaceSlug),
    all: await listWorkspaces(tx),
  }))
  if (!workspace) return { consent, target: null }
  const access = await runtime.router.withPlatform((tx) => accessOf(tx, membership.org.id, user.id))
  const caps = capsAt(access, docketPlace(workspace.id))
  if (!access || !caps.has('read')) return { consent, target: null }
  const reachable = all.flatMap((docket) => {
    const here = capsAt(access, docketPlace(docket.id))
    return here.has('read') ? [{ id: docket.id, slug: docket.slug, name: docket.name, readOnly: !here.has('write') }] : []
  })
  return {
    consent,
    target: {
      orgId: membership.org.id,
      orgSlug: membership.org.slug,
      orgName: membership.org.name,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      caps,
      owner: access.owner,
      dockets: [...reachable.filter((docket) => docket.id === workspace.id), ...reachable.filter((docket) => docket.id !== workspace.id)],
    },
  }
}

/** Where the browser signs in from, as a connection's name says it: "Mac", "Windows", "Linux"... */
function deviceOf(userAgent: string | null): string | null {
  const agent = userAgent ?? ''
  if (/iPhone|iPad/.test(agent)) return 'iPhone'
  if (/Android/.test(agent)) return 'Android'
  if (/Mac OS X|Macintosh/.test(agent)) return 'Mac'
  if (/Windows/.test(agent)) return 'Windows'
  if (/CrOS/.test(agent)) return 'Chromebook'
  if (/Linux/.test(agent)) return 'Linux'
  return null
}

export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  const { consent, target } = await consentOf(event, user)
  const device = deviceOf(event.request.headers.get('user-agent'))
  return {
    csrf: event.locals.csrf,
    client: {
      name: consent.clientName,
      id: consent.clientId,
      metadataDocument: consent.metadataDocument,
      metadataHost: consent.clientIdHost,
      redirectHost: consent.redirectHost,
      redirectUri: consent.redirectUri,
      localApp: consent.localApp,
      device: consent.device,
      preRegistered: consent.preRegistered,
    },
    resource: consent.resource,
    suggestedName: connectionName(device ? `${consent.clientName} — ${device}` : consent.clientName, consent.clientId),
    target: target && {
      orgName: target.orgName,
      orgSlug: target.orgSlug,
      workspaceName: target.workspaceName,
      workspaceSlug: target.workspaceSlug,
      workspaceId: target.workspaceId,
      role: target.owner ? 'Owner' : summarise(target.caps).label,
      readOnlyHere: !target.caps.has('write'),
      dockets: target.dockets,
    },
  }
}

export const actions: Actions = {
  approve: async (event) => {
    const user = requireUser(event)
    const runtime = getRuntime()
    const { consent, target } = await consentOf(event, user)
    if (!target || !consent.resource) return fail(403, { problem: 'You do not have access to that docket, so you cannot allow access to it.' })
    const form = await event.request.formData()
    const name = connectionName(String(form.get('name') ?? ''), consent.clientName)
    const readOnly = form.get('readOnly') === 'on'
    const reachable = new Set(target.dockets.map((docket) => docket.id))
    // The docket it asked for is always among them; others only of those the user reaches now.
    const dockets =
      form.get('reach') === 'all'
        ? null
        : [target.workspaceId, ...form.getAll('docket').map(String).filter((id) => id !== target.workspaceId && reachable.has(id))]
    // Chosen before the grant exists, so the connection it names can be written first: a grant is only ever live
    // (reachable by a lookup) once its narrowing connection row already is, with no crash window in between.
    const grantId = newGrantId()
    try {
      await runtime.router.withPlatform((tx) => createConnection(tx, { grantId, orgId: target.orgId, userId: user.id, clientId: consent.clientId, name, readOnly, dockets }))
    } catch (cause) {
      if (cause instanceof ConnectionError) return fail(400, { problem: cause.message })
      throw cause
    }
    let approved: { continueTo: string }
    try {
      approved = await approveConsent(runtime.oauth.provider, consent.uid, { accountId: user.id, resource: consent.resource, grantId })
    } catch (cause) {
      // The connection never gets used: nothing is live for it without a grant.
      await runtime.router.withPlatform((tx) => tx.query('DELETE FROM platform.oauth_connections WHERE grant_id = $1', [grantId]))
      if (cause instanceof ConsentError) return fail(400, { problem: cause.message })
      throw cause
    }
    await runtime.router.withPlatform(async (tx) => {
      await runtime.router.enterTenant(tx, target.orgId)
      await audit(
        tx,
        auditInput(event, {
          action: 'oauth.grant',
          outcome: 'ok',
          orgId: target.orgId,
          workspaceId: target.workspaceId,
          target: [consent.clientId, `conn:${grantId}`],
          args: { name, readOnly, dockets, resource: consent.resource },
        }),
      )
    })
    event.locals.audited = true
    // The page sends the browser on: a form's redirect to the client's callback would break the CSP's form-action.
    return { continueTo: approved.continueTo }
  },

  deny: async (event) => {
    const user = requireUser(event)
    const runtime = getRuntime()
    const { consent, target } = await consentOf(event, user)
    const continueTo = await denyConsent(runtime.oauth.provider, consent.uid)
    if (target) {
      await runtime.router.withTenant(target.orgId, (tx) =>
        audit(tx, auditInput(event, { action: 'oauth.deny', outcome: 'ok', orgId: target.orgId, workspaceId: target.workspaceId, target: [consent.clientId] })),
      )
      event.locals.audited = true
    }
    return { continueTo }
  },
}
