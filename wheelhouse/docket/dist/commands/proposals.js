import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config/loader.js';
import { pendingProposals, readSupersessions, readWorkspace, writeLock } from '../mcp/local/files.js';
import { localPrincipal, localWriter } from '../mcp/local/tools.js';
import { addProposalEvidence, promoteProposals, rejectProposal } from '../mcp/local/write.js';
import { isStale } from '../workspace/proposals.js';
const writerOf = (workspace) => {
    const { actor } = localWriter();
    return {
        workspaceId: workspace.resolved.projectRoot,
        actor,
        label: `${actor.replace(/^local:/, '')} via docket CLI`,
        channel: 'cli',
        requestId: `cli:${randomUUID()}`,
        principal: localPrincipal(workspace.people)
    };
};
/**
 * The project's supersede proposals, each scored now: pending ones first.
 * Listing them records any a policy or a person's role now carries over its
 * bar as accepted, as a write would.
 */
export const listProposals = async (options = {}) => {
    const resolved = await loadConfig(options.cwd ?? process.cwd());
    const now = (options.now ?? (() => new Date()))();
    return writeLock(resolved, async () => {
        const workspace = await readWorkspace(resolved);
        await promoteProposals(workspace, { now: () => now });
        const records = (await readSupersessions(workspace)).filter((record) => record.liftedAt === undefined);
        const scored = new Map(pendingProposals(workspace, records, now).map((each) => [each.record.id, each]));
        return records
            .map((record) => {
            const live = scored.get(record.id);
            const score = live?.score.score ?? record.score;
            const threshold = live?.score.threshold ?? record.threshold;
            return {
                id: record.id,
                resource: record.resource,
                supersededBy: record.supersededBy,
                status: record.status ?? 'accepted',
                ...(score !== undefined ? { score } : {}),
                ...(threshold !== undefined ? { threshold } : {}),
                stale: record.status === 'pending' && isStale(record.updatedAt ?? record.recordedAt, now),
                reason: record.reason,
                recordedBy: record.recordedBy,
                recordedAt: record.recordedAt,
                evidence: record.evidence.length
            };
        })
            .filter((listing) => options.all || listing.status === 'pending')
            .sort((a, b) => (a.status === b.status ? (a.recordedAt < b.recordedAt ? -1 : 1) : a.status === 'pending' ? -1 : 1));
    });
};
/**
 * Confirms a proposal as the person at this machine: first-hand evidence of
 * theirs, cited by nothing, scored by who they are - not a way round the bar.
 */
export const confirmProposal = async (proposal, options = {}) => {
    const resolved = await loadConfig(options.cwd ?? process.cwd());
    return writeLock(resolved, async () => {
        const workspace = await readWorkspace(resolved);
        const note = options.note?.trim() || 'Confirmed.';
        return addProposalEvidence(workspace, writerOf(workspace), { supersession: proposal, evidence: [{ note }] }, options.now ? { now: options.now } : {});
    });
};
/** Rejects a pending proposal, with why: the older record stays current, and both are kept. */
export const rejectProposalCommand = async (proposal, reason, options = {}) => {
    const resolved = await loadConfig(options.cwd ?? process.cwd());
    return writeLock(resolved, async () => {
        const workspace = await readWorkspace(resolved);
        return rejectProposal(workspace, writerOf(workspace), { supersession: proposal, reason }, options.now ? { now: options.now } : {});
    });
};
