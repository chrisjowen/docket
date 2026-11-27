// SPDX-License-Identifier: AGPL-3.0-only
import { workspaceBySlug, type StoreContext, type Workspace } from '@docket/platform-canonical-store'
import { listMembers } from '@docket/platform-tenancy'
import { error, type RequestEvent } from '@sveltejs/kit'

import { namespaceAccess, orgAccess, type NamespaceAccess, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/** Runs `fn` in one transaction as the org (`withTenant`), with the org's data keys. */
export async function inOrg<T>(access: OrgAccess, fn: (ctx: StoreContext) => Promise<T>): Promise<T> {
  const { keyring, router } = getRuntime()
  const keys = await keyring.forOrg(access.org.id)
  return router.withTenant(access.org.id, (tx) => fn({ tx, keys }))
}

export interface WorkspaceScope {
  access: NamespaceAccess
  workspace: Workspace
  ctx: StoreContext
}

/**
 * Runs `fn` inside the org's transaction for the workspace named in the URL
 * path (§3), as far as the member's access to that docket goes. A workspace
 * the org does not have answers 404, like an org the user is not in (§5.5),
 * and so does one the member may not see.
 */
export async function inWorkspace<T>(
  event: RequestEvent,
  fn: (scope: WorkspaceScope) => Promise<T>,
  options: { api?: boolean } = {},
): Promise<T> {
  const org = await orgAccess(event, options)
  return inOrg(org, async (ctx) => {
    const workspace = await workspaceBySlug(ctx.tx, event.params.ws ?? '')
    if (!workspace) error(404, 'Not found')
    return fn({ access: namespaceAccess(org, workspace), workspace, ctx })
  })
}

/** The member's access to the docket named in the URL path, for a route that works on it outside its transaction. */
export async function docketAccess(event: RequestEvent, options: { api?: boolean } = {}): Promise<{ access: NamespaceAccess; workspace: Workspace }> {
  return inWorkspace(event, async ({ access, workspace }) => ({ access, workspace }), options)
}

/** The publisher an ontology change is recorded under: the audit actor, and the GitHub login its evidence names. */
export function publisherOf(event: RequestEvent) {
  const user = event.locals.user
  if (!user) error(401, 'Sign in first.')
  return { actor: `user:${user.id}`, login: user.login }
}

/**
 * How audit actors read on a page: `user:<id>` as `@login` for the org's
 * members, an MCP client's `oauth:<client>/user:<id>` as `@login via <client>`,
 * anything else as it is.
 */
export async function actorNames(access: OrgAccess): Promise<(actor: string | null) => string> {
  const members = await getRuntime().router.withPlatform((tx) => listMembers(tx, access.org.id))
  const names = new Map(members.map((member) => [`user:${member.id}`, `@${member.login}`]))
  return (actor) => {
    if (!actor) return ''
    const oauth = /^oauth:(.+)\/(user:.+)$/.exec(actor)
    const via = oauth && names.get(oauth[2] as string)
    return names.get(actor) ?? (via ? `${via} via ${oauth[1]}` : actor)
  }
}

/** How the activity log's actors read: a member as @login; a token or OAuth client by how its evidence names it. */
export function activityActors(name: (actor: string | null) => string): (actor: string, label: string) => string {
  return (actor, label) => (actor.startsWith('user:') && name(actor) !== actor ? name(actor) : label)
}

/**
 * A text field as the person typed it. Browsers send every line break in a
 * form field as CRLF; uploaded files are kept byte for byte.
 */
export function formText(form: FormData, name: string): string {
  return String(form.get(name) ?? '').replace(/\r\n/g, '\n')
}
