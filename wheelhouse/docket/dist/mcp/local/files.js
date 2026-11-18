import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, posix as posixPath, relative, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from '../../vendor/yaml.js';
import { filesystemSource } from '../../canonical/source.js';
import { parseOntology } from '../../ontology/loader.js';
import { hashContent } from '../../source/hashing.js';
import { parseMemoryFile } from '../../source/parser.js';
import { cloudDocumentPath } from '../../workspace/documents.js';
const posix = (path) => path.split(sep).join('/');
/** A path relative to the project root, as an absolute one. */
export const absolute = (resolved, path) => resolve(resolved.projectRoot, path);
/** The project's ontology file, relative to its root. */
export const ontologyFile = (resolved) => posix(relative(resolved.projectRoot, resolved.ontologyPath));
/** Reads the project's docket: every document under its source, parsed, and its ontology. */
export async function readWorkspace(resolved) {
    const documents = [];
    for await (const entry of filesystemSource(resolved).documents()) {
        if ('error' in entry)
            documents.push({ path: entry.path, error: entry.error, document: null });
        else
            documents.push({ path: entry.path, raw: entry.raw, hash: entry.hash, document: parseMemoryFile(entry.raw, entry.path).document ?? null });
    }
    documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    let ontology = null;
    try {
        const text = await readFile(resolved.ontologyPath, 'utf8');
        const { mtime } = await stat(resolved.ontologyPath);
        ontology = { text, revision: hashContent(text), ontology: parseOntology(text, ontologyFile(resolved)).ontology, changedAt: mtime };
    }
    catch {
        ontology = null;
    }
    return { ...storeOf(resolved), documents, ontology };
}
/** The documents that declare `id`, in path order. */
export const declaring = (workspace, id) => workspace.documents.filter((entry) => entry.document?.id === id);
/** A resource's type and title as its first declaring document gives them, or null when no document declares it. */
export function describeResource(workspace, id) {
    const first = declaring(workspace, id)[0];
    return first ? { id, type: first.document.type, title: first.document.title, path: first.path } : null;
}
/**
 * Where a resource's own document goes: beside the project's other documents
 * of its type; else in the folder `docket init` makes for the type, such as
 * `<root>/resources/services/` or `<root>/decisions/`; else at
 * `<root>/resources/<type>/<slug>.md`, as a server would put it in a repo.
 */
export function documentPathOf(workspace, resource) {
    const fallback = cloudDocumentPath(resource);
    const file = posixPath.basename(fallback);
    const under = (path) => (workspace.root === '.' ? path : `${workspace.root}/${path}`);
    const sibling = workspace.documents.find((entry) => entry.document?.type === resource.type);
    if (sibling)
        return `${posixPath.dirname(sibling.path)}/${file}`;
    const plural = resource.type.endsWith('y') ? `${resource.type.slice(0, -1)}ies` : `${resource.type}s`;
    for (const folder of [`resources/${plural}`, plural]) {
        if (existsSync(absolute(workspace.resolved, under(folder))))
            return under(`${folder}/${file}`);
    }
    return fallback.replace(/^\.docket\//, workspace.root === '.' ? '' : `${workspace.root}/`);
}
const exists = async (path) => {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
};
/**
 * Where a resource's new document can go: its path, or beside it as
 * `<slug>-2.md` and so on when another file already holds that path.
 */
export async function freeDocumentPath(workspace, resource) {
    const base = documentPathOf(workspace, resource);
    for (const candidate of [base, ...[2, 3, 4, 5].map((n) => base.replace(/\.md$/, `-${n}.md`))]) {
        if (!workspace.documents.some((entry) => entry.path === candidate) && !(await exists(absolute(workspace.resolved, candidate))))
            return candidate;
    }
    return null;
}
/** Writes a file whole or not at all: to a temporary file beside it, then renamed over it. */
export async function writeText(path, text) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, text, 'utf8');
        await rename(temporary, path);
    }
    catch (cause) {
        await rm(temporary, { force: true });
        throw cause;
    }
}
export const removeFile = (path) => rm(path, { force: true });
/** The file a store record is kept in, under the docket's root. */
const recordFile = (workspace, name) => (workspace.root === '.' ? name : `${workspace.root}/${name}`);
/** The store of a project, without reading its documents. */
export const storeOf = (resolved) => ({ resolved, root: posix(relative(resolved.projectRoot, resolved.memoryRoot)) || '.' });
async function readRecords(workspace, name, key) {
    let text;
    try {
        text = await readFile(absolute(workspace.resolved, recordFile(workspace, name)), 'utf8');
    }
    catch {
        return [];
    }
    const data = parseYaml(text);
    const list = typeof data === 'object' && data !== null ? data[key] : undefined;
    if (!Array.isArray(list))
        throw new Error(`${recordFile(workspace, name)} has no ${key} list.`);
    return list;
}
async function writeRecords(workspace, name, header, key, records) {
    const body = stringifyYaml({ [key]: records }, { lineWidth: 0 });
    await writeText(absolute(workspace.resolved, recordFile(workspace, name)), `${header.trim().replace(/^/gm, '# ')}\n${body}`);
}
export const SUPERSESSIONS_FILE = 'supersessions.yaml';
const SUPERSESSIONS_HEADER = `
Supersessions recorded through docket's MCP server (docket_supersede): each
record gone out of date, the record that replaced it, until when it held, why,
and the evidence. The documents themselves are untouched.`;
export const readSupersessions = (workspace) => readRecords(workspace, SUPERSESSIONS_FILE, 'supersessions');
export const writeSupersessions = (workspace, records) => writeRecords(workspace, SUPERSESSIONS_FILE, SUPERSESSIONS_HEADER, 'supersessions', records);
/** The supersessions that hold now, one per superseded record, by its id. */
export async function liveSupersessions(workspace) {
    return new Map((await readSupersessions(workspace)).filter((record) => record.liftedAt === undefined).map((record) => [record.resource, record]));
}
export const HISTORY_FILE = 'ontology-history.yaml';
const HISTORY_HEADER = `
The ontology versions published through docket's MCP server
(docket_publish_ontology_change). The text of each is in git's history of the
ontology file; restore an earlier one from there.`;
export const historyPath = (workspace) => recordFile(workspace, HISTORY_FILE);
export const readHistory = (workspace) => readRecords(workspace, HISTORY_FILE, 'versions');
export const writeHistory = (workspace, versions) => writeRecords(workspace, HISTORY_FILE, HISTORY_HEADER, 'versions', versions);
/**
 * The published head: the ontology file as it is now. Its version is the one
 * the history records for this text; a file changed by hand since the last
 * recorded publish is the version after it, and one never published through
 * MCP is version 1.
 */
export async function headOf(workspace) {
    const { ontology } = workspace;
    if (!ontology)
        return null;
    const last = (await readHistory(workspace)).at(-1);
    if (last && last.revision === ontology.revision)
        return { ...ontology, version: last.version, publishedAt: last.publishedAt, message: last.message };
    return { ...ontology, version: (last?.version ?? 0) + 1, publishedAt: ontology.changedAt, message: null };
}
/** Where proposed drafts are kept, under the docket's root. */
export const draftPath = (workspace, id) => recordFile(workspace, `ontology-drafts/${id}.yaml`);
/** The workspace as a change check reads it: every document that parses, each the project's own, and the head. */
export function snapshotOf(workspace, head) {
    const parsed = workspace.documents.flatMap((entry) => (entry.document ? [entry.document] : []));
    return {
        documents: parsed,
        origins: new Map(workspace.documents.map((entry) => [entry.path, 'local'])),
        head: head ? { number: head.version, ontology: head.ontology } : null
    };
}
const queues = new Map();
/**
 * Runs `fn` after every write already queued for the project, so two calls
 * never read the same files and write over each other.
 */
export function serialized(project, fn) {
    const previous = queues.get(project) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const settled = next.then(() => undefined, () => undefined);
    queues.set(project, settled);
    void settled.then(() => {
        if (queues.get(project) === settled)
            queues.delete(project);
    });
    return next;
}
