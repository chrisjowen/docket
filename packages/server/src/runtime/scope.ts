/**
 * The scope a workspace's records carry in every projection: `ws_<id>`. It
 * keeps one workspace's records apart from another's in a store they share,
 * and it is what a rebuild or a deletion resets.
 */
export function workspaceScope(workspaceId: string): string {
  if (!/^[a-z0-9]{1,40}$/.test(workspaceId)) throw new Error('workspace id must be 1-40 lowercase letters or digits')
  return `ws_${workspaceId}`
}

/**
 * What must never reach a log or the sync history: API tokens, bearer and
 * basic credentials, GitHub and OpenRouter keys, OAuth codes and tokens in a
 * URL, a form or a JSON body, and the password in a connection string. A
 * store's error can quote any of them.
 */
const SECRETS: readonly [RegExp, string][] = [
  [/\bdmk_[A-Za-z0-9]+/g, 'dmk_[redacted]'],
  [/\bdkt_live_[A-Za-z0-9_]+/g, 'dkt_live_[redacted]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
  [/\b(gh[opsur]_|github_pat_)[A-Za-z0-9_]+/g, '$1[redacted]'],
  [/\bsk-or-[A-Za-z0-9-]+/g, 'sk-or-[redacted]'],
  // An OAuth or GitHub callback's query: the code, its verifier and state, a device's codes.
  [/([?&])(code|code_verifier|state|user_code|device_code)=[^&\s"'#]+/gi, '$1$2=[redacted]'],
  [/\b((?:access_|refresh_|id_)?token|client_secret|password|api_?key)=[^&\s"',;]+/gi, '$1=[redacted]'],
  [/("(?:access_token|refresh_token|id_token|device_code|client_secret|password|token)"\s*:\s*")[^"]*"/gi, '$1[redacted]"'],
  [/\b(postgres(?:ql)?|bolt|neo4j(?:\+s)?|https?):\/\/([^:/\s@]+):[^@\s/]+@/gi, '$1://$2:[redacted]@']
]

/** The text with every secret it holds replaced by `[redacted]`. */
export function redactSecrets(text: string): string {
  return SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
}
