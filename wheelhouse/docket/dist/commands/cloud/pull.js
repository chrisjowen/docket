import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { writeFileAtomic } from '../../bundled/adapter-kit/dist/index.js';
import { cloudOntology, listDocuments } from '../../cloud/client.js';
import { linkedWorkspace } from '../../cloud/credentials.js';
import { requireCloudLink } from '../../cloud/project.js';
import { hashContent } from '../../source/hashing.js';
/**
 * Brings the linked workspace down for an offline copy: its published
 * ontology to the project's ontology file, and - asked for - the documents
 * written in the cloud to their paths under the source root. A local file
 * with other contents is kept, never overwritten.
 */
export const cloudPull = async (options = {}) => {
    const { resolved, link } = await requireCloudLink(options.cwd ?? process.cwd());
    const workspace = linkedWorkspace(link, { store: options.store, env: options.env });
    const wantOntology = options.ontology === true || options.resources !== true;
    const result = { workspace: workspace.label };
    if (wantOntology) {
        const cloud = await cloudOntology(workspace);
        const current = existsSync(resolved.ontologyPath) ? await readFile(resolved.ontologyPath, 'utf8') : undefined;
        const changed = current === undefined || hashContent(current) !== hashContent(cloud.yaml);
        if (changed)
            await writeFileAtomic(resolved.ontologyPath, cloud.yaml);
        result.ontology = { version: cloud.version, path: relative(resolved.projectRoot, resolved.ontologyPath).split(sep).join('/'), changed };
    }
    if (options.resources === true) {
        const resources = { written: [], unchanged: [], kept: [], refused: [] };
        const root = resolved.memoryRoot + sep;
        for (const document of await listDocuments(workspace, { origin: 'cloud', raw: true })) {
            const target = resolve(resolved.projectRoot, document.path);
            if (isAbsolute(document.path) || !target.startsWith(root) || !target.endsWith('.md') || document.raw === undefined) {
                resources.refused.push(document.path);
                continue;
            }
            if (existsSync(target)) {
                const raw = await readFile(target, 'utf8');
                (hashContent(raw) === hashContent(document.raw) ? resources.unchanged : resources.kept).push(document.path);
                continue;
            }
            await writeFileAtomic(target, document.raw);
            resources.written.push(document.path);
        }
        result.resources = resources;
    }
    return result;
};
