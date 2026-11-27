// SPDX-License-Identifier: AGPL-3.0-only
import { format } from 'node:util'

/**
 * What must never reach a log (§19): API tokens, bearer and basic
 * credentials, GitHub and OpenRouter keys, OAuth codes and tokens in a URL,
 * a form or a JSON body, and the password in a connection string. Logs are
 * written by `console`, so every process puts this in front of it
 * (`redactConsole`) rather than trusting each line to leave secrets out.
 */
const SECRETS: readonly [RegExp, string][] = [
  [/\bdmk_[A-Za-z0-9]+/g, 'dmk_[redacted]'],
  [/\bdkt_live_[A-Za-z0-9_]+/g, 'dkt_live_[redacted]'],
  [/\bdkt_pat_[A-Za-z0-9_]+/g, 'dkt_pat_[redacted]'],
  [/\bdkt_sys_[A-Za-z0-9_]+/g, 'dkt_sys_[redacted]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
  [/\b(gh[opsur]_|github_pat_)[A-Za-z0-9_]+/g, '$1[redacted]'],
  [/\bsk-or-[A-Za-z0-9-]+/g, 'sk-or-[redacted]'],
  // An OAuth or GitHub callback's query: the code, its verifier and state, a device's codes.
  [/([?&])(code|code_verifier|state|user_code|device_code)=[^&\s"'#]+/gi, '$1$2=[redacted]'],
  [/\b((?:access_|refresh_|id_)?token|client_secret|password|api_?key)=[^&\s"',;]+/gi, '$1=[redacted]'],
  [/("(?:access_token|refresh_token|id_token|device_code|client_secret|password|token)"\s*:\s*")[^"]*"/gi, '$1[redacted]"'],
  [/\b(postgres(?:ql)?|bolt|neo4j(?:\+s)?|https?):\/\/([^:/\s@]+):[^@\s/]+@/gi, '$1://$2:[redacted]@'],
]

/** The text with every secret it holds replaced by `[redacted]`. */
export function redactSecrets(text: string): string {
  return SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
}

const REDACTED = Symbol.for('docket-cloud.redacted-console')
const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

/**
 * Puts `redactSecrets` in front of the console's writers: each call's
 * arguments are formatted as the console would format them, then redacted.
 * Calling it again changes nothing.
 */
export function redactConsole(target: Console = console): void {
  const marked = target as Console & { [REDACTED]?: true }
  if (marked[REDACTED]) return
  for (const method of METHODS) {
    const write = target[method].bind(target)
    target[method] = (...args: unknown[]) => write(redactSecrets(format(...args)))
  }
  marked[REDACTED] = true
}
