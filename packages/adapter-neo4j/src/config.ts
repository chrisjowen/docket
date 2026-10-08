import { ollamaModelSchema } from '@docket/adapter-kit'
import { z } from 'zod'

/**
 * A Neo4j graph of the documents and their links. The password is read from the
 * environment, never from the file; with `passwordEnv` unset the driver
 * connects without auth, as a local `NEO4J_AUTH=none` server expects.
 *
 * The connection URI is `uri`, the driver's own name for it, or `url`, its
 * name in v1 `projections` entries; either takes any scheme the driver does
 * (`bolt`, `neo4j`, `neo4j+s`, ...).
 */
export const neo4jConfigSchema = z.preprocess(
  (value, context) => {
    if (value === null || typeof value !== 'object' || !('uri' in value)) return value
    if ('url' in value) {
      context.addIssue({ code: 'custom', path: ['uri'], message: 'set uri or url, not both: they are one setting' })
      return value
    }
    const { uri, ...rest } = value as { uri: unknown }
    return { ...rest, url: uri }
  },
  z.strictObject({
    type: z.literal('neo4j').default('neo4j'),
    url: z.string().default('bolt://localhost:7687'),
    database: z.string().min(1).optional(),
    username: z.string().default('neo4j'),
    passwordEnv: z.string().min(1).optional(),
    /** Every node carries this, so checkouts can share one database. Defaults to one unique to the checkout. */
    scope: z.string().min(1).optional(),
    /**
     * Answer searches by having a local Ollama model write a read-only Cypher
     * query against the graph's schema. Without it, search is full-text only.
     */
    cypher: ollamaModelSchema.optional()
  })
)

export type Neo4jConfig = z.infer<typeof neo4jConfigSchema>
