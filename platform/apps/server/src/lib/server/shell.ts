// SPDX-License-Identifier: AGPL-3.0-only
import { countDocuments, listSpaces, listWorkspaces, type StoreContext, type Workspace } from '@docket/platform-canonical-store'
import { headOf, listDrafts } from '@docket/platform-ontology-service'
import {
  ACCOUNT,
  CAPABILITIES,
  docketPlace,
  isAccountAdmin,
  mayCreateSpace,
  membershipsOf,
  placeKey,
  seesSpace,
  spacePlace,
  tokenNotices,
  type Capability,
} from '@docket/platform-tenancy'

import { chosenWorkspaces } from '$lib/ask/model'
import { docketNumbers } from '$lib/docket'

import { searchAcross } from './ask'
import { askDeps, orgWorkspaces } from './ask-runtime'
import { accountRoles } from './members'
import { isPlatformAdmin, readsDocket, seesDocket, type OrgAccess, type SignedIn } from './request'
import { getRuntime } from './runtime'
import { actorNames } from './workspace'

/**
 * The app's frame, one source for the pages the server still renders and the
 * `/api/v1` operations the web UI draws them from (`@docket/api`): the
 * signed-in user, an account's sidebar (`accounts.navigation`), a docket's
 * header (`dockets.summary`), who reaches a place (`access.who`) and the
 * command menu's search (`accounts.search`).
 */

/** Capability by capability, whether `caps` holds it. */
export const capabilityMap = (caps: ReadonlySet<Capability>) =>
  Object.fromEntries(CAPABILITIES.map((cap) => [cap, caps.has(cap)])) as Record<Capability, boolean>

/** A signed-in user and the accounts they are in: what every page's shell shows. */
export async function sessionView(user: SignedIn) {
  const orgs = await getRuntime().router.withPlatform((tx) => membershipsOf(tx, user.id))
  return {
    user: { login: user.login, name: user.name, avatarUrl: user.avatarUrl, allowlisted: user.allowlisted, platformAdmin: isPlatformAdmin(user) },
    orgs: orgs.map(({ org, owner, guest }) => ({ slug: org.slug, name: org.name, role: owner ? 'owner' : guest ? 'guest' : 'member' })),
  }
}

/** An account as its member sees it: the sidebar's casebook, spaces and dockets, and the AI meter. */
export async function accountShell(access: OrgAccess) {
  const { router, caps } = getRuntime()
  const [{ all, spaces }, ai, notices, role] = await Promise.all([
    router.withTenant(access.org.id, async (tx) => ({ all: await listWorkspaces(tx), spaces: await listSpaces(tx) })),
    caps.status(access.org.id),
    // System accounts' token notices go to the account's owners: there is no steward (tenancy v2 §3.3).
    access.owner ? router.withPlatform((tx) => tokenNotices(tx, access.org.id)) : Promise.resolve([]),
    router.withPlatform(async (tx) => {
      const me = { id: access.principal.userId, owner: access.owner, guest: access.principal.guest }
      return (await accountRoles(tx, access.org.id, [me])).get(me.id) ?? ''
    }),
  ])
  // Numbered across the org, so a docket keeps its number whoever is looking; listed only for those who may see it.
  const numbers = docketNumbers(all)
  const workspaces = all.filter((workspace) => seesDocket(access, workspace.id))
  const shownSpaces = spaces.filter((space) => seesSpace(access.principal, space.id))
  const createIn = new Set(shownSpaces.filter((space) => access.capsAt(spacePlace(space.id)).has('create')).map((space) => space.id))
  return {
    org: { slug: access.org.slug, name: access.org.name },
    /** What the member is across the account, in a few words: Owner, or their role there. */
    role,
    /** What they may do on the whole account, capability by capability (tenancy v2 §3.1). */
    permissions: capabilityMap(access.capsAt(ACCOUNT)),
    owner: access.owner,
    /** Admin on the whole account: may change the account's roles. */
    accountAdmin: isAccountAdmin(access.principal),
    /** Manages access, or system accounts, somewhere: the Users page and Settings › System accounts show them where. */
    managesAccess: access.canAnywhere('access'),
    managesSystemAccounts: access.canAnywhere('system'),
    workspaces: workspaces.map((workspace) => ({ slug: workspace.slug, name: workspace.name })),
    /**
     * The account's spaces the member may see (a guest only those they hold something in), General first, for
     * the sidebar's Spaces section; `create` is whether they may add a docket there (its +).
     */
    spaces: shownSpaces.map((space) => ({ id: space.id, slug: space.slug, name: space.name, general: space.general, create: createIn.has(space.id) })),
    /** May add a docket somewhere: in a space where they create dockets. */
    createsDockets: createIn.size > 0,
    /** May make a space: an admin on the whole account (Spaces +). */
    createsSpaces: mayCreateSpace(access.principal),
    /**
     * The casebook's dockets the member may see, with their docket numbers, for the sidebar; a page's own
     * `workspaces` may stand in for the list above. `open` is false for one they see but may not read.
     */
    dockets: workspaces.map((workspace) => ({
      slug: workspace.slug,
      name: workspace.name,
      spaceId: workspace.spaceId,
      docketNo: numbers.get(workspace.slug) ?? '',
      open: readsDocket(access, workspace.id),
    })),
    tokenNotices: { expiring: notices.filter((notice) => !notice.expired).length, expired: notices.filter((notice) => notice.expired).length },
    ai: { spentUsd: ai.spentUsd, capUsd: ai.capUsd, fraction: Number.isFinite(ai.fraction) ? ai.fraction : 1, warned: ai.warnedAt !== null },
  }
}

/** What a docket's header counts, read in the org's transaction. */
export async function docketFacts(ctx: StoreContext, workspace: Workspace) {
  return {
    head: await headOf(ctx.tx, workspace.id),
    drafts: (await listDrafts(ctx.tx, workspace.id)).length,
    documents: await countDocuments(ctx.tx, workspace.id),
  }
}

/** A docket's header: its name, documents, schema and drafts, and what the caller may do on it (`caps`). */
export async function docketHeader(input: {
  access: OrgAccess
  workspace: Workspace
  facts: Awaited<ReturnType<typeof docketFacts>>
  caps: ReadonlySet<Capability>
}) {
  const { access, workspace, facts, caps } = input
  const name = await actorNames(access)
  return {
    /** What the caller may do on this docket, capability by capability: every grant that covers it (tenancy v2 §3.1). */
    here: capabilityMap(caps),
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      openedAt: workspace.createdAt.toISOString(),
      documents: facts.documents,
      drafts: facts.drafts,
      head: facts.head
        ? {
            number: facts.head.number ?? 0,
            publishedAt: facts.head.publishedAt?.toISOString() ?? null,
            publishedBy: name(facts.head.publishedBy),
            message: facts.head.message,
          }
        : null,
    },
  }
}

/** The longest query the command menu sends. */
const MAX_QUERY = 200
/** Results of each kind the menu is sent; it lists the first few. */
const SENT = 5

/**
 * The command menu's search (⌘K): the same direct search as Ask's, no AI, over the dockets `named`
 * (every one of the org's the member reads when none is), with only the first few of each kind of
 * result. It asks as the member, so the search is kept in their query log like any other.
 */
export async function commandSearch(access: OrgAccess, userId: string, query: string, named: string[]) {
  const q = query.trim().slice(0, MAX_QUERY)
  const all = await orgWorkspaces(access)
  const workspaces = named.length ? chosenWorkspaces(all, named) : all
  if (!q || workspaces.length === 0) return { records: [], groups: { notes: [], memory: [], exhibits: [], entries: [] }, slots: {} }
  const found = await searchAcross(askDeps(access, userId), workspaces, q, { types: [], tags: [] })
  return {
    records: found.hits.slice(0, SENT),
    groups: {
      notes: found.groups.notes.slice(0, SENT),
      memory: found.groups.memory.slice(0, SENT),
      exhibits: found.groups.exhibits.slice(0, SENT),
      entries: found.groups.entries.slice(0, SENT),
    },
    slots: found.slots,
  }
}
