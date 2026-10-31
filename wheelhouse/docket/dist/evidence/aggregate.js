import { stableStringify } from '../bundled/adapter-kit/dist/index.js';
import { error, warning } from '../model/index.js';
import { hashContent } from '../source/hashing.js';
import { assess } from './confidence.js';
const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const same = (a, b) => stableStringify(a) === stableStringify(b);
/** First occurrence wins, so evidence keeps the order it was recorded in. */
const distinct = (items) => {
    const seen = new Set();
    return items.filter((item) => {
        const key = stableStringify(item);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
};
const maxOf = (values) => {
    const defined = values.filter((value) => value !== undefined);
    return defined.length === 0 ? undefined : Math.max(...defined);
};
/**
 * Adds `incoming` attributes to `merged` without overwriting: a key already
 * set keeps its value, and a different value is reported rather than applied.
 */
const mergeAttributes = (merged, incoming, report) => {
    for (const [key, value] of Object.entries(incoming)) {
        if (!(key in merged))
            merged[key] = value;
        else if (!same(merged[key], value))
            report(key, merged[key], value);
    }
};
/** Several bodies are kept in path order; an identical body is kept once. */
const mergeContent = (members) => {
    const [only] = members;
    if (members.length === 1 && only)
        return only.content;
    const bodies = distinct(members.map((member) => member.content.trim()).filter((body) => body.length > 0));
    return bodies.length === 0 ? '' : `${bodies.join('\n\n')}\n`;
};
/**
 * Merges the files that declare one id. The first file by path is primary: it
 * names the type and title, and its attribute values stand when a later file
 * disagrees. Nothing a file records is dropped - tags, links, mentions and
 * evidence are unioned - except a file of a different type, which describes
 * something else and is left out with an error.
 */
const mergeGroup = (group, model, diagnostics) => {
    const [primary] = group;
    if (!primary)
        return undefined;
    const members = [];
    for (const document of group) {
        if (document.type !== primary.type) {
            diagnostics.push(error('conflicting-type', `"${document.id}" is a ${primary.type} in ${primary.path}, but this file says ${document.type}; it is left out until they agree.`, { path: document.path, id: document.id }));
            continue;
        }
        members.push(document);
    }
    const attributes = {};
    const links = new Map();
    for (const member of members) {
        const where = { path: member.path, id: member.id };
        mergeAttributes(attributes, member.attributes, (key, kept, ignored) => diagnostics.push(warning('conflicting-attribute', `Attribute "${key}" is ${JSON.stringify(kept)} in ${primary.path}; this file's ${JSON.stringify(ignored)} is not applied.`, where)));
        for (const link of member.links) {
            const key = `${link.rel}\u0000${link.target}`;
            let merged = links.get(key);
            if (!merged) {
                merged = { rel: link.rel, target: link.target, attributes: {}, hasAttributes: false, evidence: [], stated: [] };
                links.set(key, merged);
            }
            if (link.attributes) {
                merged.hasAttributes = true;
                mergeAttributes(merged.attributes, link.attributes, (attribute, kept, ignored) => diagnostics.push(warning('conflicting-attribute', `Attribute "${attribute}" of ${link.rel} → ${link.target} is ${JSON.stringify(kept)} elsewhere; ${JSON.stringify(ignored)} here is not applied.`, where)));
            }
            // Only what was seen of the link itself counts: that a resource was seen
            // somewhere says little about who owns it or what it depends on.
            merged.evidence.push(...(link.evidence ?? []));
            merged.stated.push(member.provenance?.confidence);
        }
    }
    const evidence = distinct(members.flatMap((member) => member.evidence));
    const stated = maxOf(members.map((member) => member.provenance?.confidence));
    const entityLinks = [...links.values()].map((link) => {
        const linkEvidence = distinct(link.evidence);
        return {
            rel: link.rel,
            target: link.target,
            ...(link.hasAttributes ? { attributes: link.attributes } : {}),
            evidence: linkEvidence,
            ...assess(model, { kind: 'relationship', rel: link.rel }, linkEvidence, maxOf(link.stated))
        };
    });
    const entity = {
        id: primary.id,
        type: primary.type,
        title: primary.title,
        path: primary.path,
        paths: members.map((member) => member.path),
        tags: distinct(members.flatMap((member) => member.tags)),
        attributes,
        links: entityLinks,
        content: mergeContent(members),
        mentions: distinct(members.flatMap((member) => member.mentions)),
        evidence,
        ...(primary.provenance ? { provenance: primary.provenance } : {}),
        index: {
            graph: members.every((member) => member.index.graph),
            fts: members.every((member) => member.index.fts),
            vector: members.every((member) => member.index.vector)
        },
        ...assess(model, { kind: 'resource', type: primary.type }, evidence, stated)
    };
    return { ...entity, hash: hashContent(stableStringify(entity)) };
};
/**
 * Merges documents into entities, one per id. Every file that declares an id
 * is an observation of the same resource: its evidence is kept alongside the
 * others', never in place of them, and confidence is computed over all of it.
 *
 * Pass only documents that validated - a broken file has nothing reliable to
 * add. Pure and deterministic: the same documents always give the same
 * entities, hashes included.
 */
export const aggregate = (documents, model) => {
    const groups = new Map();
    for (const document of [...documents].sort(byPath)) {
        const group = groups.get(document.id);
        if (group)
            group.push(document);
        else
            groups.set(document.id, [document]);
    }
    const diagnostics = [];
    const entities = [];
    for (const group of groups.values()) {
        const entity = mergeGroup(group, model, diagnostics);
        if (entity)
            entities.push(entity);
    }
    return { entities, diagnostics };
};
