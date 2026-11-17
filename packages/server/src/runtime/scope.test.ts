import { describe, expect, it } from 'vitest'

import { redactSecrets, workspaceScope } from './scope.js'

describe('a workspace’s scope', () => {
  it('is ws_<id>, for an id the store would hold', () => {
    expect(workspaceScope('abc123')).toBe('ws_abc123')
    expect(() => workspaceScope('ABC')).toThrow()
    expect(() => workspaceScope('a b')).toThrow()
  })
})

describe('redacting secrets', () => {
  it('replaces tokens, credentials and connection-string passwords, and leaves the rest', () => {
    expect(
      redactSecrets(
        'Bearer abc.def dkt_live_x1y2 dmk_q9 ghp_abc123 sk-or-v1-zz postgres://docket:hunter2@db:5432/x https://a.test/cb?code=xyz&state=s1 password=p {"token": "t"}'
      )
    ).toBe(
      'Bearer [redacted] dkt_live_[redacted] dmk_[redacted] ghp_[redacted] sk-or-[redacted] postgres://docket:[redacted]@db:5432/x https://a.test/cb?code=[redacted]&state=[redacted] password=[redacted] {"token": "[redacted]"}'
    )
    expect(redactSecrets('graph went away mid-pass')).toBe('graph went away mid-pass')
  })
})
