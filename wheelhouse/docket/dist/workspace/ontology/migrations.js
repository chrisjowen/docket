import { isMap, isSeq, parseDocument } from '../../vendor/yaml.js';
export const MIGRATION_OPS = ['renameType', 'renameRelationship', 'mapType', 'dropAttribute'];
/** The steps of a migration sent as JSON: its objects with an `op`; null when it is not a list. */
export function migrationSteps(value) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        return null;
    return value.filter((step) => typeof step === 'object' && step !== null && 'op' in step);
}
/** `renameType pod -> container`, `dropAttribute service.tier`: how a migration reads in evidence and history. */
export function describeMigration(step) {
    return step.op === 'dropAttribute' ? `dropAttribute ${step.type}.${step.from}` : `${step.op} ${step.from} -> ${step.to}`;
}
/** Why a migration cannot apply to the draft; empty when it can. */
export function migrationProblems(migration, draft) {
    const problems = [];
    for (const step of migration) {
        const what = describeMigration(step);
        if (!MIGRATION_OPS.includes(step.op)) {
            problems.push(`Unknown migration "${String(step.op)}".`);
            continue;
        }
        if (!step.from)
            problems.push(`${what}: say what it changes.`);
        switch (step.op) {
            case 'renameType':
            case 'mapType':
                if (!step.to || !(step.to in draft.resourceTypes))
                    problems.push(`${what}: the draft has no type "${step.to ?? ''}".`);
                if (step.op === 'renameType' && step.from in draft.resourceTypes) {
                    problems.push(`${what}: the draft still has type "${step.from}"; map it instead, or remove it.`);
                }
                break;
            case 'renameRelationship':
                if (!step.to || !(step.to in draft.relationships))
                    problems.push(`${what}: the draft has no relationship "${step.to ?? ''}".`);
                break;
            case 'dropAttribute':
                if (!step.type)
                    problems.push(`${what}: say which type the attribute is dropped from.`);
                else if (draft.resourceTypes[step.type]?.attributes?.[step.from]) {
                    problems.push(`${what}: the draft still declares it.`);
                }
                break;
        }
    }
    return problems;
}
const DELIMITER = /^---[ \t]*\r?$/;
/** Splits a docket file into its frontmatter text and the rest, delimiters kept with the rest. */
function split(raw) {
    const lines = raw.split('\n');
    if (!DELIMITER.test(lines[0] ?? ''))
        return null;
    const end = lines.findIndex((line, index) => index > 0 && DELIMITER.test(line));
    if (end < 0)
        return null;
    return { frontmatter: lines.slice(1, end).join('\n'), body: lines.slice(end).join('\n') };
}
function applyStep(doc, step) {
    switch (step.op) {
        case 'renameType':
        case 'mapType':
            if (doc.get('type') !== step.from || !step.to)
                return false;
            doc.set('type', step.to);
            return true;
        case 'renameRelationship': {
            const links = doc.get('links', true);
            if (!isSeq(links) || !step.to)
                return false;
            let changed = false;
            for (const link of links.items) {
                if (isMap(link) && link.get('rel') === step.from) {
                    link.set('rel', step.to);
                    changed = true;
                }
            }
            return changed;
        }
        case 'dropAttribute': {
            if (doc.get('type') !== step.type)
                return false;
            const attributes = doc.get('attributes', true);
            if (!isMap(attributes) || !attributes.has(step.from))
                return false;
            attributes.delete(step.from);
            return true;
        }
    }
}
/**
 * Rewrites one document's frontmatter for the migration, keeping its layout
 * and comments, and records the change as evidence from `evidence(applied)`.
 * Null when the migration does not touch the document.
 */
export function rewriteDocument(raw, migration, evidence) {
    const parts = split(raw);
    if (!parts)
        return null;
    const doc = parseDocument(parts.frontmatter);
    if (doc.errors.length || !isMap(doc.contents))
        return null;
    const applied = migration.filter((step) => applyStep(doc, step));
    if (!applied.length)
        return null;
    const added = evidence(applied);
    const existing = doc.get('evidence', true);
    if (isSeq(existing))
        existing.add(doc.createNode(added));
    else
        doc.set('evidence', doc.createNode([added]));
    return { raw: `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}${parts.body}`, applied, evidence: added };
}
