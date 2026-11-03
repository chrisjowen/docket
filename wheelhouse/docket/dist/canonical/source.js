import { readFile } from 'node:fs/promises';
import { error } from '../model/diagnostic.js';
import { parseOntology, unreadableOntology } from '../ontology/loader.js';
import { hashContent } from '../source/hashing.js';
import { parseMemoryFile } from '../source/parser.js';
import { sourceFiles } from '../source/scanner.js';
/**
 * The project's own files: every file `source` includes under the memory
 * root, and the ontology at `ontologyPath`, read afresh on each call.
 */
export const filesystemSource = (resolved) => ({
    resolved,
    async ontology() {
        const text = await readFile(resolved.ontologyPath, 'utf8');
        return { text, revision: hashContent(text) };
    },
    async *documents() {
        for (const { absolute, path } of await sourceFiles(resolved)) {
            let raw;
            try {
                raw = await readFile(absolute, 'utf8');
            }
            catch (cause) {
                yield { path, error: cause instanceof Error ? cause.message : String(cause) };
                continue;
            }
            yield { path, raw, hash: hashContent(raw) };
        }
    }
});
/**
 * Reads a source once: its documents parsed, in path order whatever order
 * the source gave them in, so the same documents always read alike (spec
 * §72), and its ontology loaded. Never throws for a document or an ontology
 * it cannot read: each is a diagnostic, as the scanner and loader report it.
 */
export const readCanonical = async (source) => {
    const ontologyPath = source.resolved.ontologyPath;
    const ontology = source.ontology().then(({ text }) => parseOntology(text, ontologyPath), (cause) => unreadableOntology(cause, ontologyPath));
    const read = [];
    for await (const document of source.documents())
        read.push(document);
    read.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const documents = [];
    const diagnostics = [];
    const files = new Map();
    for (const document of read) {
        if (!('raw' in document)) {
            diagnostics.push(error('unreadable-file', document.error, { path: document.path }));
            continue;
        }
        files.set(document.path, document.raw);
        const result = parseMemoryFile(document.raw, document.path);
        diagnostics.push(...result.diagnostics);
        if (result.document)
            documents.push(result.document);
    }
    return { documents, diagnostics, files, ontology: await ontology };
};
