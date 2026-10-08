import { entityProjectionDefinition, packageVersion } from '@docket/adapter-kit'

import { neo4jConfigSchema, type Neo4jConfig } from './config.js'
import { createNeo4jProjection } from './neo4j-projection.js'

export { neo4jConfigSchema, type Neo4jConfig } from './config.js'
export { createNeo4jProjection, type Neo4jProjectionDependencies } from './neo4j-projection.js'

/**
 * The Neo4j adapter: entities as typed nodes and relationships, searched
 * full-text or through generated read-only Cypher. `neo4j-driver` is loaded
 * when an instance is created, so importing this module needs no driver.
 */
const definition = entityProjectionDefinition<Neo4jConfig>({
  name: 'neo4j',
  version: packageVersion(new URL('../package.json', import.meta.url)),
  rebuild: 'deterministic',
  validateConfig: (input) => neo4jConfigSchema.parse(input),
  createProjection: (config) => createNeo4jProjection(config)
})

export default definition
