import { randomUUID } from 'node:crypto';
import { openDocket } from '../adapters/docket.js';
import { connectingPaths } from '../open/paths.js';
import { askAdapters } from './coordinator.js';
import { freshnessOf, freshnessWarning } from './freshness.js';
import { checkAnswer, foundReferences } from './resolve.js';
import { takeSnapshot } from './snapshot.js';
import { synthesize } from './synthesis.js';
/** Results each adapter is asked for, unless the question says otherwise. */
export const DEFAULT_ASK_RESULTS = 20;
/** Evidence text each adapter may return, in bytes. */
export const DEFAULT_EVIDENCE_BYTES = 256 * 1024;
/** The most results one question may ask each adapter for. */
export const MAX_ASK_RESULTS = 100;
/** A question that cannot be asked as put: an unknown adapter, an empty question, a time zone that does not exist. */
export class AskRequestError extends Error {
    name = 'AskRequestError';
}
/** The question was cancelled before its answer was complete. */
export class AskCancelledError extends Error {
    name = 'AskCancelledError';
}
const zoneOf = (timezone) => {
    const zone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
    }
    catch {
        throw new AskRequestError(`"${zone}" is not a time zone: give an IANA name such as "Europe/London" or "UTC".`);
    }
    return zone;
};
const positive = (value, name, fallback, max = Number.MAX_SAFE_INTEGER) => {
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || value < 1)
        throw new AskRequestError(`${name} must be a positive whole number, got ${value}`);
    return Math.min(value, max);
};
/** The instances to ask: the ones named, checked, or the configured defaults. */
const selectAdapters = (docket, named) => {
    const queryable = docket.adapters.filter((slot) => slot.roles.includes('query'));
    if (named !== undefined) {
        return [...new Set(named)].map((id) => {
            const slot = docket.adapters.find((candidate) => candidate.id === id);
            if (!slot) {
                const known = queryable.map((candidate) => candidate.id).join(', ') || 'none';
                throw new AskRequestError(`No adapter "${id}" is configured. Adapters that answer questions: ${known}.`);
            }
            if (!slot.roles.includes('query'))
                throw new AskRequestError(`Adapter "${id}" is not enabled for query: add query to its roles.`);
            return slot;
        });
    }
    const defaults = docket.resolved.config.query.defaultAdapters;
    return defaults === undefined ? queryable : queryable.filter((slot) => defaults.includes(slot.id));
};
/**
 * Puts one question to the adapters through the shared coordinator
 * (docs/adapter-spec.md §10): establishes its scope, time and time zone,
 * selects the instances to ask, asks them with bounded concurrency inside one
 * deadline, checks every answer against the canonical files as they stood when
 * the question was asked, works out how far each instance lags them, and -
 * unless turned off - has a model summarise the results.
 *
 * Every adapter's answer is kept as it came, ids namespaced by instance; a
 * failure is that instance's alone. The canonical references across all of
 * them are listed once each, and the canonical paths joining the entities
 * they found are read from the files.
 */
export const askWith = async (snapshot, docket, input) => {
    const question = input.question.trim();
    if (question === '')
        throw new AskRequestError('Ask something: the question is empty.');
    const { query, summarize } = docket.resolved.config;
    const timezone = zoneOf(input.timezone);
    const slots = selectAdapters(docket, input.adapters);
    const maxResults = positive(input.maxResults, 'maxResults', DEFAULT_ASK_RESULTS, MAX_ASK_RESULTS);
    const maxEvidenceBytes = positive(input.maxEvidenceBytes, 'maxEvidenceBytes', DEFAULT_EVIDENCE_BYTES);
    const timeoutMs = positive(input.timeoutMs, 'timeoutMs', query.timeoutMs);
    const maxConcurrent = positive(input.maxConcurrentAdapters, 'maxConcurrentAdapters', query.maxConcurrentAdapters);
    const now = input.now ?? new Date();
    const deadline = new Date(now.getTime() + timeoutMs).toISOString();
    const requestId = input.requestId ?? randomUUID();
    const context = { scope: snapshot.scope, now: now.toISOString(), timezone };
    const conversation = input.conversation && input.conversation.length > 0 ? [...input.conversation] : undefined;
    // Each instance describes itself as it is created, so its freshness can be judged by the inputs it takes.
    const inputs = new Map();
    const outcomes = await askAdapters({
        slots: slots.map((slot) => ({
            id: slot.id,
            create: async () => {
                const adapter = await slot.create();
                try {
                    inputs.set(slot.id, adapter.describe().inputs);
                }
                catch {
                    // A description that breaks the contract leaves freshness unknown; the answer is judged on its own.
                }
                return adapter;
            }
        })),
        request: {
            requestId,
            question,
            context: { ...context, ...(conversation ? { conversation } : {}) },
            budget: { maxResults, maxEvidenceBytes, deadline }
        },
        maxConcurrent,
        signal: input.signal
    });
    const rejected = new Map();
    const checked = [];
    const results = outcomes.map((outcome) => {
        if (outcome.state === 'failed')
            return outcome;
        const result = checkAnswer(outcome.adapter, outcome.answer, snapshot);
        checked.push({ adapter: outcome.adapter, sightings: result.sightings });
        if (result.rejected.length > 0)
            rejected.set(outcome.adapter, result.rejected);
        return { adapter: outcome.adapter, state: 'answered', answer: result.answer, durationMs: outcome.durationMs, references: result.references };
    });
    const reported = new Map(results.flatMap((result) => (result.state === 'answered' ? [[result.adapter, result.answer.coverage.checkpoint]] : [])));
    const freshness = await freshnessOf(docket, snapshot, slots, { inputs, reported });
    const diagnostics = [];
    if (slots.length === 0) {
        diagnostics.push({
            severity: 'warning',
            code: 'no-query-adapters',
            message: 'No adapter is enabled for query, so nothing was asked. Give an adapter the query role in .docket.yaml.'
        });
    }
    for (const result of results) {
        const fresh = freshness.get(result.adapter);
        if (result.state === 'answered' && fresh)
            result.freshness = fresh;
        const warning = freshnessWarning(result.adapter, fresh);
        if (warning)
            diagnostics.push({ severity: 'warning', code: 'adapter-behind', message: warning });
    }
    const references = foundReferences(checked, snapshot);
    const found = [
        ...new Set(references.flatMap((reference) => reference.status === 'unresolved' ? [] : reference.kind === 'entity' ? [reference.id] : reference.entity ? [reference.entity] : []))
    ];
    const edges = snapshot.entities.flatMap((entity) => entity.links.map((link) => ({ source: entity.id, rel: link.rel, target: link.target })));
    const connections = connectingPaths(edges, found);
    const answer = {
        requestId,
        question,
        context: { ...context, deadline },
        results,
        synthesis: null,
        references,
        connections,
        diagnostics
    };
    if (!(input.synthesis ?? query.synthesis)) {
        answer.notice = { reason: 'disabled', message: 'No summary was asked for: the results stand on their own.' };
    }
    else {
        if (input.signal?.aborted)
            throw new AskCancelledError('The question was cancelled.');
        const outcome = await synthesize({ question, context, conversation, results, references, connections, snapshot }, {
            summarize,
            memoryRoot: snapshot.resolved.memoryRoot,
            adapters: new Map(slots.map((slot) => [slot.id, { fingerprint: slot.fingerprint, checkpoint: freshness.get(slot.id)?.checkpoint }])),
            signal: input.signal
        });
        if (input.signal?.aborted)
            throw new AskCancelledError('The question was cancelled.');
        answer.synthesis = outcome.synthesis;
        if (outcome.notice)
            answer.notice = outcome.notice;
    }
    return { answer, snapshot, docket, rejected };
};
/**
 * `askWith` over the project `.docket.yaml` at or above `cwd` is in: the files
 * are read once, and the adapters read through that same snapshot.
 */
export const askProject = async (cwd, input, options = {}) => {
    const snapshot = await takeSnapshot(cwd);
    const docket = await openDocket(snapshot.resolved, { ...options, canonical: options.canonical ?? snapshot.reader });
    return askWith(snapshot, docket, input);
};
