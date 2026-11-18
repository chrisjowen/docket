import { entityProjectionDefinition, packageVersion, parseAdapterConfig } from '../../adapter-kit/dist/index.js';
import { postgresConfigSchema } from './config.js';
import { createPostgresProjection } from './postgres-projection.js';
export { postgresConfigSchema } from './config.js';
export { createPostgresProjection } from './postgres-projection.js';
/**
 * The Postgres adapter: entities and their links in tables of its own in
 * Postgres 16 or later, searched by full-text and title trigrams - and, with
 * pgvector and an embedder, by meaning - and answered with the paths from
 * each match through the links. `pg` is loaded when an instance is created,
 * so importing this module needs no driver.
 */
const definition = entityProjectionDefinition({
    name: 'postgres',
    version: packageVersion(new URL('../package.json', import.meta.url)),
    rebuild: 'deterministic',
    validateConfig: (input) => parseAdapterConfig(postgresConfigSchema, input),
    createProjection: (config) => createPostgresProjection(config)
});
export default definition;
