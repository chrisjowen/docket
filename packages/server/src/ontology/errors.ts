import type { Diagnostic } from '../docket.js'
import type { CheckResult } from './check.js'

/** The draft's text is not an ontology: YAML or schema errors, each at its path. */
export class OntologyInvalid extends Error {
  override name = 'OntologyInvalid'
  constructor(readonly diagnostics: Diagnostic[]) {
    super(`the ontology is not valid: ${diagnostics.map((d) => d.message).join('; ')}`)
  }
}

/** Publishing N+1 needs its parent to be the current head: the draft must be rebased first. */
export class StaleDraft extends Error {
  override name = 'StaleDraft'
  constructor(
    readonly expectedHead: number,
    readonly head: number
  ) {
    super(`the draft was made against v${expectedHead}, but the head is now v${head}`)
  }
}

/** Resources would become `unknown-type` or `unknown-relationship`: blocked until a migration resolves them or each has a disposition. */
export class OntologyBreakingChange extends Error {
  override name = 'OntologyBreakingChange'
  constructor(readonly check: CheckResult) {
    const count = new Set(check.introduced.filter(isBreaking).map((d) => d.id ?? d.path)).size
    super(`the change breaks ${count} resource(s); add a migration that resolves them, or give each a disposition`)
  }
}

/** Existing resources or links would gain diagnostics: an Admin must publish anyway. */
export class OntologyNarrowingChange extends Error {
  override name = 'OntologyNarrowingChange'
  constructor(readonly check: CheckResult) {
    super(`the change gives ${check.affected.length} resource(s) new diagnostics; publish anyway to accept them`)
  }
}

export class MigrationInvalid extends Error {
  override name = 'MigrationInvalid'
  constructor(readonly problems: string[]) {
    super(problems.join(' '))
  }
}

/** The workspace's settings do not let this role change the ontology over MCP (any more). */
export class OntologyWriteDisabled extends Error {
  override name = 'OntologyWriteDisabled'
  constructor(readonly role: string | null) {
    super(`this workspace's settings do not let ${role ? `${role}s` : 'non-members'} change the ontology over MCP`)
  }
}

export class VersionNotFound extends Error {
  override name = 'VersionNotFound'
}

/** The codes that make a change breaking: a resource or link the ontology no longer knows. */
export const BREAKING_CODES: ReadonlySet<string> = new Set(['unknown-type', 'unknown-relationship'])

export const isBreaking = (diagnostic: Diagnostic): boolean => BREAKING_CODES.has(diagnostic.code)
