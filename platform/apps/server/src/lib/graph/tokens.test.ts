// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { parseQuery, passesTokens, type TokenSubject } from './tokens'

const record = (extra: Partial<TokenSubject> = {}): TokenSubject => ({
  type: 'service',
  confidence: 0.62,
  band: 'probable',
  pending: false,
  sources: [{ source: 'person', instance: 'alice' }],
  ...extra,
})

const passes = (query: string, subject: TokenSubject) => passesTokens(subject, parseQuery(query).tokens)

describe('parseQuery', () => {
  it('splits tokens from the free text that goes to search', () => {
    expect(parseQuery('checkout confidence:<0.5 is:pending owner')).toEqual({
      tokens: [{ kind: 'confidence', op: '<', value: 0.5 }, { kind: 'pending' }],
      text: 'checkout owner',
    })
  })

  it('keeps what is not a token as text: unknown keys, bad numbers, quoted phrases', () => {
    expect(parseQuery('colour:red confidence:high sources:1.5 "band:probable"')).toEqual({
      tokens: [],
      text: 'colour:red confidence:high sources:1.5 "band:probable"',
    })
  })

  it('reads a band by its name or a plain word for it', () => {
    expect(parseQuery('band:Established band:low').tokens).toEqual([
      { kind: 'band', band: 'established' },
      { kind: 'band', band: 'unverified' },
    ])
  })
})

describe('passesTokens', () => {
  it('compares confidence', () => {
    expect(passes('confidence:<0.7', record())).toBe(true)
    expect(passes('confidence:>=0.7', record())).toBe(false)
    expect(passes('confidence:0.62', record())).toBe(true)
    // A record docket has not assessed has no confidence to compare.
    expect(passes('confidence:<1', record({ confidence: null }))).toBe(false)
  })

  it('matches the band, pending proposals and type', () => {
    expect(passes('band:probable type:Service', record())).toBe(true)
    expect(passes('band:established', record())).toBe(false)
    expect(passes('is:pending', record())).toBe(false)
    expect(passes('is:pending', record({ pending: true }))).toBe(true)
  })

  it('matches a source by its type or its instance, and counts the sources', () => {
    const two = record({ sources: [{ source: 'person', instance: 'alice' }, { source: 'document', instance: null }] })
    expect(passes('source:document', two)).toBe(true)
    expect(passes('source:alice', two)).toBe(true)
    expect(passes('source:code', two)).toBe(false)
    expect(passes('sources:1', two)).toBe(false)
    expect(passes('sources:>1', two)).toBe(true)
    expect(passes('sources:0', record({ sources: [] }))).toBe(true)
  })

  it('needs every token to pass', () => {
    expect(passes('band:probable sources:2', record())).toBe(false)
  })
})
