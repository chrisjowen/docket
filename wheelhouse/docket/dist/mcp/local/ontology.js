import { randomUUID } from 'node:crypto';
import { hashContent } from '../../source/hashing.js';
import { checkDraft, evaluateDraft, needsAcceptance, parseDraft } from '../../workspace/ontology/check.js';
import { OntologyBreakingChange, OntologyNarrowingChange, StaleDraft } from '../../workspace/ontology/errors.js';
import { proposedText } from '../../workspace/ontology/propose.js';
import { importYaml } from '../../workspace/ontology/yaml-io.js';
import { absolute, draftPath, headOf, readHistory, snapshotOf, writeHistory, writeText } from './files.js';
/*
 * The ontology's lifecycle over a project's files, through the same change
 * check a server publishes through: a proposal is a draft file beside the
 * ontology, checked against every document; a publish rewrites the ontology
 * file - and, with a migration, the documents it names - and records the
 * version.
 */
/** A draft made from the text, or `OntologyInvalid` with its errors. */
function draftText(text) {
    const { yaml } = importYaml(text);
    parseDraft(yaml);
    return yaml;
}
/**
 * `docket_propose_ontology_change`: saves the proposal as a draft beside the
 * ontology and checks it against every document. It never publishes.
 */
export async function proposeOntologyChange(workspace, writer, proposal) {
    const head = await headOf(workspace);
    const yaml = draftText(proposedText(head?.text ?? null, proposal));
    const check = checkDraft(snapshotOf(workspace, head), [], yaml);
    const draftId = randomUUID();
    const path = draftPath(workspace, draftId);
    const message = proposal.message?.trim() || `Proposed by ${writer.label}`;
    const header = [`Draft ${draftId}, against v${check.head}: ${check.classification}.`, ...message.split('\n')].map((line) => `# ${line}`).join('\n');
    await writeText(absolute(workspace.resolved, path), `${header}\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}`);
    return { draftId, path, check };
}
/**
 * `docket_publish_ontology_change`: publishes a proposal as the next version
 * through the same check as a server's publish - the head must still be
 * `expectedHead`, every document is re-validated, every resource a breaking
 * change leaves unknown after the migration needs a disposition, and a change
 * that gives resources new diagnostics needs `acceptNarrowing` - then writes
 * the migration's rewrites, the ontology file and the version's record.
 */
export async function publishOntologyChange(workspace, writer, change, options = {}) {
    const now = (options.now ?? (() => new Date()))();
    const head = await headOf(workspace);
    const current = head?.version ?? 0;
    if (change.expectedHead !== undefined && change.expectedHead !== current)
        throw new StaleDraft(change.expectedHead, current);
    const yaml = draftText(proposedText(head?.text ?? null, change));
    const { ontology } = parseDraft(yaml);
    const migration = change.migration ?? [];
    const version = current + 1;
    const stored = migration.length
        ? workspace.documents.flatMap((entry) => (entry.raw === undefined ? [] : [{ path: entry.path, origin: 'local', raw: entry.raw }]))
        : [];
    const { check, rewrites, unresolved } = evaluateDraft(snapshotOf(workspace, head), stored, ontology, { migration, version, login: writer.label });
    const disposed = [];
    for (const resource of unresolved) {
        const disposition = change.dispositions?.[resource.resourceId];
        if (disposition !== 'accept-data-loss' && !(disposition === 'update-in-repo' && resource.updatable))
            throw new OntologyBreakingChange(check);
        disposed.push({ ...resource, disposition });
    }
    if (needsAcceptance(check.classification) && !change.acceptNarrowing)
        throw new OntologyNarrowingChange(check);
    for (const rewrite of rewrites)
        await writeText(absolute(workspace.resolved, rewrite.path), rewrite.raw);
    await writeText(workspace.resolved.ontologyPath, yaml);
    const dispositions = disposed.map(({ resourceId, disposition }) => ({ resourceId, disposition }));
    await writeHistory(workspace, [
        ...(await readHistory(workspace)),
        {
            version,
            revision: hashContent(yaml),
            publishedAt: now.toISOString(),
            publishedBy: writer.label,
            message: change.message?.trim() || `Published by ${writer.label}`,
            classification: check.classification,
            ...(migration.length ? { migration } : {}),
            ...(dispositions.length ? { dispositions } : {})
        }
    ]);
    return {
        version,
        previous: current,
        classification: check.classification,
        rewritten: rewrites.map(({ resourceId, path }) => ({ resourceId, path })),
        migration,
        dispositions
    };
}
