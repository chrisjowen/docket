// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { HOME_TAB, WORKSPACE_TABS, activeTab, tabLabel } from './workspace-nav'

describe('docket tabs', () => {
  it('lists the sections in order, opening on the overview', () => {
    expect(WORKSPACE_TABS.map((tab) => tab.label)).toEqual(['Overview', 'Record', 'Chat', 'Proposals', 'Documents', 'Schema', 'Activity', 'Access', 'MCP', 'Repos', 'Settings'])
    expect(HOME_TAB).toBe('overview')
    for (const tab of WORKSPACE_TABS) expect(tab.route).toBe(`/a/[acct]/d/[docket]/${tab.key}`)
  })

  it('marks the tab a path belongs to, nested pages included', () => {
    expect(activeTab('/a/acme/d/platform/overview', 'acme', 'platform')).toBe('overview')
    expect(activeTab('/a/acme/d/platform/graph', 'acme', 'platform')).toBe('graph')
    expect(activeTab('/a/acme/d/platform/ontology/history', 'acme', 'platform')).toBe('ontology')
    expect(activeTab('/a/acme/d/platform/settings', 'acme', 'platform')).toBe('settings')
    expect(activeTab('/a/acme/d/platform/proposals/0f3a9c21', 'acme', 'platform')).toBe('proposals')
  })

  it('marks no tab outside the workspace or its sections', () => {
    expect(activeTab('/a/acme/d/platform', 'acme', 'platform')).toBeNull()
    expect(activeTab('/a/acme/d/platform/nothing', 'acme', 'platform')).toBeNull()
    expect(activeTab('/a/acme/d/platform-two/graph', 'acme', 'platform')).toBeNull()
    expect(activeTab('/a/other/d/platform/graph', 'acme', 'platform')).toBeNull()
  })

  it('names a tab by its label', () => {
    expect(tabLabel('graph')).toBe('Record')
    expect(tabLabel('ontology')).toBe('Schema')
    expect(tabLabel(null)).toBeNull()
  })
})
