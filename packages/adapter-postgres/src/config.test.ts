import { describe, expect, it } from 'vitest'

import { postgresConfigSchema, searchModeOf } from './config.js'

describe('postgres config', () => {
  it('defaults to full-text in the docket_index schema, and to hybrid once it embeds', () => {
    const plain = postgresConfigSchema.parse({ urlEnv: 'DATABASE_URL' })
    expect(plain).toMatchObject({ type: 'postgres', schema: 'docket_index', language: 'english', trigram: true })
    expect(searchModeOf(plain)).toBe('lexical')
    expect(searchModeOf(postgresConfigSchema.parse({ semantic: {} }))).toBe('hybrid')
  })

  it('refuses what it could not honour', () => {
    expect(() => postgresConfigSchema.parse({ url: 'postgres://h/db', urlEnv: 'DATABASE_URL' })).toThrow(/url or urlEnv/)
    expect(() => postgresConfigSchema.parse({ search: 'semantic' })).toThrow(/semantic section/)
    expect(() => postgresConfigSchema.parse({ schema: 'Index; DROP' })).toThrow()
    expect(() => postgresConfigSchema.parse({ traverse: { hops: 3 } })).toThrow()
    expect(() => postgresConfigSchema.parse({ password: 'secret' })).toThrow()
  })
})
