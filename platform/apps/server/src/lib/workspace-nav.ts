// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A docket's (workspace's) sections, shown as tabs across the top of every
 * docket page. A docket opens on its overview: the sidebar's link, the
 * casebook's and the bare `/a/{acct}/d/{docket}` address all land there. The graph
 * is the docket's Record, and its ontology its Schema; Proposals is the queue
 * of replacements awaiting proof. Chat asks the docket alone. Access is who
 * may do what here, and why.
 */
export const WORKSPACE_TABS = [
  { key: 'overview', label: 'Overview', route: '/a/[org]/d/[ws]/overview' },
  { key: 'graph', label: 'Record', route: '/a/[org]/d/[ws]/graph' },
  { key: 'ask', label: 'Chat', route: '/a/[org]/d/[ws]/ask' },
  { key: 'proposals', label: 'Proposals', route: '/a/[org]/d/[ws]/proposals' },
  { key: 'documents', label: 'Documents', route: '/a/[org]/d/[ws]/documents' },
  { key: 'ontology', label: 'Schema', route: '/a/[org]/d/[ws]/ontology' },
  { key: 'activity', label: 'Activity', route: '/a/[org]/d/[ws]/activity' },
  { key: 'access', label: 'Access', route: '/a/[org]/d/[ws]/access' },
  { key: 'mcp', label: 'MCP', route: '/a/[org]/d/[ws]/mcp' },
  { key: 'repos', label: 'Repos', route: '/a/[org]/d/[ws]/repos' },
  { key: 'settings', label: 'Settings', route: '/a/[org]/d/[ws]/settings' },
] as const

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['key']

/** The section a docket opens on. */
export const HOME_TAB = 'overview' satisfies WorkspaceTab

/** Where the bare address goes with a query, which only the graph ever read (`?focus=`). */
export const QUERY_TAB = 'graph' satisfies WorkspaceTab

/** The tab a path inside workspace `ws` belongs to (`/ontology/history` is Ontology's), or null outside a tab. */
export function activeTab(pathname: string, org: string, ws: string): WorkspaceTab | null {
  const base = `/a/${org}/d/${ws}/`
  if (!pathname.startsWith(base)) return null
  const section = pathname.slice(base.length).split('/')[0]
  return WORKSPACE_TABS.find((tab) => tab.key === section)?.key ?? null
}

/** The label a tab reads as. */
export const tabLabel = (key: WorkspaceTab | null): string | null => WORKSPACE_TABS.find((tab) => tab.key === key)?.label ?? null
