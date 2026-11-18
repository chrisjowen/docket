import { MigrationInvalid, OntologyBreakingChange, OntologyInvalid, OntologyNarrowingChange, OntologyWriteDisabled, StaleDraft, isBreaking } from '../../workspace/ontology/errors.js';
import { describeMigration } from '../../workspace/ontology/migrations.js';
import { changeNote, dayOf } from '../../workspace/supersession.js';
import { searchText } from '../search.js';
import { ONTOLOGY_SCHEMA, PROPOSAL_SCHEMA, PUBLISH_SCHEMA, RESOURCE_SCHEMA, UNTRUSTED_NOTE, annotatedSearchText, failed } from './results.js';
import { WRITE_SCHEMA } from './write-args.js';
const brief = (diagnostics) => diagnostics.map(({ severity, code, message }) => ({ severity, code, message }));
/** A resource's page in the host's graph browser, or null where there is none. */
export const viewerOf = (viewer, id) => (viewer === null ? null : `${viewer}#${encodeURIComponent(id)}`);
/**
 * `docket_search`'s answer. `behind` replaces the advice for an index behind
 * the files, where the host keeps the index itself.
 */
export function searchAnswer(found, options = {}) {
    let text = annotatedSearchText(found, searchText(found)).replace(/Read the canonical files above for the full record\.$/, 'Call docket_get with an id for its full record.');
    if (options.behind)
        text = text.replace(/: run `docket sync`\./, `: ${options.behind}`);
    return { content: [{ type: 'text', text: `${UNTRUSTED_NOTE}\n\n${text}` }], structuredContent: found };
}
const isoOf = (at) => (typeof at === 'string' ? at : at.toISOString());
/** `docket_get`'s answer. */
export function resourceAnswer(read) {
    const { id, entity, summary, documents, history, superseded, supersedes } = read;
    const diagnostics = brief(read.diagnostics);
    const structured = {
        schema: RESOURCE_SCHEMA,
        id,
        viewer: viewerOf(read.viewer, id),
        resource: entity
            ? {
                type: entity.type,
                title: entity.title,
                tags: entity.tags,
                attributes: entity.attributes,
                body: entity.content,
                ...(summary ? { summary } : {}),
                confidence: entity.confidence,
                basis: entity.basis,
                evidenceCount: entity.evidenceCount,
                evidence: entity.evidence,
                links: entity.links.map((link) => ({
                    rel: link.rel,
                    target: link.target,
                    ...(link.attributes ? { attributes: link.attributes } : {}),
                    confidence: link.confidence,
                    basis: link.basis,
                    evidence: link.evidence
                })),
                ...(entity.provenance ? { provenance: entity.provenance } : {})
            }
            : null,
        ...(superseded
            ? {
                superseded: {
                    by: superseded.own.supersededBy,
                    current: superseded.current?.id ?? null,
                    validUntil: isoOf(superseded.own.validUntil),
                    reason: superseded.own.reason,
                    source: superseded.own.source,
                    recordedBy: superseded.own.recordedBy,
                    evidence: superseded.own.evidence
                }
            }
            : {}),
        ...(supersedes.length ? { supersedes: supersedes.map((each) => ({ id: each.id, validUntil: isoOf(each.validUntil), reason: each.reason })) } : {}),
        documents,
        history,
        diagnostics
    };
    const lines = [UNTRUSTED_NOTE, ''];
    if (superseded) {
        lines.push(changeNote({ id, title: entity?.title ?? id }, superseded.current, superseded.own), 'It is kept on file for its history; do not present it as current.', '');
    }
    if (supersedes.length) {
        lines.push(`Current record: it supersedes ${supersedes.map((each) => `${each.id} (since ${dayOf(each.validUntil)})`).join(', ')}.`, '');
    }
    if (entity) {
        lines.push(`${entity.id} (${entity.type}) "${entity.title}": confidence ${entity.confidence} (${entity.basis}, ${entity.evidenceCount} evidence)`);
        lines.push(`Declared in: ${documents.map((document) => `${document.path} (${document.origin}${document.revision === undefined ? '' : `, revision ${document.revision}`})`).join('; ')}`);
        if (Object.keys(entity.attributes).length > 0)
            lines.push(`Attributes: ${JSON.stringify(entity.attributes)}`);
        if (entity.links.length > 0) {
            lines.push('', 'Links:');
            for (const link of entity.links)
                lines.push(`- ${link.rel} -> ${link.target} (confidence ${link.confidence})`);
        }
        if (entity.evidence.length > 0) {
            lines.push('', 'Evidence:');
            for (const evidence of entity.evidence)
                lines.push(evidenceLine(evidence));
        }
        if (summary)
            lines.push('', 'Summary:', summary);
        if (entity.content.trim())
            lines.push('', 'Body:', entity.content.trim());
    }
    else {
        lines.push(`${id} is declared in ${documents.map((document) => document.path).join(', ')}, but its documents do not validate:`);
        for (const diagnostic of diagnostics)
            lines.push(`- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
    lines.push('', read.historyNote ?? `${history.length} ${history.length === 1 ? 'revision' : 'revisions'} on record.`);
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: structured };
}
/** Who saw a piece of evidence and where, as one short line. */
function evidenceLine(evidence) {
    const where = [evidence.repository, evidence.path, evidence.lines ? `L${evidence.lines}` : null, evidence.symbol, evidence.endpoint, evidence.key, ...(evidence.urls ?? [])]
        .filter(Boolean)
        .join(' ');
    const who = [evidence.observedBy ? `observed by ${evidence.observedBy}` : null, evidence.observedAt ? `at ${evidence.observedAt}` : null].filter(Boolean).join(' ');
    return `- ${evidence.source}${where ? `: ${where}` : ''}${who ? ` (${who})` : ''}${evidence.note ? ` - ${evidence.note.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
}
/** `docket_ontology`'s answer. `where` says whose ontology it is, as the text names it. */
export function ontologyAnswer(head, where = 'this workspace') {
    const structured = {
        schema: ONTOLOGY_SCHEMA,
        version: head.version,
        revision: head.revision,
        publishedAt: isoOf(head.publishedAt),
        message: head.message,
        ontology: head.ontology,
        yaml: head.yaml
    };
    const text = `The published ontology of ${where}, version ${head.version} (${head.revision}):\n\n${head.yaml}`;
    return { content: [{ type: 'text', text }], structuredContent: structured };
}
/** `docket_retire`'s answer, from what the store retired and what still declares the resource. */
export function retireAnswer(id, result) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    const lines = errors.length
        ? ['Refused: nothing was retired.', ...errors.map((d) => `- ${d.code}: ${d.message}`)]
        : [`Retired ${id}: ${result.retired.map((document) => document.path).join(', ')}. It leaves search at the next index update.`];
    if (warnings.length)
        lines.push('', ...warnings.map((d) => `- ${d.code}: ${d.message}`));
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
            schema: WRITE_SCHEMA,
            tool: 'docket_retire',
            id,
            ok: errors.length === 0,
            retired: result.retired.map(({ path, revision }) => ({ path, ...(revision !== undefined ? { revision } : {}) })),
            remaining: result.remaining,
            diagnostics: brief(result.diagnostics)
        },
        ...(errors.length ? { isError: true } : {})
    };
}
/** `docket_supersede`'s answer. */
export function supersedeAnswer(input, viewer, result) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    const held = result.supersession;
    const lines = errors.length
        ? ['Refused: nothing was superseded. Fix these and call docket_supersede again:', ...errors.map((d) => `- ${d.code}: ${d.message}`)]
        : !result.changed
            ? [`Nothing new: ${input.id} is already superseded by ${input.by}.`]
            : [
                `${input.id} is now superseded by ${input.by} since ${held ? dayOf(held.validUntil) : 'now'}. It stays on file with its history; ` +
                    'search answers with the replacement and a note of the change.'
            ];
    if (warnings.length)
        lines.push('', ...warnings.map((d) => `- ${d.code}: ${d.message}`));
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
            schema: WRITE_SCHEMA,
            tool: 'docket_supersede',
            id: input.id,
            ok: errors.length === 0,
            changed: result.changed,
            ...(held ? { supersededBy: held.supersededBy, validUntil: isoOf(held.validUntil) } : {}),
            ...(result.replaced ? { replaced: result.replaced } : {}),
            viewer: viewerOf(viewer, input.id),
            diagnostics: brief(result.diagnostics)
        },
        ...(errors.length ? { isError: true } : {})
    };
}
/** Why a proposal is not an ontology, for the model to read; no draft was made. */
export function proposalRefusal(caught) {
    if (!(caught instanceof OntologyInvalid))
        return null;
    return failed(`The proposal is not a valid ontology; no draft was made:\n${caught.diagnostics.map((d) => `- ${d.code}: ${d.message}`).join('\n')}`);
}
/** `docket_propose_ontology_change`'s answer. `next` says what happens to the draft now. */
export function proposalAnswer(draftId, check, next) {
    const lines = [`Draft ${draftId} made against v${check.head}: ${check.classification}.`, `${check.changes.length} change(s); checked against ${check.documents} document(s).`];
    if (check.introduced.length) {
        lines.push('', 'It would give existing documents these diagnostics:', ...check.introduced.slice(0, 20).map((d) => `- ${d.code} ${d.id ?? d.path ?? ''}: ${d.message}`));
    }
    lines.push('', next);
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
            schema: PROPOSAL_SCHEMA,
            draftId,
            head: check.head,
            classification: check.classification,
            changes: check.changes,
            introduced: check.introduced.map(({ severity, code, message, id, path }) => ({ severity, code, message, ...(id ? { id } : {}), ...(path ? { path } : {}) })),
            affected: check.affected,
            unresolved: check.unresolved,
            ontology: brief(check.ontology)
        }
    };
}
/** Why a publish was refused, for the model to read; nothing was published. Null for an error that is not a refusal. */
export function publishRefusal(caught) {
    if (caught instanceof OntologyInvalid) {
        return failed(`The change is not a valid ontology; nothing was published:\n${caught.diagnostics.map((d) => `- ${d.code}: ${d.message}`).join('\n')}`);
    }
    if (caught instanceof OntologyWriteDisabled)
        return failed(`Nothing was published: ${caught.message}. Propose the change with docket_propose_ontology_change instead.`);
    if (caught instanceof StaleDraft)
        return failed(`Nothing was published: ${caught.message}. Read the ontology again with docket_ontology and make the change against it.`);
    if (caught instanceof MigrationInvalid)
        return failed(`Nothing was published: the migration cannot apply. ${caught.message}`);
    if (caught instanceof OntologyBreakingChange) {
        const broken = caught.check.introduced.filter(isBreaking).slice(0, 20);
        return failed([
            `Nothing was published: ${caught.message}.`,
            'Resolve each with a migration step (renameType, mapType, renameRelationship), or give it a disposition (accept-data-loss, or update-in-repo for a repo document a step covers):',
            ...broken.map((d) => `- ${d.id ?? d.path ?? ''}: ${d.message}`)
        ].join('\n'));
    }
    if (caught instanceof OntologyNarrowingChange) {
        return failed([`Nothing was published: ${caught.message} (acceptNarrowing: true).`, ...caught.check.introduced.slice(0, 20).map((d) => `- ${d.code} ${d.id ?? d.path ?? ''}: ${d.message}`)].join('\n'));
    }
    return null;
}
/** `docket_publish_ontology_change`'s answer. `history` is where the version is recorded, and `rollback` how it reads. */
export function publishAnswer(published, history, rollback) {
    const lines = [
        `Published v${published.version}${published.previous ? ` (was v${published.previous})` : ''}: ${published.classification}.`,
        published.rewritten.length ? `The migration rewrote ${published.rewritten.length} document(s).` : 'No documents were rewritten.',
        ...(published.migration.length ? [`Migration: ${published.migration.map(describeMigration).join(', ')}.`] : []),
        rollback
    ];
    return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
            schema: PUBLISH_SCHEMA,
            version: published.version,
            previous: published.previous,
            classification: published.classification,
            rewritten: published.rewritten.map(({ resourceId, path, revision }) => ({ resourceId, path, ...(revision !== undefined ? { revision } : {}) })),
            migration: published.migration,
            dispositions: published.dispositions,
            history
        }
    };
}
