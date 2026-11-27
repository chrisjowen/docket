// SPDX-License-Identifier: AGPL-3.0-only
import { activeTab, tabLabel } from '$lib/workspace-nav'

/** One step of the breadcrumb bar: a link, or the page itself when it has no `href`. */
export interface Crumb {
  label: string
  href?: string
}

/** What org-level pages read as in the breadcrumbs, by route. */
const ORG_PAGES: Record<string, string> = {
  '/o/[org]/ask': 'Ask',
  '/o/[org]/members': 'Users',
  '/o/[org]/tokens': 'Your tokens & connections',
  '/o/[org]/audit': 'Audit log',
  '/o/[org]/settings': 'Settings',
  '/o/[org]/settings/system-accounts': 'System accounts',
  '/o/[org]/settings/system-accounts/[id]': 'System account',
  '/o/[org]/workspaces/new': 'New docket',
  '/o/[org]/spaces/new': 'New space',
}

/** A space's pages, by route: its own page carries no label of its own. */
const SPACE_PAGES: Record<string, string | null> = {
  '/o/[org]/s/[space]': null,
  '/o/[org]/s/[space]/access': 'Users & system accounts',
  '/o/[org]/s/[space]/new': 'New docket',
}

/** Pages outside any casebook. */
const OTHER_PAGES: Record<string, string> = {
  '/': 'Home',
  '/orgs/new': 'New organisation',
  '/admin/waitlist': 'Waitlist',
  '/oauth/consent/[uid]': 'Authorise a client',
}

/**
 * The breadcrumb trail for a page: its casebook, its docket and the docket's
 * section, the page itself last and unlinked.
 */
export function crumbsFor(input: {
  routeId: string | null
  pathname: string
  org?: { slug: string; name: string } | null
  workspace?: { slug: string; name: string } | null
  space?: { slug: string; name: string } | null
}): Crumb[] {
  const { routeId, pathname, org, workspace, space } = input
  if (!org) {
    const label = routeId ? OTHER_PAGES[routeId] : undefined
    return [{ label: label ?? 'Docket Cloud' }]
  }
  const casebook = `/o/${org.slug}`
  if (space && routeId && routeId in SPACE_PAGES) {
    const label = SPACE_PAGES[routeId]
    const trail: Crumb[] = [{ label: org.name, href: casebook }]
    return label ? [...trail, { label: space.name, href: `${casebook}/s/${space.slug}` }, { label }] : [...trail, { label: space.name }]
  }
  if (!workspace) {
    const label = routeId ? ORG_PAGES[routeId] : undefined
    return label ? [{ label: `${org.name} casebook`, href: casebook }, { label }] : [{ label: `${org.name} casebook` }]
  }
  const base = `/o/${org.slug}/w/${workspace.slug}`
  const tab = activeTab(pathname, org.slug, workspace.slug)
  const trail: Crumb[] = [
    { label: org.name, href: casebook },
    { label: workspace.name, href: `${base}/overview` },
  ]
  const label = tabLabel(tab)
  if (!tab || !label || tab === 'overview') return [...trail.slice(0, 1), { label: workspace.name }]
  const sectionHref = `${base}/${tab}`
  return [...trail, pathname === sectionHref ? { label } : { label, href: sectionHref }]
}
