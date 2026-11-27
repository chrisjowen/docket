// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A docket's (workspace's) sections, shown as tabs across the top of every
 * docket page. A docket opens on its overview: the sidebar's link, the
 * casebook's and the bare `/o/{org}/w/{ws}` address all land there. The graph
 * is the docket's Record, and its ontology its Schema; Proposals is the queue
 * of replacements awaiting proof. Chat asks the docket alone. Access is who
 * may do what here, and why.
 */
export const WORKSPACE_TABS = [
  { key: 'overview', label: 'Overview', route: '/o/[org]/w/[ws]/overview' },
  { key: 'graph', label: 'Record', route: '/o/[org]/w/[ws]/graph' },
  { key: 'ask', label: 'Chat', route: '/o/[org]/w/[ws]/ask' },
  { key: 'proposals', label: 'Proposals', route: '/o/[org]/w/[ws]/proposals' },
  { key: 'documents', label: 'Documents', route: '/o/[org]/w/[ws]/documents' },
  { key: 'ontology', label: 'Schema', route: '/o/[org]/w/[ws]/ontology' },
  { key: 'activity', label: 'Activity', route: '/o/[org]/w/[ws]/activity' },
  { key: 'access', label: 'Access', route: '/o/[org]/w/[ws]/access' },
  { key: 'mcp', label: 'MCP', route: '/o/[org]/w/[ws]/mcp' },
  { key: 'repos', label: 'Repos', route: '/o/[org]/w/[ws]/repos' },
  { key: 'settings', label: 'Settings', route: '/o/[org]/w/[ws]/settings' },
] as const

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['key']

/** The section a docket opens on. */
export const HOME_TAB = 'overview' satisfies WorkspaceTab

/** Where the bare address goes with a query, which only the graph ever read (`?focus=`). */
export const QUERY_TAB = 'graph' satisfies WorkspaceTab

/** The tab a path inside workspace `ws` belongs to (`/ontology/history` is Ontology's), or null outside a tab. */
export function activeTab(pathname: string, org: string, ws: string): WorkspaceTab | null {
  const base = `/o/${org}/w/${ws}/`
  if (!pathname.startsWith(base)) return null
  const section = pathname.slice(base.length).split('/')[0]
  return WORKSPACE_TABS.find((tab) => tab.key === section)?.key ?? null
}

/** The label a tab reads as. */
export const tabLabel = (key: WorkspaceTab | null): string | null => WORKSPACE_TABS.find((tab) => tab.key === key)?.label ?? null
