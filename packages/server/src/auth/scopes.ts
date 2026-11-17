import type { Role } from './roles.js'

/** The scopes an API token or OAuth grant can carry. */
export const SCOPES = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'] as const
export type Scope = (typeof SCOPES)[number]

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value)
}

/** What each scope allows, as a connect page or consent screen words it. */
export const SCOPE_LABELS: Record<Scope, string> = {
  'docket:read': 'Search, read and ask about the knowledge in this workspace',
  'docket:write': 'Write knowledge, with evidence, and retire what it wrote',
  'ontology:read': "Read the workspace's ontology and its history",
  'ontology:propose': 'Propose ontology changes as drafts (never publish)',
  'ontology:write': 'Change the ontology directly: publish new versions and migrate documents, with no review'
}

const READ: readonly Scope[] = ['docket:read', 'ontology:read']
const WRITE: readonly Scope[] = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']

/**
 * The most a member's role lets any of their credentials do: viewers read,
 * editors and up also write and propose. `ontology:write`, publishing the
 * ontology over MCP, reaches only the roles the workspace's owner enabled
 * (`ontologyWriters`, the workspace's setting) - never a viewer.
 */
export function roleScopes(role: Role | null, ontologyWriters: readonly Role[] = []): readonly Scope[] {
  if (role === null) return []
  if (role === 'viewer') return READ
  return ontologyWriters.includes(role) ? SCOPES : WRITE
}

/** `docket:read` implies `ontology:read`. */
export function impliedScopes(scopes: readonly Scope[]): Scope[] {
  const all = new Set(scopes)
  if (all.has('docket:read')) all.add('ontology:read')
  return SCOPES.filter((scope) => all.has(scope))
}

/** The scopes in a space-separated OAuth `scope` string that docket knows, in canonical order. */
export function parseScopeString(value: string | undefined | null): Scope[] {
  const asked = new Set((value ?? '').split(/\s+/).filter(Boolean))
  return SCOPES.filter((scope) => asked.has(scope))
}
