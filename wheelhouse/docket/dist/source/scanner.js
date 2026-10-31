import { glob, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { error } from '../model/diagnostic.js';
import { parseMemoryFile } from './parser.js';
const matches = async (patterns, cwd) => {
    const found = new Set();
    if (patterns.length === 0)
        return found;
    for await (const match of glob(patterns, { cwd }))
        found.add(match);
    return found;
};
/** Path as recorded on the document: repo-relative and always posix-separated. */
const repoRelative = (projectRoot, absolute) => relative(projectRoot, absolute).split(sep).join('/');
/**
 * Walk the source root and parse every included file. Results are sorted by path so
 * repeated scans - and therefore rebuilt projections - are byte-identical (spec §72).
 */
export const scanSource = async (resolved) => {
    const { source } = resolved.config;
    const [included, excluded] = await Promise.all([
        matches(source.include, resolved.memoryRoot),
        matches(source.exclude, resolved.memoryRoot)
    ]);
    const files = [...included].filter((f) => !excluded.has(f)).sort();
    const documents = [];
    const diagnostics = [];
    for (const file of files) {
        const absolute = join(resolved.memoryRoot, file);
        const path = repoRelative(resolved.projectRoot, absolute);
        let raw;
        try {
            raw = await readFile(absolute, 'utf8');
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            diagnostics.push(error('unreadable-file', message, { path }));
            continue;
        }
        const result = parseMemoryFile(raw, path);
        diagnostics.push(...result.diagnostics);
        if (result.document)
            documents.push(result.document);
    }
    // Several files may declare one id: they are observations of the same
    // resource, merged by aggregation rather than rejected here.
    return { documents, diagnostics };
};
