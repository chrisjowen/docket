// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import type { OntologyModel, PolicyModel } from './editor'
import { conditionFields, unknownConditions } from './schema'

describe('conditionFields and unknownConditions', () => {
  const model: OntologyModel = {
    resourceTypes: {},
    relationships: {},
    sources: {
      patient: {
        attributes: { diagnosisCode: { type: 'string', setBy: 'reporter' } },
        locator: { chartId: {} },
      },
    },
  }

  it('lists only the attributes and locator fields the source type itself declares', () => {
    expect(conditionFields(model, 'patient')).toEqual(['diagnosisCode', '@chartId'])
  })

  it('flags a condition on a field the source never declared, even when it borrows SDLC-shaped vocabulary', () => {
    const policy: PolicyModel = { name: 'stray', when: { source: 'patient', '@repository': 'x', '@commit': 'y', '@chartId': 'z' }, score: 0.5 }
    expect(unknownConditions(model, policy)).toEqual(['@repository', '@commit'])
  })

  it('does not flag a condition on a field the source actually declares', () => {
    const policy: PolicyModel = { name: 'fine', when: { source: 'patient', diagnosisCode: 'x', '@chartId': 'y' }, score: 0.5 }
    expect(unknownConditions(model, policy)).toEqual([])
  })
})
