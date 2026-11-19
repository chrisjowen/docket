import { EVIDENCE_LOCATION_FIELDS } from '../docket.js';
import { personSource } from '../../evidence/confidence.js';
import { findPerson } from '../../people/directory.js';
const LOCATION_FIELDS = EVIDENCE_LOCATION_FIELDS;
/** The order evidence fields are written in. */
const EVIDENCE_ORDER = ['source', 'sourceRef', 'attributes', ...LOCATION_FIELDS, 'locator', 'note', 'observedAt', 'observedBy', 'principal', 'session', 'reportedBy'];
/** An error that refuses a write, at the document and resource it is about. */
export const refuse = (code, message, where = {}) => ({
    severity: 'error',
    code,
    message,
    ...where
});
export const hasErrors = (diagnostics) => diagnostics.some((d) => d.severity === 'error');
/**
 * docket's diagnostics for a written document, unchanged.
 *
 * @deprecated docket's parser now accepts `reportedBy`, so there is no warning
 * about it left to drop. Kept for `@chrisjowen/docket-server`, which also
 * runs with docket 0.15.0.
 */
export function writeDiagnostics(diagnostics) {
    return [...diagnostics];
}
/** The stamping context of a workspace: its ontology's person source and its people directory. */
export const stampContext = (ontology, people) => ({
    person: ontology ? personSource(ontology) : undefined,
    ...(people ? { people } : {})
});
/**
 * Stamps a client's evidence: the writer observed it, for the person they act
 * for, in this request, now unless the client said when. Evidence that cites
 * no source is from that person - the ontology's person source - and legacy
 * `human` evidence is written as a person: the one it names when the people
 * directory has them, else the writer's own. Without a person source both
 * stay as given, and an entry with no source keeps none (`stampAll` refuses
 * it).
 */
export function stampEvidence(entry, writer, now, context = {}) {
    let source = entry.source ?? context.person;
    let sourceRef = entry.sourceRef;
    if (entry.source === 'human' && context.person !== undefined && context.person !== 'human') {
        source = context.person;
        const named = entry.observedBy !== undefined && context.people ? findPerson(context.people, entry.observedBy) : undefined;
        sourceRef ??= named;
    }
    const out = { source };
    if (sourceRef !== undefined)
        out.sourceRef = sourceRef;
    if (entry.attributes !== undefined && Object.keys(entry.attributes).length > 0)
        out.attributes = entry.attributes;
    for (const field of LOCATION_FIELDS) {
        const value = entry[field];
        if (value !== undefined)
            out[field] = value;
    }
    if (entry.locator !== undefined && Object.keys(entry.locator).length > 0)
        out.locator = entry.locator;
    if (entry.note !== undefined)
        out.note = entry.note;
    out.observedAt = entry.observedAt ?? now.toISOString();
    out.observedBy = writer.label;
    if (writer.principal !== undefined)
        out.principal = writer.principal;
    out.session = writer.requestId;
    if (entry.observedBy !== undefined && entry.observedBy !== writer.label)
        out.reportedBy = entry.observedBy;
    return out;
}
/**
 * Stamps every entry of a write (`stampEvidence`), and says what the write
 * needs to know: an entry with no source is refused when there is no one it
 * could be from - the ontology has no person source, or the writer acts for
 * no one - and one citing a person other than the writer's own asks that
 * person to confirm it, since until they do it counts as the writer's.
 */
export function stampAll(entries, writer, now, context, at) {
    const diagnostics = [];
    const stamped = [];
    const asked = new Set();
    const canonical = (name) => (context.people ? findPerson(context.people, name) : undefined) ?? name;
    for (const entry of entries) {
        if (entry.source === undefined && (context.person === undefined || writer.principal === undefined)) {
            diagnostics.push(refuse('missing-evidence-source', context.person === undefined
                ? `Evidence for ${at.subject} needs a source: this ontology has no person source to take it as said by you.`
                : `Evidence for ${at.subject} needs a source: this credential acts for no one, so evidence without one cannot be theirs.`, at.where));
            continue;
        }
        const one = stampEvidence(entry, writer, now, context);
        stamped.push(one);
        if (one.source !== context.person || one.sourceRef === undefined || writer.principal === undefined)
            continue;
        const named = canonical(one.sourceRef);
        if (named === canonical(writer.principal) || asked.has(named))
            continue;
        asked.add(named);
        diagnostics.push({
            severity: 'warning',
            code: 'confirm-requested',
            message: `Evidence for ${at.subject} citing ${named} counts as said by ${writer.principal} until ${named} confirms it: ` +
                `${named} confirms by adding evidence of their own (docket_add_evidence; no source needed).`,
            ...at.where
        });
    }
    return { stamped, diagnostics };
}
/**
 * What makes two entries the same observation, for idempotent writes: all of
 * an entry but when and in which session it was recorded. The same writer
 * sending the same evidence again adds nothing.
 */
export function evidenceKey(entry) {
    const keyed = {};
    for (const field of EVIDENCE_ORDER) {
        if (field === 'observedAt' || field === 'session')
            continue;
        if (entry[field] !== undefined)
            keyed[field] = entry[field];
    }
    return JSON.stringify(keyed);
}
/** An entry with its fields in the order evidence is written in, any others after. */
export function orderedEvidence(entry) {
    const out = {};
    for (const field of EVIDENCE_ORDER)
        if (entry[field] !== undefined)
            out[field] = entry[field];
    for (const [field, value] of Object.entries(entry))
        if (!(field in out))
            out[field] = value;
    return out;
}
/** A refusal when a write gives no evidence for `subject`; none when it gives some. */
export function evidenceProblems(evidence, subject, where) {
    return evidence.length === 0
        ? [refuse('missing-evidence', `Give at least one piece of evidence for ${subject}: where it was seen, as a source the ontology registers.`, where)]
        : [];
}
