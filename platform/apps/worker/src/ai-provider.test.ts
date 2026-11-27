// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { aiProviderOf } from './ai-provider.js'

describe('the model provider the worker calls', () => {
  it('is OpenRouter by default, as before, and off without a key', () => {
    expect(aiProviderOf({})).toBeNull()
    expect(aiProviderOf({ OPENROUTER_API_KEY: 'k' })).toEqual({ kind: 'openrouter', apiBase: undefined, dialect: 'openrouter', sharedKey: 'k', provisioningKey: undefined })
    expect(aiProviderOf({ DOCKET_AI_PROVIDER: 'openrouter', OPENROUTER_PROVISIONING_KEY: 'p', OPENROUTER_API_KEY: '' })).toMatchObject({ sharedKey: undefined, provisioningKey: 'p' })
  })

  it('calls an OpenAI-compatible endpoint in its plain dialect, with a placeholder key when it takes none', () => {
    expect(aiProviderOf({ DOCKET_AI_PROVIDER: 'openai-compatible', DOCKET_AI_URL: 'http://ollama:11434/v1/' })).toEqual({
      kind: 'openai-compatible',
      apiBase: 'http://ollama:11434/v1',
      dialect: 'openai',
      sharedKey: 'none',
      provisioningKey: undefined,
    })
    expect(aiProviderOf({ DOCKET_AI_PROVIDER: 'openai-compatible', DOCKET_AI_URL: 'https://api.openai.com/v1', DOCKET_AI_API_KEY: 'sk', OPENROUTER_PROVISIONING_KEY: 'ignored' })).toMatchObject({ sharedKey: 'sk', provisioningKey: undefined })
    expect(() => aiProviderOf({ DOCKET_AI_PROVIDER: 'openai-compatible' })).toThrow(/DOCKET_AI_URL/)
    expect(() => aiProviderOf({ DOCKET_AI_PROVIDER: 'anthropic' })).toThrow(/openrouter or openai-compatible/)
  })
})
