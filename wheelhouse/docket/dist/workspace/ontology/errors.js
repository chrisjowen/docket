/** The draft's text is not an ontology: YAML or schema errors, each at its path. */
export class OntologyInvalid extends Error {
    diagnostics;
    name = 'OntologyInvalid';
    constructor(diagnostics) {
        super(`the ontology is not valid: ${diagnostics.map((d) => d.message).join('; ')}`);
        this.diagnostics = diagnostics;
    }
}
/** Publishing N+1 needs its parent to be the current head: the draft must be rebased first. */
export class StaleDraft extends Error {
    expectedHead;
    head;
    name = 'StaleDraft';
    constructor(expectedHead, head) {
        super(`the draft was made against v${expectedHead}, but the head is now v${head}`);
        this.expectedHead = expectedHead;
        this.head = head;
    }
}
/** Resources would become `unknown-type` or `unknown-relationship`: blocked until a migration resolves them or each has a disposition. */
export class OntologyBreakingChange extends Error {
    check;
    name = 'OntologyBreakingChange';
    constructor(check) {
        const count = new Set(check.introduced.filter(isBreaking).map((d) => d.id ?? d.path)).size;
        super(`the change breaks ${count} resource(s); add a migration that resolves them, or give each a disposition`);
        this.check = check;
    }
}
/** Existing resources or links would gain diagnostics: an Admin must publish anyway. */
export class OntologyNarrowingChange extends Error {
    check;
    name = 'OntologyNarrowingChange';
    constructor(check) {
        super(`the change gives ${check.affected.length} resource(s) new diagnostics; publish anyway to accept them`);
        this.check = check;
    }
}
export class MigrationInvalid extends Error {
    problems;
    name = 'MigrationInvalid';
    constructor(problems) {
        super(problems.join(' '));
        this.problems = problems;
    }
}
/** The workspace's settings do not let this role change the ontology over MCP (any more). */
export class OntologyWriteDisabled extends Error {
    role;
    name = 'OntologyWriteDisabled';
    constructor(role) {
        super(`this workspace's settings do not let ${role ? `${role}s` : 'non-members'} change the ontology over MCP`);
        this.role = role;
    }
}
export class VersionNotFound extends Error {
    name = 'VersionNotFound';
}
/** The codes that make a change breaking: a resource or link the ontology no longer knows. */
export const BREAKING_CODES = new Set(['unknown-type', 'unknown-relationship']);
export const isBreaking = (diagnostic) => BREAKING_CODES.has(diagnostic.code);
