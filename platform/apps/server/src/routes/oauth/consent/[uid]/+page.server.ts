// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import {
  ConsentError,
  SCOPES,
  SCOPE_LABELS,
  approveConsent,
  denyConsent,
  describeConsent,
  interactionCookieValid,
  isScope,
  namespaceScopes,
  parseMcpResourceUrl,
  type ConsentRequest,
} from '@docket/platform-auth'
import { workspaceBySlug, type Workspace } from '@docket/platform-canonical-store'
import { membershipBySlug, namespaceAccess, type NamespaceAccess } from '@docket/platform-tenancy'
import { error, fail, type RequestEvent } from '@sveltejs/kit'

import { auditInput, requireUser, type SignedIn } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/**
 * The consent screen of the MCP OAuth flow (§8.2 step 4): who is asking, the
 * host the code will be sent to, the workspace, and each scope capped at the
 * user's permission on that workspace (tenancy design §5.1): a member with
 * no access to it cannot let a client in. Only the browser that started the
 * request sees it.
 */

type Target = {
  orgId: string
  orgSlug: string
  orgName: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  access: NamespaceAccess
  /** The roles the workspace lets change its ontology over MCP: `ontology:write` is offered only to them. */
  ontologyWriters: Workspace['ontologyMcpRoles']
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
  const workspace = await runtime.router.withTenant(membership.org.id, (tx) => workspaceBySlug(tx, named.workspaceSlug))
  if (!workspace) return { consent, target: null }
  const access = await runtime.router.withPlatform((tx) => namespaceAccess(tx, membership.org.id, workspace.id, user.id))
  if (!access?.permission) return { consent, target: null }
  return {
    consent,
    target: {
      orgId: membership.org.id,
      orgSlug: membership.org.slug,
      orgName: membership.org.name,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      access,
      ontologyWriters: workspace.ontologyMcpRoles,
    },
  }
}

export const load: PageServerLoad = async (event) => {
  const user = requireUser(event)
  const { consent, target } = await consentOf(event, user)
  const allowed = new Set(namespaceScopes(target?.access ?? null, target?.ontologyWriters))
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
    target: target && { orgName: target.orgName, orgSlug: target.orgSlug, workspaceName: target.workspaceName, workspaceSlug: target.workspaceSlug, role: target.access.role },
    scopes: SCOPES.filter((scope) => consent.requested.includes(scope)).map((scope) => ({
      scope,
      label: SCOPE_LABELS[scope],
      allowed: allowed.has(scope),
    })),
  }
}

export const actions: Actions = {
  approve: async (event) => {
    const user = requireUser(event)
    const runtime = getRuntime()
    const { consent, target } = await consentOf(event, user)
    if (!target || !consent.resource) return fail(403, { problem: 'You do not have access to that docket, so you cannot allow access to it.' })
    const allowed = new Set(namespaceScopes(target.access, target.ontologyWriters))
    const ticked = (await event.request.formData()).getAll('scope').filter(isScope)
    const scopes = ticked.filter((scope) => consent.requested.includes(scope) && allowed.has(scope))
    let continueTo: string
    try {
      continueTo = await approveConsent(runtime.oauth.provider, consent.uid, { accountId: user.id, resource: consent.resource, scopes })
    } catch (cause) {
      if (cause instanceof ConsentError) return fail(400, { problem: cause.message })
      throw cause
    }
    await runtime.router.withTenant(target.orgId, (tx) =>
      audit(tx, auditInput(event, { action: 'oauth.grant', outcome: 'ok', orgId: target.orgId, workspaceId: target.workspaceId, target: [consent.clientId], args: { scopes, resource: consent.resource } })),
    )
    event.locals.audited = true
    // The page sends the browser on: a form's redirect to the client's callback would break the CSP's form-action.
    return { continueTo }
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
