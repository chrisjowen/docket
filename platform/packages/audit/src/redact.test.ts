// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { redactConsole, redactSecrets } from './redact.js'

describe('redactSecrets (§19: no tokens in logs)', () => {
  it('redacts every credential a log line could carry', () => {
    const cases: [string, string][] = [
      ['master dmk_fixtureKeyMustStayPrivate refused', 'master dmk_[redacted] refused'],
      ['token dkt_live_4kQ9xZ2mP8vR1sT6uW3yA5bC7dE9fG0hJ2kL4mN6pQ8_1a2b3c4d refused', 'token dkt_live_[redacted] refused'],
      ['authorization: Bearer opaque.token-value_1', 'authorization: Bearer [redacted]'],
      ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic [redacted]'],
      ['GitHub said ghu_16C7e42F292c6912E7710c838347Ae178B4a and ghs_abc', 'GitHub said ghu_[redacted] and ghs_[redacted]'],
      ['key sk-or-v1-0123456789abcdef', 'key sk-or-[redacted]'],
      ['GET /auth/github/callback?code=4f2a9c&state=xyz', 'GET /auth/github/callback?code=[redacted]&state=[redacted]'],
      ['POST /oauth/token grant_type=refresh_token&refresh_token=abc.def&client_id=c1', 'POST /oauth/token grant_type=refresh_token&refresh_token=[redacted]&client_id=c1'],
      ['/mcp/acme/platform?access_token=abc', '/mcp/acme/platform?access_token=[redacted]'],
      ['{"access_token":"abc","token_type":"Bearer"}', '{"access_token":"[redacted]","token_type":"Bearer"}'],
      ['connect postgres://docket_app:s3cret@docket-pg-rw:5432/docket failed', 'connect postgres://docket_app:[redacted]@docket-pg-rw:5432/docket failed'],
    ]
    for (const [line, redacted] of cases) expect(redactSecrets(line), line).toBe(redacted)
  })

  it('leaves ordinary lines alone', () => {
    for (const line of [
      'audit: chain check passed for 3 log(s)',
      'worker up: projecting into a Neo4j pod per org and Qdrant',
      'process exited with code 1',
      'GET /o/acme/w/platform/graph?type=service 200',
    ]) {
      expect(redactSecrets(line)).toBe(line)
    }
  })
})

describe('redactConsole', () => {
  it('redacts what every writer prints, formatted as the console formats it, once', () => {
    const printed: string[] = []
    const sink = { log: (line: string) => printed.push(line), info: () => {}, warn: () => {}, error: (line: string) => printed.push(line), debug: () => {} }
    const target = sink as unknown as Console
    redactConsole(target)
    redactConsole(target)
    target.log('token %s for %d calls', 'dkt_live_abc_123', 3)
    target.error(new Error('refused Bearer abc.def'))
    expect(printed[0]).toBe('token dkt_live_[redacted] for 3 calls')
    expect(printed[1]).toMatch(/^Error: refused Bearer \[redacted\]\n\s+at /)
  })
})
