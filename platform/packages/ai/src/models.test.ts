// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest'

import { MODEL_ALLOWLIST, configureModels, modelAllowlist } from './models.js'

describe('the models orgs may choose from', () => {
  afterEach(() => configureModels(undefined))

  it("is the release's OpenRouter list unless the operator gives one", () => {
    expect(modelAllowlist()).toBe(MODEL_ALLOWLIST)
    configureModels('{"cypher":["qwen2.5:7b"],"synthesis":[" llama3.1:8b ","qwen2.5:14b"]}')
    expect(modelAllowlist()).toEqual({ cypher: ['qwen2.5:7b'], synthesis: ['llama3.1:8b', 'qwen2.5:14b'] })
    configureModels('')
    expect(modelAllowlist()).toBe(MODEL_ALLOWLIST)
  })

  it('refuses a list it cannot use, so the server does not start on it', () => {
    expect(() => configureModels('not json')).toThrow(/JSON object/)
    expect(() => configureModels('{"cypher":["a"]}')).toThrow(/DOCKET_AI_MODELS\.synthesis is a non-empty list/)
    expect(() => configureModels('{"cypher":[],"synthesis":["b"]}')).toThrow(/DOCKET_AI_MODELS\.cypher/)
  })
})
