import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stableStringify } from '../bundled/adapter-kit/dist/index.js';
import { hashContent } from '../source/hashing.js';
/** Bumped whenever the entry or its key changes shape, so older answers are never misread. */
const CACHE_VERSION = 2;
/** Case and spacing do not make a different question. */
export const normalizeQuestion = (question) => question.trim().replace(/\s+/g, ' ').toLowerCase();
/**
 * What a summary depends on (docs/adapter-spec.md §10): the question and how
 * it was read, each adapter's configuration, checkpoint and answer, the source
 * revisions of the exhibits and evidence, the paths connecting them, the model
 * and its instructions. A change to any gives a different key, and so a miss.
 */
export const summaryKey = (question, model, inputs) => hashContent(stableStringify({
    version: CACHE_VERSION,
    question: normalizeQuestion(question),
    context: inputs.context ?? null,
    model: model.model,
    instructions: model.instructions,
    adapters: inputs.adapters ?? [],
    exhibits: [...inputs.exhibits].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    sources: inputs.sources ?? [],
    paths: inputs.paths
}));
/** Where answers are kept: inside the docket, disposable and gitignored like `.index`. */
export const summaryCacheDir = (memoryRoot) => join(memoryRoot, '.cache', 'chat');
/** One file per question, so a stale answer is replaced rather than piling up beside the new one. */
const fileFor = (dir, question) => join(dir, `${hashContent(normalizeQuestion(question)).slice('sha256:'.length)}.json`);
/** The answer kept for this question, when it was built from exactly what `key` describes. */
export const readCachedSummary = async (dir, question, key) => {
    try {
        const entry = JSON.parse(await readFile(fileFor(dir, question), 'utf8'));
        return entry.key === key && typeof entry.text === 'string' && Array.isArray(entry.cited)
            ? entry
            : null;
    }
    catch {
        // Missing, half-written or hand-mangled: all just a miss.
        return null;
    }
};
export const writeCachedSummary = async (dir, entry) => {
    await mkdir(dir, { recursive: true });
    const file = fileFor(dir, entry.question);
    // Written aside and renamed, so a concurrent read never sees half a file.
    const partial = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(partial, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await rename(partial, file);
};
