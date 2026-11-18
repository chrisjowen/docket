import { randomUUID } from 'node:crypto';
import { parseMemoryFile } from '../../source/parser.js';
import { validateDocuments } from '../../ontology/validator.js';
import { DocumentError, checkDocument } from '../../workspace/documents.js';
import { dayOf } from '../../workspace/supersession.js';
import { appendedNotes, composeDocument, sameMeaning } from '../../workspace/write/document.js';
import { evidenceProblems, hasErrors, refuse, stampEvidence, writeDiagnostics } from '../../workspace/write/evidence.js';
import { WRITE_LIMITS } from '../../workspace/write/inputs.js';
import { absolute, declaring, documentPathOf, freeDocumentPath, readSupersessions, removeFile, writeSupersessions, writeText } from './files.js';
/** The document a write to `resource` changes: the one at its own path, else the first that declares it. */
const ownOf = (workspace, existing, resource) => existing.find((entry) => entry.path === documentPathOf(workspace, resource)) ?? existing[0] ?? null;
const tooMuchEvidence = (where) => refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, where);
/** Validates and writes one change to a resource's document. A refusal or a dry run writes nothing. */
async function applyChange(workspace, input, options) {
    const { change, own } = input;
    const base = { created: input.existing.length === 0, changed: false, evidenceAdded: 0 };
    const refused = (diagnostics) => ({ ...base, diagnostics });
    const path = own?.path ?? (await freeDocumentPath(workspace, change));
    const where = { path: path ?? documentPathOf(workspace, change), id: change.id };
    if (hasErrors(input.early))
        return refused(input.early);
    if (path === null)
        return refused([refuse('invalid-path', `No free path for a document of ${change.id} beside ${where.path}.`, where)]);
    const ontology = workspace.ontology?.ontology;
    if (!ontology)
        return refused([refuse('no-ontology', 'This docket has no ontology to check the write against: `docket validate` says why.', where)]);
    const fallbackTitle = input.existing[0]?.document.title ?? change.id;
    const merged = composeDocument(own?.raw ?? null, change, fallbackTitle);
    if (!merged)
        return refused([refuse('unreadable-document', `The document at ${path} has frontmatter this write cannot update.`, where)]);
    // A write that says nothing new keeps the document's text as it is, rather than re-rendering its layout.
    if (own?.raw !== undefined && sameMeaning(own.raw, merged.raw, path))
        merged.raw = own.raw;
    let parsed;
    try {
        parsed = checkDocument(path, merged.raw);
    }
    catch (caught) {
        if (!(caught instanceof DocumentError))
            throw caught;
        const errors = writeDiagnostics(caught.diagnostics).filter((d) => d.severity === 'error');
        return refused(errors.length ? errors : [refuse(caught.code === 'too-large' ? 'document-too-large' : 'invalid-document', caught.message, where)]);
    }
    const parseWarnings = writeDiagnostics(parseMemoryFile(merged.raw, path).diagnostics);
    if (parsed.links.length > WRITE_LIMITS.linksPerResource) {
        return refused([refuse('too-many-links', `A resource holds at most ${WRITE_LIMITS.linksPerResource} links in one document.`, where)]);
    }
    const wanted = new Set(parsed.links.map((link) => link.target));
    wanted.delete(change.id);
    const targets = workspace.documents.flatMap((entry) => (entry.document && wanted.has(entry.document.id) ? [entry.document] : []));
    const validated = validateDocuments([parsed, ...targets], ontology).filter((d) => d.path === path);
    const diagnostics = [...input.early, ...parseWarnings, ...validated];
    if (hasErrors(diagnostics))
        return refused(diagnostics);
    if (options.dryRun)
        return { ...base, path, diagnostics, evidenceAdded: merged.added };
    const changed = own?.raw !== merged.raw;
    if (changed)
        await writeText(absolute(workspace.resolved, path), merged.raw);
    return { ...base, path, changed, diagnostics, evidenceAdded: changed ? merged.added : 0 };
}
/**
 * `docket_remember`: upserts one resource with its links. A new resource
 * needs at least one evidence entry of its own, each link the resource does
 * not have yet needs its own, and any write carries some. Validator errors
 * refuse the write, warnings come back with it. Repeating a write adds
 * nothing.
 */
export async function writeResource(workspace, writer, input, options = {}) {
    const now = (options.now ?? (() => new Date()))();
    const existing = declaring(workspace, input.id);
    const own = ownOf(workspace, existing, input);
    const where = { path: own?.path ?? documentPathOf(workspace, input), id: input.id };
    const early = [];
    const links = input.links ?? [];
    const evidenceCount = input.evidence.length + links.reduce((sum, link) => sum + link.evidence.length, 0);
    if (evidenceCount > WRITE_LIMITS.evidencePerCall)
        early.push(tooMuchEvidence(where));
    // A new resource needs its own evidence; any write needs some, on the resource or a link.
    if (!existing.length)
        early.push(...evidenceProblems(input.evidence, input.id, where));
    else if (evidenceCount === 0)
        early.push(...evidenceProblems([], `what this write says about ${input.id}`, where));
    const other = existing.find((entry) => entry.document.type !== input.type);
    if (other)
        early.push(refuse('type-conflict', `${input.id} is a ${other.document.type} in ${other.path}: write it as that type, or change it there.`, where));
    const known = new Set(existing.flatMap((entry) => entry.document.links.map((link) => `${link.rel}\u0000${link.target}`)));
    for (const link of links) {
        if (known.has(`${link.rel}\u0000${link.target}`))
            continue;
        early.push(...evidenceProblems(link.evidence, `the new link ${link.rel} -> ${link.target}`, where));
    }
    const stamp = (entries) => entries.map((entry) => stampEvidence(entry, writer, now));
    const change = {
        id: input.id,
        type: input.type,
        title: input.title,
        ...(input.attributes ? { attributes: input.attributes } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        evidence: stamp(input.evidence),
        links: links.map((link) => ({ rel: link.rel, target: link.target, ...(link.attributes ? { attributes: link.attributes } : {}), evidence: stamp(link.evidence) }))
    };
    return applyChange(workspace, { change, existing, own, early }, options);
}
/** `docket_update_notes`: appends dated notes to the body of the resource's document, with evidence. */
export async function appendNotes(workspace, writer, input, options = {}) {
    const now = (options.now ?? (() => new Date()))();
    const existing = declaring(workspace, input.id);
    const type = existing[0]?.document.type ?? 'resource';
    const own = ownOf(workspace, existing, { id: input.id, type });
    const where = { path: own?.path ?? documentPathOf(workspace, { id: input.id, type }), id: input.id };
    const early = [];
    if (!existing.length)
        early.push(refuse('unknown-resource', `There is no resource ${input.id} in this docket: write it with docket_remember first.`, where));
    if (!input.additionalNotes.trim())
        early.push(refuse('missing-notes', 'Give non-empty narrative notes to append.', where));
    if (input.additionalNotes.length > 60000)
        early.push(refuse('notes-too-long', 'Additional notes are at most 60000 characters.', where));
    early.push(...evidenceProblems(input.evidence, `the new notes for ${input.id}`, where));
    if (input.evidence.length > WRITE_LIMITS.evidencePerCall)
        early.push(tooMuchEvidence(where));
    const change = {
        id: input.id,
        type,
        body: appendedNotes(own?.raw, input.additionalNotes, now),
        evidence: input.evidence.map((entry) => stampEvidence(entry, writer, now)),
        links: []
    };
    return applyChange(workspace, { change, existing, own, early }, options);
}
/** `docket_add_evidence`: appends evidence to a resource or one of its links. Evidence is append-only. */
export async function addEvidence(workspace, writer, input, options = {}) {
    const now = (options.now ?? (() => new Date()))();
    const existing = declaring(workspace, input.id);
    const type = existing[0]?.document.type ?? 'resource';
    const own = ownOf(workspace, existing, { id: input.id, type });
    const where = { path: own?.path ?? documentPathOf(workspace, { id: input.id, type }), id: input.id };
    const early = [];
    if (!existing.length)
        early.push(refuse('unknown-resource', `There is no resource ${input.id} in this docket: write it with docket_remember first.`, where));
    if (input.evidence.length > WRITE_LIMITS.evidencePerCall)
        early.push(tooMuchEvidence(where));
    const subject = input.link ? `the link ${input.link.rel} -> ${input.link.target}` : input.id;
    early.push(...evidenceProblems(input.evidence, subject, where));
    if (input.link && existing.length) {
        const { rel, target } = input.link;
        const has = existing.some((entry) => entry.document.links.some((link) => link.rel === rel && link.target === target));
        if (!has)
            early.push(refuse('unknown-link', `${input.id} has no link ${rel} -> ${target}: add it with docket_remember, with its evidence.`, where));
    }
    const stamped = hasErrors(early) ? [] : input.evidence.map((entry) => stampEvidence(entry, writer, now));
    const change = {
        id: input.id,
        type,
        evidence: input.link ? [] : stamped,
        links: input.link ? [{ rel: input.link.rel, target: input.link.target, evidence: stamped }] : []
    };
    return applyChange(workspace, { change, existing, own, early }, options);
}
/**
 * `docket_retire`: removes the documents that declare a resource, with a
 * required reason. They are the project's own files, so git keeps their
 * history; nothing else declares the resource.
 */
export async function retireResource(workspace, input) {
    const existing = declaring(workspace, input.id);
    const reason = input.reason.trim();
    const diagnostics = [];
    if (!reason)
        diagnostics.push(refuse('missing-reason', 'Say why the resource is retired.', { id: input.id }));
    else if (reason.length > WRITE_LIMITS.reasonLength)
        diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, { id: input.id }));
    if (!existing.length)
        diagnostics.push(refuse('unknown-resource', `There is no resource ${input.id} in this docket.`, { id: input.id }));
    if (hasErrors(diagnostics))
        return { retired: [], remaining: [], diagnostics };
    for (const entry of existing)
        await removeFile(absolute(workspace.resolved, entry.path));
    return { retired: existing.map((entry) => ({ path: entry.path })), remaining: [], diagnostics };
}
/** A date an agent gives, or why it will not do. Never later than now: a record cannot stop holding in the future. */
function untilOf(given, now, id) {
    if (given === undefined)
        return now;
    const at = /^\d{4}-\d{2}-\d{2}$/.test(given) ? new Date(`${given}T00:00:00.000Z`) : new Date(given);
    if (Number.isNaN(at.getTime()))
        return refuse('invalid-date', `validUntil must be a date (YYYY-MM-DD) or an ISO timestamp, not "${given}".`, { id });
    if (at.getTime() > now.getTime() + 60_000)
        return refuse('future-date', 'validUntil cannot be in the future: say when the record stopped holding.', { id });
    return at;
}
/**
 * `docket_supersede`: marks a record superseded by another, with why and the
 * evidence. Both must be declared and different, and the replacement current
 * itself. A record already superseded by the same replacement is left as it
 * is; one superseded by another is re-pointed, the earlier supersession kept,
 * lifted. The documents are untouched.
 */
export async function supersedeResource(workspace, writer, input, options = {}) {
    const now = (options.now ?? (() => new Date()))();
    const id = input.id.trim();
    const by = input.by.trim();
    const reason = input.reason.trim();
    const diagnostics = [];
    if (!id || !by)
        diagnostics.push(refuse('missing-resource', 'Give the record that went out of date (id) and the one that replaces it (by).', { id }));
    else if (id === by)
        diagnostics.push(refuse('same-resource', 'A record cannot supersede itself: name the record that replaces it.', { id }));
    if (!reason)
        diagnostics.push(refuse('missing-reason', 'Say why the record is out of date.', { id }));
    else if (reason.length > WRITE_LIMITS.reasonLength)
        diagnostics.push(refuse('reason-too-long', `A reason is at most ${WRITE_LIMITS.reasonLength} characters.`, { id }));
    if (input.evidence.length === 0)
        diagnostics.push(refuse('missing-evidence', 'Give at least one piece of evidence that the record changed: where the newer fact was seen.', { id }));
    else if (input.evidence.length > WRITE_LIMITS.evidencePerCall)
        diagnostics.push(refuse('too-much-evidence', `A write carries at most ${WRITE_LIMITS.evidencePerCall} evidence entries.`, { id }));
    const until = untilOf(input.validUntil, now, id);
    if (!(until instanceof Date))
        diagnostics.push(until);
    const records = await readSupersessions(workspace);
    let live;
    if (id && by && id !== by) {
        for (const each of [id, by])
            if (!declaring(workspace, each).length)
                diagnostics.push(refuse('unknown-resource', `There is no resource ${each} in this docket.`, { id: each }));
        live = records.find((record) => record.resource === id && record.liftedAt === undefined);
        const replacement = records.find((record) => record.resource === by && record.liftedAt === undefined);
        if (replacement) {
            diagnostics.push(refuse('replacement-superseded', `${by} is itself out of date: it was superseded by ${replacement.supersededBy} on ${dayOf(replacement.validUntil)}. Supersede ${id} with the current record.`, { id: by }));
        }
    }
    if (hasErrors(diagnostics))
        return { changed: false, diagnostics };
    if (live?.supersededBy === by)
        return { supersession: live, changed: false, diagnostics };
    if (live) {
        diagnostics.push({
            severity: 'warning',
            code: 'repointed',
            message: `${id} was superseded by ${live.supersededBy}; it now points to ${by}, and the earlier supersession stays in its history.`,
            id
        });
        live.liftedAt = now.toISOString();
    }
    const supersession = {
        id: randomUUID(),
        resource: id,
        supersededBy: by,
        validUntil: until.toISOString(),
        source: 'agent',
        recordedBy: writer.label,
        recordedAt: now.toISOString(),
        reason,
        evidence: input.evidence.map((entry) => stampEvidence(entry, writer, now))
    };
    await writeSupersessions(workspace, [...records, supersession]);
    return { supersession, changed: true, ...(live ? { replaced: live.supersededBy } : {}), diagnostics };
}
