import { EVIDENCE_LOCATION_FIELDS, InvalidArgumentsError } from '../../workspace/docket.js';
import { WRITE_LIMITS } from '../../workspace/write/inputs.js';
import { isObject } from './args.js';
/**
 * What the write tools share: the evidence entry's schema and its parser,
 * and how a write's result reads for the model and for a client.
 */
const LOCATION_DESCRIPTIONS = {
    repository: 'The repository the location is in, when it is not this one: a name or URL.',
    path: 'Repo-relative file path.',
    lines: 'Line or line range within path: "12" or "12-40".',
    symbol: 'Function, class, resource or manifest entry at the location.',
    key: 'Config or manifest key, for example services.orders.replicas.',
    method: 'HTTP or RPC method, for example GET.',
    endpoint: 'API route or endpoint, for example /v1/orders/{id}.',
    urls: 'Links to what was seen: a permalink, API docs, a dashboard.',
    commit: 'The revision the location was read at.'
};
/** One evidence entry, as the write tools' input schemas describe it. */
export const EVIDENCE_SCHEMA = {
    type: 'object',
    description: 'Where it was seen. source must be one the workspace ontology registers (docket_ontology lists them, with the location fields each requires). ' +
        'Leave source out when it is what the person you act for said: that person is the source. A person source naming someone else ' +
        'counts as said by the person you act for until they confirm it. The server records you as the observer, the person you act ' +
        'for, and this request as the session.',
    properties: {
        source: {
            type: 'string',
            minLength: 1,
            maxLength: 60,
            description: 'The source, for example code, manifest, api or conversation. Omit it for what the person you act for said.'
        },
        sourceRef: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Which instance of the source - a repository, a person, a document URL - when its locator fields do not already say.'
        },
        attributes: {
            type: 'object',
            description: 'Attributes of the source you claim, such as a branch. Only those the source lets a writer set count.',
            maxProperties: 20,
            additionalProperties: { type: ['string', 'number', 'boolean'] }
        },
        locator: {
            type: 'object',
            description: 'Locator fields the source declares beyond the common ones, such as a message id or a section.',
            maxProperties: 20,
            additionalProperties: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'array', items: { type: 'string', maxLength: 2000 }, maxItems: 10 }] }
        },
        ...Object.fromEntries(EVIDENCE_LOCATION_FIELDS.map((field) => [
            field,
            field === 'urls'
                ? { type: 'array', items: { type: 'string', maxLength: 2000 }, maxItems: 10, description: LOCATION_DESCRIPTIONS[field] }
                : { type: 'string', maxLength: field === 'endpoint' || field === 'repository' ? 2000 : 500, description: LOCATION_DESCRIPTIONS[field] }
        ])),
        observedAt: { type: 'string', maxLength: 40, description: 'When it was seen: YYYY-MM-DD or an ISO timestamp. Defaults to now.' },
        observedBy: { type: 'string', maxLength: 100, description: 'Who reported it, if not you: kept as reportedBy. You are recorded as the observer.' },
        note: { type: 'string', maxLength: 1000, description: 'What was seen there, in a sentence.' }
    },
    additionalProperties: false
};
const EVIDENCE_FIELDS = Object.keys(EVIDENCE_SCHEMA.properties);
const text = (value, at, max, required = false) => {
    if (value === undefined && !required)
        return undefined;
    if (typeof value !== 'string' || (required && !value.trim()))
        throw new InvalidArgumentsError(`${at} must be a${required ? ' non-empty' : ''} string.`);
    if (value.length > max)
        throw new InvalidArgumentsError(`${at} is at most ${max} characters.`);
    return value;
};
/** A string argument, trimmed and required, at most `max` characters. */
export function requiredText(value, at, max) {
    return text(value, at, max, true).trim();
}
export function optionalText(value, at, max) {
    return text(value, at, max);
}
/** Claimed source attributes: up to 20 names, each a string, number or boolean. */
function claims(raw, at) {
    if (!isObject(raw))
        throw new InvalidArgumentsError(`${at} must be an object of attribute values.`);
    const entries = Object.entries(raw);
    if (entries.length > 20)
        throw new InvalidArgumentsError(`${at} holds at most 20 attributes.`);
    for (const [name, value] of entries) {
        if (!['string', 'number', 'boolean'].includes(typeof value))
            throw new InvalidArgumentsError(`${at}.${name} must be a string, number or boolean.`);
        if (typeof value === 'string' && value.length > 500)
            throw new InvalidArgumentsError(`${at}.${name} is at most 500 characters.`);
    }
    return raw;
}
/** A source's own locator fields: up to 20, each a string or up to 10 strings. */
function locatorFields(raw, at) {
    if (!isObject(raw))
        throw new InvalidArgumentsError(`${at} must be an object of locator fields.`);
    const entries = Object.entries(raw);
    if (entries.length > 20)
        throw new InvalidArgumentsError(`${at} holds at most 20 fields.`);
    const out = {};
    for (const [field, value] of entries) {
        if (Array.isArray(value)) {
            if (value.length > 10 || !value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 2000)) {
                throw new InvalidArgumentsError(`${at}.${field} must be up to 10 non-empty strings.`);
            }
            out[field] = value;
        }
        else {
            const given = typeof value === 'number' ? String(value) : value;
            out[field] = requiredText(given, `${at}.${field}`, 2000);
        }
    }
    return out;
}
/** Parses evidence entries: wrong shapes are invalid arguments; what they say is the write path's to judge. */
export function parseEvidence(raw, at) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw))
        throw new InvalidArgumentsError(`${at} must be an array of evidence entries.`);
    if (raw.length > WRITE_LIMITS.evidencePerCall)
        throw new InvalidArgumentsError(`${at} holds at most ${WRITE_LIMITS.evidencePerCall} entries.`);
    return raw.map((entry, index) => {
        const where = `${at}[${index}]`;
        if (!isObject(entry))
            throw new InvalidArgumentsError(`${where} must be an object.`);
        const unknown = Object.keys(entry).filter((key) => !EVIDENCE_FIELDS.includes(key));
        if (unknown.length) {
            throw new InvalidArgumentsError(`${where} does not take ${unknown.map((key) => `"${key}"`).join(', ')}; evidence fields are ${EVIDENCE_FIELDS.join(', ')}.`);
        }
        const out = {};
        if (entry.source !== undefined)
            out.source = requiredText(entry.source, `${where}.source`, 60);
        if (entry.sourceRef !== undefined)
            out.sourceRef = requiredText(entry.sourceRef, `${where}.sourceRef`, 200);
        if (entry.attributes !== undefined)
            out.attributes = claims(entry.attributes, `${where}.attributes`);
        if (entry.locator !== undefined)
            out.locator = locatorFields(entry.locator, `${where}.locator`);
        for (const field of EVIDENCE_LOCATION_FIELDS) {
            const value = entry[field];
            if (value === undefined)
                continue;
            if (field === 'urls') {
                const urls = typeof value === 'string' ? [value] : value;
                if (!Array.isArray(urls) || urls.length > 10 || !urls.every((url) => typeof url === 'string' && url.length <= 2000)) {
                    throw new InvalidArgumentsError(`${where}.urls must be up to 10 URLs.`);
                }
                out.urls = urls;
            }
            else {
                const limit = field === 'endpoint' || field === 'repository' ? 2000 : 500;
                // `lines` may come as a number: docket reads `12` as "12".
                const given = field === 'lines' && typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
                out[field] = text(given, `${where}.${field}`, limit);
            }
        }
        const observedAt = text(entry.observedAt, `${where}.observedAt`, 40);
        if (observedAt !== undefined) {
            if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(observedAt) || Number.isNaN(Date.parse(observedAt))) {
                throw new InvalidArgumentsError(`${where}.observedAt must be YYYY-MM-DD or an ISO timestamp.`);
            }
            out.observedAt = observedAt;
        }
        const observedBy = text(entry.observedBy, `${where}.observedBy`, 100);
        if (observedBy?.trim())
            out.observedBy = observedBy.trim();
        const note = text(entry.note, `${where}.note`, 1000);
        if (note !== undefined)
            out.note = note;
        return out;
    });
}
/** Attributes: a plain object of JSON values, as docket's frontmatter holds them. */
export function parseAttributes(raw, at) {
    if (raw === undefined)
        return undefined;
    if (!isObject(raw))
        throw new InvalidArgumentsError(`${at} must be an object of attribute names and values.`);
    if (Object.keys(raw).length > 100)
        throw new InvalidArgumentsError(`${at} holds at most 100 attributes.`);
    return raw;
}
const describeDiagnostic = (d) => `- ${d.severity} ${d.code}: ${d.message}`;
/** `structuredContent.schema` of every write tool's answer. */
export const WRITE_SCHEMA = 'docket-write.v1';
/** A write's answer: refused with its diagnostics as a tool error the model can act on, or what it changed. */
export function writeAnswer(tool, id, viewer, result, dryRun) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    const diagnostics = result.diagnostics.map(({ severity, code, message }) => ({ severity, code, message }));
    const structured = {
        schema: WRITE_SCHEMA,
        tool,
        id,
        ok: errors.length === 0,
        dryRun,
        created: result.created,
        changed: result.changed,
        evidenceAdded: result.evidenceAdded,
        ...(result.documentId ? { documentId: result.documentId } : {}),
        ...(result.path ? { path: result.path } : {}),
        ...(result.revision ? { revision: result.revision } : {}),
        viewer: viewer === null ? null : `${viewer}#${encodeURIComponent(id)}`,
        diagnostics
    };
    const lines = [];
    if (errors.length) {
        lines.push(`${dryRun ? 'This write would be refused' : 'Refused: nothing was written'}. Fix these and call ${tool} again:`, ...errors.map(describeDiagnostic));
    }
    else if (dryRun) {
        lines.push(`The write checks out against the published ontology: ${id} would be ${result.created ? 'created' : 'updated'} with ${result.evidenceAdded} new evidence.`);
    }
    else if (!result.changed) {
        lines.push(`Nothing new: ${id} already holds this, with this evidence.`);
    }
    else {
        lines.push(`${result.created ? 'Created' : 'Updated'} ${id} (${result.path}${result.revision ? `, revision ${result.revision}` : ''}) with ${result.evidenceAdded} new evidence, recorded as observed by you.`);
    }
    if (warnings.length)
        lines.push('', 'Warnings (the write is not blocked by these):', ...warnings.map(describeDiagnostic));
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: structured, ...(errors.length ? { isError: true } : {}) };
}
