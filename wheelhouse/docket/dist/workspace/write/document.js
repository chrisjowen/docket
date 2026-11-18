import { isMap, isSeq, parseDocument, stringify } from '../../vendor/yaml.js';
import { parseMemoryFile } from '../docket.js';
import { evidenceKey, orderedEvidence } from './evidence.js';
/**
 * How a write becomes a docket Markdown document: a change to one resource
 * merged into the text of its document, or a new one, keeping the layout and
 * comments of what is already there and adding only the evidence it does not
 * already hold.
 */
const DELIMITER = /^---[ \t]*\r?$/;
/** A docket file's frontmatter as a YAML document, and its body, the text after the closing delimiter. Null when it has no mapping frontmatter. */
export function splitDocument(raw) {
    const lines = raw.split('\n');
    if (!DELIMITER.test(lines[0] ?? ''))
        return null;
    const end = lines.findIndex((line, index) => index > 0 && DELIMITER.test(line));
    if (end < 0)
        return null;
    const frontmatter = parseDocument(lines.slice(1, end).join('\n'));
    if (frontmatter.errors.length || !isMap(frontmatter.contents))
        return null;
    return { frontmatter, body: lines.slice(end + 1).join('\n') };
}
const isDocumentNode = (value) => typeof value === 'object' && value !== null && 'contents' in value && typeof value.toString === 'function' && 'errors' in value;
/** A docket file from its frontmatter and body: the body without leading blank lines or trailing space, ending in one newline. */
export function renderDocument(frontmatter, body) {
    const yaml = isDocumentNode(frontmatter)
        ? frontmatter.toString({ lineWidth: 0, flowCollectionPadding: false })
        : stringify(frontmatter, { lineWidth: 0 });
    const text = body.replace(/^\n+/, '').replace(/\s+$/, '');
    return `---\n${yaml}---\n${text ? `${text}\n` : ''}`;
}
/**
 * Merges a change into a document's text, or makes a new one when `existing`
 * is null. Keeps the evidence entries it really added, by resource and link.
 * Null when the existing frontmatter cannot be updated.
 */
export function composeDocument(existing, change, fallbackTitle) {
    let added = 0;
    const kept = new Map();
    const note = (on, entry) => {
        added += 1;
        kept.set(on, [...(kept.get(on) ?? []), entry]);
    };
    const evidence = () => [...kept].map(([on, entries]) => ({ on, entries }));
    if (existing === null) {
        const seen = new Set();
        const fresh = (on, entries) => entries
            .filter((entry) => {
            const key = evidenceKey(entry);
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        })
            .map((entry) => {
            const plain = orderedEvidence(entry);
            note(on, plain);
            return plain;
        });
        const own = fresh(change.id, change.evidence);
        const links = new Map();
        for (const link of change.links) {
            const at = `${link.rel}\u0000${link.target}`;
            const entry = links.get(at) ?? { rel: link.rel, target: link.target, evidence: [] };
            if (link.attributes && Object.keys(link.attributes).length)
                entry.attributes = { ...entry.attributes, ...link.attributes };
            seen.clear();
            for (const known of entry.evidence)
                seen.add(evidenceKey(known));
            entry.evidence.push(...fresh(`${link.rel} -> ${link.target}`, link.evidence));
            links.set(at, entry);
        }
        const frontmatter = { id: change.id, type: change.type, title: change.title ?? fallbackTitle };
        if (change.provenance)
            frontmatter.provenance = change.provenance;
        if (change.attributes && Object.keys(change.attributes).length)
            frontmatter.attributes = change.attributes;
        if (links.size) {
            frontmatter.links = [...links.values()].map((link) => link.evidence.length ? link : { rel: link.rel, target: link.target, ...(link.attributes ? { attributes: link.attributes } : {}) });
        }
        if (own.length)
            frontmatter.evidence = own;
        return { raw: renderDocument(frontmatter, change.body ?? ''), added, evidence: evidence() };
    }
    const parts = splitDocument(existing);
    if (!parts)
        return null;
    const doc = parts.frontmatter;
    if (change.title !== undefined && doc.get('title') !== change.title)
        doc.set('title', change.title);
    for (const [key, value] of Object.entries(change.attributes ?? {})) {
        const attributes = doc.get('attributes', true);
        if (!isMap(attributes))
            doc.set('attributes', doc.createNode({ [key]: value }));
        else if (JSON.stringify(attributes.toJSON()[key]) !== JSON.stringify(value))
            attributes.set(key, doc.createNode(value));
    }
    const appendTo = (on, holder, entries) => {
        const current = holder.get('evidence', true);
        const seen = new Set(isSeq(current) ? current.toJSON().map(evidenceKey) : []);
        for (const entry of entries) {
            const plain = orderedEvidence(entry);
            const key = evidenceKey(plain);
            if (seen.has(key))
                continue;
            seen.add(key);
            note(on, plain);
            const seq = holder.get('evidence', true);
            if (isSeq(seq))
                seq.add(doc.createNode(plain));
            else
                holder.set('evidence', doc.createNode([plain]));
        }
    };
    appendTo(change.id, doc, change.evidence);
    for (const link of change.links) {
        let links = doc.get('links', true);
        if (!isSeq(links)) {
            doc.set('links', doc.createNode([]));
            links = doc.get('links', true);
        }
        if (!isSeq(links))
            return null;
        let node = links.items.find((item) => isMap(item) && item.get('rel') === link.rel && item.get('target') === link.target);
        if (!isMap(node)) {
            node = doc.createNode({ rel: link.rel, target: link.target });
            links.add(node);
        }
        if (!isMap(node))
            return null;
        for (const [key, value] of Object.entries(link.attributes ?? {})) {
            const attributes = node.get('attributes', true);
            if (!isMap(attributes))
                node.set('attributes', doc.createNode({ [key]: value }));
            else if (JSON.stringify(attributes.toJSON()[key]) !== JSON.stringify(value))
                attributes.set(key, doc.createNode(value));
        }
        appendTo(`${link.rel} -> ${link.target}`, node, link.evidence);
    }
    const body = change.body !== undefined ? change.body : parts.body;
    const raw = renderDocument(doc, body);
    return { raw, added, evidence: evidence() };
}
/** Whether two texts of a document say the same thing: the same frontmatter values and body, whatever the layout. `b` must parse as a docket document. */
export function sameMeaning(a, b, path) {
    const meaning = (raw) => {
        const parts = splitDocument(raw);
        return parts ? JSON.stringify([parts.frontmatter.toJS(), parts.body.trim()]) : raw;
    };
    return parseMemoryFile(b, path).document !== undefined && meaning(a) === meaning(b);
}
/**
 * A document's body with narrative notes appended under a dated heading,
 * after a rule when the body already says something. `raw` is the document's
 * current text; absent when it has none.
 */
export function appendedNotes(raw, notes, now) {
    const current = raw === undefined ? '' : (splitDocument(raw)?.body ?? '');
    return `${current.trimEnd()}${current.trim() ? '\n\n---\n\n' : ''}### Notes added ${now.toISOString()}\n\n${notes.trim()}`;
}
