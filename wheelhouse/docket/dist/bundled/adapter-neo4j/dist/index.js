import { entityProjectionDefinition, packageVersion, parseAdapterConfig } from '../../adapter-kit/dist/index.js';
import { neo4jConfigSchema } from './config.js';
import { createNeo4jProjection } from './neo4j-projection.js';
export { neo4jConfigSchema } from './config.js';
export { createNeo4jProjection } from './neo4j-projection.js';
/**
 * The Neo4j adapter: entities as typed nodes and relationships, searched
 * full-text or through generated read-only Cypher. `neo4j-driver` is loaded
 * when an instance is created, so importing this module needs no driver.
 */
const definition = entityProjectionDefinition({
    name: 'neo4j',
    version: packageVersion(new URL('../package.json', import.meta.url)),
    rebuild: 'deterministic',
    validateConfig: (input) => parseAdapterConfig(neo4jConfigSchema, input),
    createProjection: (config) => createNeo4jProjection(config)
});
export default definition;
