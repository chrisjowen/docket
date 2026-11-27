// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { parseMasterKeyCommand } from './master-key-tool.js'

describe('parseMasterKeyCommand', () => {
  it('reads mint, list and revoke', () => {
    expect(parseMasterKeyCommand(['mint', 'initech', '--by', 'alice'])).toEqual({ command: 'mint', org: 'initech', by: 'alice' })
    expect(parseMasterKeyCommand(['mint', 'initech', '--by', 'alice', '--ttl-days', '90', '--database-limit', '200'])).toEqual({
      command: 'mint',
      org: 'initech',
      by: 'alice',
      ttlDays: 90,
      databaseLimit: 200,
    })
    expect(parseMasterKeyCommand(['list', 'initech'])).toEqual({ command: 'list', org: 'initech' })
    expect(parseMasterKeyCommand(['revoke', 'initech', 'mk_1', '--by', 'alice'])).toEqual({ command: 'revoke', org: 'initech', by: 'alice', keyId: 'mk_1' })
    expect(parseMasterKeyCommand(['revoke', 'initech', '--all', '--by', 'alice'])).toEqual({ command: 'revoke', org: 'initech', by: 'alice', keyId: 'all' })
  })

  it('refuses anything else, so the usage is printed and nothing runs', () => {
    for (const argv of [
      [],
      ['mint'],
      ['mint', 'initech'],
      ['mint', 'initech', 'extra', '--by', 'alice'],
      ['mint', 'initech', '--by', 'alice', '--ttl-days', 'ninety'],
      ['mint', 'initech', '--by', 'alice', '--database-limit', '-1'],
      ['mint', 'initech', '--by', 'alice', '--all'],
      ['list', 'initech', '--by', 'alice'],
      ['list', 'initech', '--ttl-days', '9'],
      ['revoke', 'initech', 'mk_1'],
      ['revoke', 'initech', '--by', 'alice'],
      ['revoke', 'initech', 'mk_1', '--all', '--by', 'alice'],
      ['revoke', 'initech', 'mk_1', '--by', 'alice', '--database-limit', '5'],
      ['rotate', 'initech', '--by', 'alice'],
      ['mint', 'initech', '--by', 'alice', '--unknown'],
    ]) {
      expect(parseMasterKeyCommand(argv), argv.join(' ')).toBeNull()
    }
  })
})
