// SPDX-License-Identifier: AGPL-3.0-only
import type { NamespacePermission, Role } from '@docket/platform-tenancy'

/** The scopes an API token or OAuth grant can carry (§8.4). */
export const SCOPES = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'] as const
export type Scope = (typeof SCOPES)[number]

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value)
}

/** What each scope allows, as the connect page and the consent screen word it. */
export const SCOPE_LABELS: Record<Scope, string> = {
  'docket:read': 'Search, read and ask about the knowledge in this workspace',
  'docket:write': 'Write knowledge, with evidence, and retire what it wrote',
  'ontology:read': "Read the workspace's ontology and its history",
  'ontology:propose': 'Propose ontology changes as drafts (never publish)',
  'ontology:write': 'Change the ontology directly: publish new versions and migrate documents, with no review',
}

const READ: readonly Scope[] = ['docket:read', 'ontology:read']
const WRITE: readonly Scope[] = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']

/**
 * The most a member's role lets any of their credentials do (§4, §8.4):
 * viewers read, editors and up also write and propose. `ontology:write`,
 * publishing the ontology over MCP, reaches only the roles the workspace's
 * owner enabled (`ontologyWriters`, the workspace's setting) - never a viewer.
 */
export function roleScopes(role: Role | null, ontologyWriters: readonly Role[] = []): readonly Scope[] {
  if (role === null) return []
  if (role === 'viewer') return READ
  return ontologyWriters.includes(role) ? SCOPES : WRITE
}

/**
 * The most a principal's credentials can do in one namespace (tenancy design
 * §4.2, §5.1): Read reads, Write and Admin also write and propose. No
 * permission there - no grant, or a provisioner, which reaches no content -
 * is nothing. `ontology:write` also needs the workspace's setting to name the
 * principal's org role, as `roleScopes` has it.
 */
export function namespaceScopes(
  access: { role: Role; permission: NamespacePermission | null } | null,
  ontologyWriters: readonly Role[] = [],
): readonly Scope[] {
  if (!access?.permission) return []
  if (access.permission === 'read') return READ
  return ontologyWriters.includes(access.role) ? SCOPES : WRITE
}

/** `docket:read` implies `ontology:read` (§8.4). */
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
