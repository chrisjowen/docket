// SPDX-License-Identifier: AGPL-3.0-only
import { TEMPLATE_IDS } from '@docket/platform-ontology-service'
import { describe, expect, it } from 'vitest'

import { adminOntology } from './org-admin'

describe('org admin ontology input', () => {
  it('accepts only the generic templates or inline YAML', () => {
    for (const template of TEMPLATE_IDS) expect(adminOntology({ template }).start).toEqual({ template })
    for (const value of [null, [], {}, { template: 'caller-specific' }, { template: 'blank', inline_yaml: 'x' }, { inline_yaml: 1 }]) {
      expect(() => adminOntology(value)).toThrow()
    }
  })

  it('validates inline ontology before any database change', () => {
    expect(() => adminOntology({ inline_yaml: 'not: [yaml' })).toThrow()
    const yaml = adminOntology({ template: 'blank' }).yaml
    expect(adminOntology({ inline_yaml: yaml }).yaml).toBe(yaml)
  })
})
