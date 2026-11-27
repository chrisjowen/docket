// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { HOME_TAB, WORKSPACE_TABS, activeTab, tabLabel } from './workspace-nav'

describe('docket tabs', () => {
  it('lists the sections in order, opening on the overview', () => {
    expect(WORKSPACE_TABS.map((tab) => tab.label)).toEqual(['Overview', 'Record', 'Chat', 'Proposals', 'Documents', 'Schema', 'Activity', 'MCP', 'Repos', 'Settings'])
    expect(HOME_TAB).toBe('overview')
    for (const tab of WORKSPACE_TABS) expect(tab.route).toBe(`/o/[org]/w/[ws]/${tab.key}`)
  })

  it('marks the tab a path belongs to, nested pages included', () => {
    expect(activeTab('/o/acme/w/platform/overview', 'acme', 'platform')).toBe('overview')
    expect(activeTab('/o/acme/w/platform/graph', 'acme', 'platform')).toBe('graph')
    expect(activeTab('/o/acme/w/platform/ontology/history', 'acme', 'platform')).toBe('ontology')
    expect(activeTab('/o/acme/w/platform/settings', 'acme', 'platform')).toBe('settings')
    expect(activeTab('/o/acme/w/platform/proposals/0f3a9c21', 'acme', 'platform')).toBe('proposals')
  })

  it('marks no tab outside the workspace or its sections', () => {
    expect(activeTab('/o/acme/w/platform', 'acme', 'platform')).toBeNull()
    expect(activeTab('/o/acme/w/platform/nothing', 'acme', 'platform')).toBeNull()
    expect(activeTab('/o/acme/w/platform-two/graph', 'acme', 'platform')).toBeNull()
    expect(activeTab('/o/other/w/platform/graph', 'acme', 'platform')).toBeNull()
  })

  it('names a tab by its label', () => {
    expect(tabLabel('graph')).toBe('Record')
    expect(tabLabel('ontology')).toBe('Schema')
    expect(tabLabel(null)).toBeNull()
  })
})
