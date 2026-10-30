import { Document, isMap, isSeq, parse, parseDocument, YAMLMap, YAMLSeq } from '../vendor/yaml.js';
import { z } from '../vendor/zod.js';
import { DEFAULT_ADAPTERS, memoryConfigSchema } from '../config/config.js';
/** The entry as plain YAML, the way the instance is written: envelope first, `config` last. */
const entryValue = ({ entry }) => ({
    id: entry.id,
    module: entry.module,
    roles: entry.roles,
    ...(entry.runtime === undefined ? {} : { runtime: entry.runtime }),
    config: entry.config
});
/** Flow lists stay on one line, and long values are never folded. */
const FORMAT = { flowCollectionPadding: false, lineWidth: 0 };
/** The instance as a node of `document`, roles on one line. */
const entryNode = (document, addition) => {
    const node = document.createNode(entryValue(addition));
    const roles = node.get('roles', true);
    if (isSeq(roles))
        roles.flow = true;
    return node;
};
/** The runtime group as a node of `document`, services on one line. */
const runtimeNode = (document, runtime) => {
    const node = document.createNode(runtime.config);
    const services = node.get('services', true);
    if (isSeq(services))
        services.flow = true;
    return node;
};
/** The lines the addition adds, for showing in a plan. */
export const additionYaml = (addition) => {
    const document = new Document({});
    const root = document.contents;
    const adapters = new YAMLSeq();
    adapters.items.push(entryNode(document, addition));
    root.set('adapters', adapters);
    if (addition.runtime !== undefined) {
        const runtimes = new YAMLMap();
        runtimes.set(addition.runtime.id, runtimeNode(document, addition.runtime));
        root.set('runtimes', runtimes);
    }
    return document.toString(FORMAT);
};
/**
 * The `yaml` parser hangs every comment after a top-level section's last item
 * on that section, and writes them all back at the section's indent. Comment
 * lines that were at the top level in `text` go back to the top level: before
 * the next key, or at the end of the document.
 */
const keepTopLevelComments = (document, root, text) => {
    root.items.forEach((pair, at) => {
        const value = pair.value;
        const key = pair.key;
        if (!isMap(value) && !isSeq(value))
            return;
        if (!value.comment || !value.range || !key?.range)
            return;
        const keyColumn = key.range[0] - (text.lastIndexOf('\n', key.range[0] - 1) + 1);
        const trailing = text.slice(value.range[1], value.range[2]).split('\n');
        const first = trailing.findIndex((line) => line.trimStart().startsWith('#'));
        const lines = trailing.slice(first);
        while (lines.length > 0 && lines.at(-1).trim() === '')
            lines.pop();
        const commentLines = value.comment.split('\n');
        if (first < 0 || lines.length !== commentLines.length)
            return;
        const outer = lines.findIndex((line) => line.trimStart().startsWith('#') && line.length - line.trimStart().length <= keyColumn);
        if (outer < 0)
            return;
        const inner = commentLines.slice(0, outer);
        while (inner.length > 0 && inner.at(-1).trim() === '')
            inner.pop();
        value.comment = inner.length > 0 ? inner.join('\n') : null;
        const moved = commentLines.slice(outer).join('\n');
        const next = root.items[at + 1]?.key;
        if (next !== undefined && typeof next === 'object' && next !== null) {
            next.commentBefore = next.commentBefore ? `${moved}\n${next.commentBefore}` : moved;
            next.spaceBefore = true;
        }
        else {
            document.comment = document.comment ? `${moved}\n${document.comment}` : moved;
        }
    });
};
/**
 * Adds an adapter instance - and its runtime group - to a version 2
 * `.docket.yaml`, keeping every existing entry, section and comment. A file
 * without `adapters` has the default local adapter written out first, so
 * adding one never takes away the one it already had. The result must load,
 * and must hold exactly what was there plus the addition.
 */
export const addToConfigText = (text, addition, file = '.docket.yaml') => {
    const document = parseDocument(text);
    if (document.errors.length > 0)
        throw new Error(`Invalid ${file}: ${document.errors[0].message}`);
    const raw = document.toJS();
    if (typeof raw !== 'object' || raw === null || raw.version !== 2) {
        throw new Error(`${file} is not version 2; only a version 2 file has adapters to add to.`);
    }
    const before = memoryConfigSchema.safeParse(raw);
    if (!before.success)
        throw new Error(`Invalid ${file}; fix it before adding an adapter:\n${z.prettifyError(before.error)}`);
    if (before.data.adapters.some((adapter) => adapter.id === addition.entry.id)) {
        throw new Error(`${file} already has an adapter "${addition.entry.id}".`);
    }
    if (!isMap(document.contents))
        throw new Error(`Invalid ${file}: expected a mapping at the top level.`);
    const root = document.contents;
    keepTopLevelComments(document, root, text);
    const adapters = root.get('adapters', true);
    const sequence = isSeq(adapters) ? adapters : document.createNode(DEFAULT_ADAPTERS);
    if (sequence !== adapters)
        root.set('adapters', sequence);
    sequence.flow = false;
    sequence.items.push(entryNode(document, addition));
    if (addition.runtime !== undefined) {
        const runtimes = root.get('runtimes', true);
        const map = isMap(runtimes) ? runtimes : new YAMLMap();
        if (map !== runtimes)
            root.set('runtimes', map);
        map.flow = false;
        if (map.has(addition.runtime.id))
            throw new Error(`${file} already has a runtime "${addition.runtime.id}".`);
        map.set(addition.runtime.id, runtimeNode(document, addition.runtime));
    }
    const written = document.toString(FORMAT);
    const after = memoryConfigSchema.safeParse(parse(written));
    if (!after.success) {
        throw new Error(`Adding "${addition.entry.id}" would leave ${file} invalid:\n${z.prettifyError(after.error)}`);
    }
    const added = after.data.adapters.find((adapter) => adapter.id === addition.entry.id);
    if (after.data.adapters.length !== before.data.adapters.length + 1 || added === undefined) {
        throw new Error(`Could not add "${addition.entry.id}" to ${file}; it is left unchanged. Please report this.`);
    }
    return written;
};
