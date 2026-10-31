import { loadConfig } from '../config/loader.js';
import { loadOntology } from '../ontology/loader.js';
const admits = (constraint, type) => constraint === '*' || constraint.includes(type);
/** Read the repository's registry for inspection (spec §41). Never throws for content. */
export const ontology = async (options = {}) => {
    const resolved = await loadConfig(options.cwd ?? process.cwd());
    const loaded = await loadOntology(resolved);
    return { ...loaded, path: resolved.ontologyPath };
};
/** Relationships `type` may declare, for `docket ontology show <type>`. */
export const relationshipsFrom = (registry, type) => Object.entries(registry.relationships)
    .filter(([, definition]) => admits(definition.from, type))
    .map(([name, definition]) => ({ name, ...definition }));
/** Relationships that may point at `type`. */
export const relationshipsTo = (registry, type) => Object.entries(registry.relationships)
    .filter(([, definition]) => admits(definition.to, type))
    .map(([name, definition]) => ({ name, ...definition }));
