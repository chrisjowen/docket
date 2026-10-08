import { ollamaModelSchema } from '@docket/adapter-kit'
import { z } from 'zod'

/**
 * A Neo4j graph of the documents and their links. The password is read from the
 * environment, never from the file; with `passwordEnv` unset the driver
 * connects without auth, as a local `NEO4J_AUTH=none` server expects.
 */
export const neo4jConfigSchema = z.object({
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

export type Neo4jConfig = z.infer<typeof neo4jConfigSchema>
