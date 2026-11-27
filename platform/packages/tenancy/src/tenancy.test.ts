// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { TenantIdError, orgRole, orgSchema, qdrantCollectionPrefix, workspaceScope } from './index.js'

describe('tenant names', () => {
  it('derives the per-org and per-workspace names', () => {
    expect(orgSchema('acme1')).toBe('org_acme1')
    expect(orgRole('acme1')).toBe('org_acme1')
    expect(workspaceScope('w42')).toBe('ws_w42')
    expect(qdrantCollectionPrefix('acme1')).toBe('org_acme1__')
  })

  it.each(['', 'Acme', 'a-b', 'a;drop', 'a'.repeat(41)])('refuses the id %j', (id) => {
    expect(() => orgSchema(id)).toThrow(TenantIdError)
    expect(() => workspaceScope(id)).toThrow(TenantIdError)
  })
})
