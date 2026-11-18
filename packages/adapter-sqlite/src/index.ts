import { entityProjectionDefinition, packageVersion, parseAdapterConfig } from '@docket/adapter-kit'

import { sqliteConfigSchema, type SqliteConfig } from './config.js'
import { createSqliteProjection } from './sqlite-projection.js'

export { sqliteConfigSchema, type SqliteConfig } from './config.js'
export { createSqliteProjection, type SqliteProjectionDependencies } from './sqlite-projection.js'

/**
 * The SQLite adapter: entities and their links in one SQLite file, which
 * needs no server, searched by FTS5 full-text - and, with an embedder, by
 * meaning - and answered with the paths from each match through the links.
 * `better-sqlite3` is loaded when an instance is created, so importing this
 * module needs no driver.
 */
const definition = entityProjectionDefinition<SqliteConfig>({
  name: 'sqlite',
  version: packageVersion(new URL('../package.json', import.meta.url)),
  rebuild: 'deterministic',
  validateConfig: (input) => parseAdapterConfig(sqliteConfigSchema, input),
  createProjection: (config, services) => createSqliteProjection(config, services.stateRoot)
})

export default definition
