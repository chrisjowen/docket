// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { NO_SETTINGS, providerModel, resolveChain, type PlaceAiSettings, type SettingsChain } from './settings.js'

const LIST = {
  cypher: ['anthropic/claude-haiku-5.5', 'google/gemini-3.5-flash-lite', 'openai/gpt-4.1-mini'],
  synthesis: ['anthropic/claude-sonnet-5.5', 'google/gemini-3.8-flash', 'openai/gpt-4.1'],
}
const settings = (over: Partial<PlaceAiSettings> = {}): PlaceAiSettings => ({ ...NO_SETTINGS, ...over })
const key = (provider: 'openrouter' | 'anthropic' | 'openai') => ({ spaceId: 'eng', provider, hint: 'abcd', createdAt: new Date(0), createdBy: null })
const chain = (over: Partial<SettingsChain> = {}): SettingsChain => ({ account: NO_SETTINGS, accountCapUsd: 20, ...over })

describe('AI settings resolve account -> space -> docket (tenancy v2 §5)', () => {
  it("runs a docket with no choices anywhere on the platform's default, as before", () => {
    const resolved = resolveChain(chain({ space: { id: 'general', settings: NO_SETTINGS, key: null }, docket: { id: 'd', settings: NO_SETTINGS } }), LIST)
    expect(resolved.models.cypher).toEqual({ model: LIST.cypher[0], from: 'platform' })
    expect(resolved.models.synthesis).toEqual({ model: LIST.synthesis[0], from: 'platform' })
    expect(resolved.key).toEqual({ from: 'account' })
  })

  it("runs a docket on the account's choice, as the account's model choice did before, and ignores one off the list", () => {
    const account = settings({ models: { cypher: 'openai/gpt-4.1-mini', synthesis: 'retired/model' } })
    const resolved = resolveChain(chain({ account, space: { id: 'general', settings: NO_SETTINGS, key: null }, docket: { id: 'd', settings: NO_SETTINGS } }), LIST)
    expect(resolved.models.cypher).toEqual({ model: 'openai/gpt-4.1-mini', from: 'account' })
    expect(resolved.models.synthesis).toEqual({ model: LIST.synthesis[0], from: 'platform' })
  })

  it('takes the nearest choice: the docket over its space over the account', () => {
    const resolved = resolveChain(
      chain({
        account: settings({ models: { cypher: 'openai/gpt-4.1-mini', synthesis: 'openai/gpt-4.1' } }),
        space: { id: 'eng', settings: settings({ models: { cypher: 'google/gemini-3.5-flash-lite', synthesis: 'google/gemini-3.8-flash' } }), key: null },
        docket: { id: 'd', settings: settings({ models: { synthesis: 'anthropic/claude-sonnet-5.5' } }) },
      }),
      LIST,
    )
    expect(resolved.models.cypher).toEqual({ model: 'google/gemini-3.5-flash-lite', from: 'space' })
    expect(resolved.models.synthesis).toEqual({ model: 'anthropic/claude-sonnet-5.5', from: 'docket' })
    expect(resolved.inherited.synthesis).toEqual({ model: 'google/gemini-3.8-flash', from: 'space' })
  })

  it("holds a lower place's choice to every higher place's limit", () => {
    const account = settings({ models: { cypher: 'anthropic/claude-haiku-5.5' }, allowed: { cypher: ['anthropic/claude-haiku-5.5', 'google/gemini-3.5-flash-lite'] } })
    const space = settings({ models: { cypher: 'google/gemini-3.5-flash-lite' }, allowed: { cypher: ['google/gemini-3.5-flash-lite'] } })
    // The docket chose a model the account no longer lets anyone below it use.
    const docket = settings({ models: { cypher: 'openai/gpt-4.1-mini' } })
    const atSpace = resolveChain(chain({ account, space: { id: 'eng', settings: space, key: null } }), LIST)
    expect(atSpace.choices.cypher).toEqual(['anthropic/claude-haiku-5.5', 'google/gemini-3.5-flash-lite'])
    // Its own limit may list anything it may choose itself, so a model it took out can be put back.
    expect(atSpace.offers.cypher).toEqual(['anthropic/claude-haiku-5.5', 'google/gemini-3.5-flash-lite'])
    const atDocket = resolveChain(chain({ account, space: { id: 'eng', settings: space, key: null }, docket: { id: 'd', settings: docket } }), LIST)
    expect(atDocket.choices.cypher).toEqual(['google/gemini-3.5-flash-lite'])
    expect(atDocket.models.cypher).toEqual({ model: 'google/gemini-3.5-flash-lite', from: 'space' })
  })

  it('ignores a stale limit that leaves nothing, rather than leaving a place with no model', () => {
    const account = settings({ allowed: { synthesis: ['openai/gpt-4.1'] } })
    const space = settings({ allowed: { synthesis: ['google/gemini-3.8-flash'] } })
    const resolved = resolveChain(chain({ account, space: { id: 'eng', settings: space, key: null }, docket: { id: 'd', settings: NO_SETTINGS } }), LIST)
    expect(resolved.choices.synthesis).toEqual(['openai/gpt-4.1'])
    expect(resolved.models.synthesis.model).toBe('openai/gpt-4.1')
  })

  it("narrows a space with its own key, and its dockets, to the models its provider serves", () => {
    const resolved = resolveChain(
      chain({
        account: settings({ models: { cypher: 'google/gemini-3.5-flash-lite', synthesis: 'google/gemini-3.8-flash' } }),
        space: { id: 'eng', settings: NO_SETTINGS, key: key('anthropic') },
        docket: { id: 'd', settings: NO_SETTINGS },
      }),
      LIST,
    )
    expect(resolved.choices.cypher).toEqual(['anthropic/claude-haiku-5.5'])
    expect(resolved.models.cypher).toEqual({ model: 'anthropic/claude-haiku-5.5', from: 'platform' })
    expect(resolved.key).toEqual({ from: 'space', spaceId: 'eng', provider: 'anthropic', hint: 'abcd' })
    // An OpenRouter key serves the whole list.
    const openrouter = resolveChain(chain({ space: { id: 'eng', settings: NO_SETTINGS, key: key('openrouter') } }), LIST)
    expect(openrouter.choices.synthesis).toEqual(LIST.synthesis)
  })

  it("resolves no model when the space's key serves nothing the limits allow", () => {
    const account = settings({ allowed: { cypher: ['google/gemini-3.5-flash-lite'] } })
    const resolved = resolveChain(chain({ account, space: { id: 'eng', settings: NO_SETTINGS, key: key('openai') } }), LIST)
    expect(resolved.models.cypher).toEqual({ model: null, from: 'platform' })
  })

  it("holds a space's slice of the cap to the account's cap", () => {
    const sliced = (monthlyUsd: number) => resolveChain(chain({ accountCapUsd: 20, space: { id: 'eng', settings: settings({ monthlyUsd }), key: null } }), LIST)
    expect(sliced(5).caps).toEqual({ accountUsd: 20, spaceUsd: 5 })
    expect(sliced(50).caps).toEqual({ accountUsd: 20, spaceUsd: 20 })
    expect(resolveChain(chain(), LIST).caps).toEqual({ accountUsd: 20, spaceUsd: null })
  })
})

describe('providerModel', () => {
  it("names a listed model as each provider's own API does, or not at all", () => {
    expect(providerModel('openrouter', 'google/gemini-3.8-flash')).toBe('google/gemini-3.8-flash')
    expect(providerModel('anthropic', 'anthropic/claude-sonnet-5.5')).toBe('claude-sonnet-5-5')
    expect(providerModel('openai', 'openai/gpt-4.1-mini')).toBe('gpt-4.1-mini')
    expect(providerModel('openai', 'anthropic/claude-sonnet-5.5')).toBeNull()
  })
})
