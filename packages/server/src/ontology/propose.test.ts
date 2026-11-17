import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { OntologyInvalid } from './errors.js'
import { mergePatch, proposedText } from './propose.js'

describe('proposedText', () => {
  const head = '# The head.\nversion: 1\nresourceTypes:\n  service:\n    description: A service. # kept\n  pod:\n    description: A pod.\n'

  it('merges a patch onto the head, keeping its comments, with null removing a key', () => {
    const text = proposedText(head, { patch: 'resourceTypes:\n  team:\n    description: A team.\n  pod: null\n' })
    expect(parse(text)).toEqual({ version: 1, resourceTypes: { service: { description: 'A service.' }, team: { description: 'A team.' } } })
    expect(text).toContain('# The head.')
    expect(text).toContain('# kept')
  })

  it('takes a whole ontology as it is, and refuses a patch that is not a mapping', () => {
    expect(proposedText(head, { yaml: 'version: 1\n' })).toBe('version: 1\n')
    expect(() => proposedText(head, { patch: '- a list' })).toThrow(OntologyInvalid)
  })

  it('makes the whole text from a patch when nothing is published yet', () => {
    expect(parse(proposedText(null, { patch: 'version: 1\nresourceTypes:\n  service: { description: A service. }\n' }))).toEqual({
      version: 1,
      resourceTypes: { service: { description: 'A service.' } }
    })
  })

  it('follows RFC 7396 for plain values', () => {
    expect(mergePatch({ a: { b: 1, c: 2 }, d: [1] }, { a: { c: null, e: 3 }, d: [2] })).toEqual({ a: { b: 1, e: 3 }, d: [2] })
  })
})
