import { parseMemoryFile, parseOntology, validateDocuments } from '../docket.js';
import { writableHere } from '../origin.js';
import { diffOntologies } from './diff.js';
import { MigrationInvalid, OntologyInvalid, isBreaking } from './errors.js';
import { describeMigration, migrationProblems, rewriteDocument } from './migrations.js';
import { lintOntology, sizeProblem } from './yaml-io.js';
export const DISPOSITIONS = ['update-in-repo', 'accept-data-loss'];
/**
 * Identifies a diagnostic across two ontologies: its code, file and resource,
 * and the rest of its message, which names the relationship and target or the
 * attribute. The list of what is allowed is left out, so a violation that was
 * already there is not reported again when only that list changed.
 */
export function diagnosticKey(diagnostic) {
    const subject = diagnostic.message.replace(/;\s*(allowed|known sources):.*$/s, '');
    return [diagnostic.code, diagnostic.path ?? '', diagnostic.id ?? '', subject].join('\u0000');
}
function multiset(diagnostics) {
    const counts = new Map();
    for (const d of diagnostics)
        counts.set(diagnosticKey(d), (counts.get(diagnosticKey(d)) ?? 0) + 1);
    return counts;
}
/** The diagnostics of `after` that `before` does not have, as many times as they are new. */
function minus(after, before) {
    const remaining = multiset(before);
    return after.filter((d) => {
        const key = diagnosticKey(d);
        const left = remaining.get(key) ?? 0;
        if (left > 0) {
            remaining.set(key, left - 1);
            return false;
        }
        return true;
    });
}
/** The breaking change a diagnostic reports, as `type pod` or `relationship runs_on`. */
export function breakingChange(diagnostic) {
    const name = /"([^"]*)"/.exec(diagnostic.message)?.[1] ?? '';
    return `${diagnostic.code === 'unknown-type' ? 'type' : 'relationship'} ${name}`;
}
/** The breaking change a migration step resolves; null for one that resolves none. */
function resolvedBy(step) {
    if (step.op === 'renameType' || step.op === 'mapType')
        return `type ${step.from}`;
    if (step.op === 'renameRelationship')
        return `relationship ${step.from}`;
    return null;
}
export function classify(introduced) {
    if (introduced.some(isBreaking))
        return 'breaking';
    return introduced.length ? 'narrowing' : 'safe';
}
/**
 * Validates documents against two ontologies with docket's validator and
 * diffs the diagnostics. `after` may hold other documents than `before`: a
 * migration's rewritten ones.
 */
export function compare(before, after, origins) {
    const was = before.ontology ? validateDocuments([...before.documents], before.ontology) : [];
    const now = validateDocuments([...after.documents], after.ontology);
    const introduced = minus(now, was);
    const resolved = minus(was, now);
    const seen = new Set();
    const affected = [];
    for (const d of introduced) {
        const resourceId = d.id ?? d.path ?? '';
        const origin = (d.path && origins.get(d.path)) || 'cloud';
        const key = `${resourceId}\u0000${origin}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        affected.push({ resourceId, origin });
    }
    affected.sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0));
    return { classification: classify(introduced), introduced, resolved, affected };
}
/** Parses a draft, or throws `OntologyInvalid` with its errors at their paths. */
export function parseDraft(yaml) {
    const tooLarge = sizeProblem(yaml);
    if (tooLarge)
        throw new OntologyInvalid([tooLarge]);
    const loaded = parseOntology(yaml);
    if (!loaded.ontology)
        throw new OntologyInvalid(loaded.diagnostics);
    return { ontology: loaded.ontology, diagnostics: [...loaded.diagnostics, ...lintOntology(loaded.ontology)] };
}
/**
 * Checks an ontology against the workspace as publishing it would: with the
 * migration's rewrites of cloud documents applied first. `stored` is the
 * workspace's documents with their text, which only a migration reads. Repo
 * and CLI documents are never rewritten here: every resource a breaking
 * change still leaves unknown is `unresolved`, and is `updatable` when it is
 * a repo or CLI document and a step names each of its changes. Throws
 * `MigrationInvalid` for a migration that names what the draft does not have.
 */
export function evaluateDraft(snapshot, stored, draft, options = {}) {
    const headOntology = snapshot.head?.ontology ?? null;
    const before = { documents: snapshot.documents, ontology: headOntology };
    const migration = options.migration ?? [];
    const version = options.version ?? (snapshot.head?.number ?? 0) + 1;
    const rewrites = [];
    let after = snapshot.documents;
    if (migration.length) {
        const problems = migrationProblems(migration, draft);
        if (problems.length)
            throw new MigrationInvalid(problems);
        const migrated = new Map();
        for (const document of stored) {
            if (document.raw === undefined || !writableHere(document.origin))
                continue;
            const next = rewriteDocument(document.raw, migration, (applied) => ({
                source: 'human',
                observedBy: options.login ?? 'publisher',
                note: `ontology v${version} migration: ${applied.map(describeMigration).join(', ')}`
            }));
            const parsed = next && parseMemoryFile(next.raw, document.path).document;
            if (!next || !parsed)
                continue;
            migrated.set(document.path, parsed);
            rewrites.push({ path: document.path, raw: next.raw, resourceId: parsed.id, evidence: next.evidence });
        }
        after = snapshot.documents.map((document) => migrated.get(document.path) ?? document);
    }
    const check = compare(before, { documents: after, ontology: draft }, snapshot.origins);
    const named = new Set(migration.map(resolvedBy));
    const byResource = new Map();
    for (const d of check.introduced) {
        if (!isBreaking(d))
            continue;
        const resourceId = d.id ?? d.path ?? '';
        const origin = (d.path && snapshot.origins.get(d.path)) || 'cloud';
        const entry = byResource.get(resourceId) ?? { resourceId, origin, changes: [], updatable: !writableHere(origin) };
        const change = breakingChange(d);
        if (!entry.changes.includes(change))
            entry.changes.push(change);
        entry.updatable &&= named.has(change);
        byResource.set(resourceId, entry);
    }
    const unresolved = [...byResource.values()].sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0));
    return { check, rewrites, unresolved, head: snapshot.head, documents: snapshot.documents.length };
}
/**
 * Re-validates every document of the workspace against the draft and diffs
 * the diagnostics with the published head's, with the migration's rewrites
 * applied when there is one. Throws `OntologyInvalid` when the draft is not
 * an ontology, and `MigrationInvalid` for a migration that names what the
 * draft does not have.
 */
export function checkDraft(snapshot, stored, draftYaml, options = {}) {
    const draft = parseDraft(draftYaml);
    const result = evaluateDraft(snapshot, stored, draft.ontology, options);
    return {
        ...result.check,
        head: result.head?.number ?? 0,
        documents: result.documents,
        ontology: draft.diagnostics,
        changes: diffOntologies(result.head?.ontology ?? null, draft.ontology),
        migrated: result.rewrites.map((rewrite) => rewrite.path),
        unresolved: result.unresolved
    };
}
