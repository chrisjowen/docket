import { canonicalPassage } from './passage.js';
/**
 * Checks each hit against the canonical records: a hit whose input the
 * canonical files hold at another revision - or, for an entity, no longer hold
 * - is stale native state a sync has not yet cleared, and is dropped. A hit
 * whose revision is current gains its source span and the times the canonical
 * record states; it never gains a time the record does not state. Inputs the
 * reader does not serve keep the reference the engine stored, unverified.
 */
export const resolveNativeHits = async (hits, canonical) => {
    const resolved = [];
    let stale = 0;
    for (const hit of hits) {
        const { kind, id, revision } = hit.identity;
        const record = await canonical.get(kind, id);
        if (record === undefined ? kind === 'entity' : record.revision !== revision) {
            stale += 1;
            continue;
        }
        const passage = record === undefined ? undefined : canonicalPassage(record);
        resolved.push({
            nativeId: hit.nativeId,
            text: hit.text,
            ref: passage?.ref ?? { kind, id, revision },
            ...(hit.score !== undefined ? { score: hit.score } : {}),
            ...(passage?.observedAt !== undefined ? { observedAt: passage.observedAt } : {}),
            ...(passage?.eventAt !== undefined ? { eventAt: passage.eventAt } : {})
        });
    }
    return { hits: resolved, stale };
};
/** The warning an answer carries when stale native records were dropped from it. */
export const staleDiagnostic = (stale) => stale === 0
    ? []
    : [
        {
            severity: 'warning',
            code: 'stale-native-records',
            message: `${stale} match${stale === 1 ? '' : 'es'} came from records the canonical files no longer hold at that revision and ${stale === 1 ? 'was' : 'were'} left out; the next sync or rebuild removes them.`
        }
    ];
const bytes = (text) => Buffer.byteLength(text, 'utf8');
/**
 * A recall engine's top-k as an answer: every passage as evidence, shown in
 * one passages block, and the canonical entities among them - only entities
 * that were projected and matched, never inferred ones - in an entities
 * block. Hits beyond `maxResults` or `maxEvidenceBytes` are dropped and the
 * answer says it was truncated. Never exhaustive: a top-k is not a count.
 */
export const recallAnswer = (options) => {
    const { budget, context } = options.request;
    const evidence = [];
    let used = 0;
    let truncated = options.hits.length > budget.maxResults;
    for (const hit of options.hits.slice(0, budget.maxResults)) {
        const size = bytes(hit.text);
        if (used + size > budget.maxEvidenceBytes) {
            truncated = true;
            break;
        }
        used += size;
        evidence.push({
            id: `passage-${evidence.length + 1}`,
            nativeId: hit.nativeId,
            kind: hit.ref.kind === 'observation' ? 'observation' : 'passage',
            text: hit.text,
            canonicalRefs: [hit.ref],
            ...(hit.observedAt !== undefined ? { observedAt: hit.observedAt } : {}),
            ...(hit.eventAt !== undefined ? { eventAt: hit.eventAt } : {}),
            ...(hit.score !== undefined && Number.isFinite(hit.score) ? { score: hit.score } : {})
        });
    }
    const blocks = [];
    if (evidence.length > 0) {
        blocks.push({ kind: 'passages', id: 'passages', evidenceIds: evidence.map((item) => item.id) });
    }
    const entities = new Map();
    for (const item of evidence) {
        const [ref] = item.canonicalRefs;
        if (ref?.kind !== 'entity')
            continue;
        const known = entities.get(ref.id);
        if (known)
            known.evidenceIds.push(item.id);
        else {
            entities.set(ref.id, {
                item: {
                    ref: { kind: 'entity', id: ref.id, ...(ref.revision !== undefined ? { revision: ref.revision } : {}) },
                    ...(item.score !== undefined ? { score: item.score } : {})
                },
                evidenceIds: [item.id]
            });
        }
    }
    if (entities.size > 0) {
        blocks.push({
            kind: 'entities',
            id: 'entities',
            evidenceIds: [...entities.values()].flatMap((entry) => entry.evidenceIds),
            entities: [...entities.values()].map((entry) => entry.item)
        });
    }
    return {
        interpretation: options.interpretation,
        blocks,
        evidence,
        coverage: {
            mode: 'top-k',
            truncated: truncated || (options.more ?? options.hits.length >= budget.maxResults),
            scope: context.scope,
            ...(options.checkpoint !== undefined ? { checkpoint: options.checkpoint } : {})
        },
        diagnostics: options.diagnostics ?? []
    };
};
