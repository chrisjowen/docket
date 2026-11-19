import { stat } from 'node:fs/promises';
import { absolute, readRecords, readWorkspace, removeFile, writeLock, writeRecords, writeText } from '../mcp/local/files.js';
import { validateDocuments } from '../ontology/validator.js';
import { parseOntology } from '../ontology/loader.js';
import { hashContent } from '../source/hashing.js';
import { parseMemoryFile } from '../source/parser.js';
import { DocumentError, checkDocument, checkoutProblem } from '../workspace/documents.js';
import { hasErrors } from '../workspace/write/evidence.js';
export const PUSHED_FILE = 'pushed.yaml';
const PUSHED_HEADER = `
The documents checkouts pushed into this docket with \`docket cloud push\`
through \`docket serve\`, and which checkout each came from. A checkout's next
push updates or removes only its own; every other document is the server's.`;
const readPushed = (store) => readRecords(store, PUSHED_FILE, 'documents');
const writePushed = (store, records) => writeRecords(store, PUSHED_FILE, PUSHED_HEADER, 'documents', [...records].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
/** The project's live documents of one origin, in path order: a checkout's (`cli`, with `originRef`), or the server's own (`cloud`). */
export async function listProjectDocuments(resolved, query) {
    const workspace = await readWorkspace(resolved);
    const pushed = new Map((await readPushed(workspace)).map((record) => [record.path, record]));
    const out = [];
    for (const entry of workspace.documents) {
        if (entry.raw === undefined || entry.hash === undefined)
            continue;
        const record = pushed.get(entry.path);
        if (query.origin === 'cli' ? record?.checkout !== query.originRef : record !== undefined)
            continue;
        let updatedAt;
        try {
            updatedAt = (await stat(absolute(resolved, entry.path))).mtime.toISOString();
        }
        catch {
            updatedAt = undefined;
        }
        out.push({
            path: entry.path,
            hash: entry.hash,
            origin: query.origin,
            ...(record ? { originRef: record.checkout } : {}),
            ...(updatedAt ? { updatedAt } : {}),
            ...(query.raw ? { raw: entry.raw } : {})
        });
    }
    return out;
}
const toPush = (diagnostic, path) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.path ?? path
});
/** Why a path cannot hold a pushed document of this project: outside its docket, or among the docket's own files. */
function placeProblem(workspace, path) {
    const inside = workspace.root === '.' ? path : path.startsWith(`${workspace.root}/`) ? path.slice(workspace.root.length + 1) : null;
    if (inside === null)
        return `${path} is outside this docket's root, ${workspace.root}/: push from a checkout whose docket is there too.`;
    if (inside.split('/').some((segment) => segment.startsWith('.')))
        return `${path} is among the docket's own files, where no document goes.`;
    return null;
}
/**
 * `docket cloud push` into the project: the checkout's files are validated as
 * one push - each path, size and structure, and the changed documents against
 * the ontology beside the documents their links point at - before anything is
 * written; any error refuses it all. A path another source holds is refused,
 * unless it holds the same text. A dry run validates and reports, writing
 * nothing. Runs under the project's write lock.
 */
export async function pushToProject(resolved, writer, input, options = {}) {
    const problem = checkoutProblem(input.checkout);
    if (problem)
        throw new Error(problem);
    const dryRun = options.dryRun === true;
    return writeLock(resolved, async () => {
        const workspace = await readWorkspace(resolved);
        const diagnostics = [];
        const refuse = (code, message, path) => diagnostics.push({ severity: 'error', code, message, ...(path ? { path } : {}) });
        const warn = (code, message, path) => diagnostics.push({ severity: 'warning', code, message, path });
        const ontology = workspace.ontology?.ontology ?? (workspace.ontology ? parseOntology(workspace.ontology.text, 'ontology').ontology : null);
        if (!ontology)
            refuse('no-ontology', 'This docket has no ontology to check documents against.');
        const removing = new Set(input.remove);
        const files = new Map();
        const seen = new Set();
        for (const { path, raw } of input.upsert) {
            if (seen.has(path)) {
                refuse('duplicate-path', `${path} is in the push twice.`, path);
                continue;
            }
            seen.add(path);
            if (removing.has(path)) {
                refuse('upsert-and-remove', `${path} is both upserted and removed.`, path);
                continue;
            }
            try {
                const document = checkDocument(path, raw);
                const place = placeProblem(workspace, path);
                if (place) {
                    refuse('invalid-path', place, path);
                    continue;
                }
                diagnostics.push(...parseMemoryFile(raw, path).diagnostics.map((d) => toPush(d, path)));
                files.set(path, { raw, hash: hashContent(raw), document });
            }
            catch (caught) {
                if (!(caught instanceof DocumentError))
                    throw caught;
                const errors = caught.diagnostics.filter((d) => d.severity === 'error');
                if (errors.length)
                    diagnostics.push(...errors.map((d) => toPush(d, path)));
                else
                    refuse(caught.code === 'too-large' ? 'document-too-large' : 'invalid-document', caught.message, path);
            }
        }
        const pushed = await readPushed(workspace);
        const ownerOf = new Map(pushed.map((record) => [record.path, record.checkout]));
        const held = new Map(workspace.documents.map((entry) => [entry.path, entry]));
        const created = [];
        const updated = [];
        const unchanged = [];
        for (const [path, file] of files) {
            const current = held.get(path);
            if (!current)
                created.push(path);
            else if (ownerOf.get(path) === input.checkout)
                (current.hash === file.hash ? unchanged : updated).push(path);
            else if (current.hash === file.hash) {
                warn('held-elsewhere', `${path} is already in the docket with the same text, so it is left as it is.`, path);
                unchanged.push(path);
            }
            else {
                const holder = ownerOf.has(path) ? "another checkout's document" : "the server's own document";
                refuse('path-taken', `${path}: the docket already holds ${holder} at that path. Move the file, or change it at its source.`, path);
            }
        }
        const removed = [...removing].filter((path) => ownerOf.get(path) === input.checkout && held.has(path)).sort();
        for (const path of removing) {
            if (!removed.includes(path))
                warn('not-pushed', `${path} is not a document this checkout pushed, so there is nothing to remove.`, path);
        }
        // The changed documents against the ontology, beside the documents their links point at.
        const changed = new Set([...created, ...updated]);
        if (ontology && changed.size) {
            const incoming = [...files.values()].map((file) => file.document);
            const targets = new Set(incoming.flatMap((document) => document.links.map((link) => link.target)));
            const replaced = new Set([...files.keys(), ...removed]);
            const beside = workspace.documents.flatMap((entry) => (entry.document && targets.has(entry.document.id) && !replaced.has(entry.path) ? [entry.document] : []));
            const validated = validateDocuments([...incoming, ...beside], ontology).filter((d) => d.path !== undefined && changed.has(d.path));
            diagnostics.push(...validated.map((d) => toPush(d, d.path)));
        }
        if (hasErrors(diagnostics))
            return { ok: false, dryRun, created: [], updated: [], unchanged: [], removed: [], diagnostics };
        const result = { ok: true, dryRun, created, updated, unchanged, removed, diagnostics };
        if (dryRun)
            return result;
        const now = (options.now ?? (() => new Date()))().toISOString();
        for (const path of removed)
            await removeFile(absolute(resolved, path));
        for (const path of changed)
            await writeText(absolute(resolved, path), files.get(path).raw);
        const gone = new Set([...removed, ...changed]);
        await writePushed(workspace, [
            ...pushed.filter((record) => !gone.has(record.path)),
            ...[...changed].map((path) => ({ path, checkout: input.checkout, pushedBy: writer.label, pushedAt: now }))
        ]);
        return result;
    });
}
