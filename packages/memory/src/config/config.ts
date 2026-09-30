import { z } from 'zod'

export const fileProjectionConfigSchema = z.object({
  type: z.literal('file'),
  output: z.string().default('.memory/.index')
})

export const projectionConfigSchema = fileProjectionConfigSchema

export type ProjectionConfig = z.infer<typeof projectionConfigSchema>

export const memoryConfigSchema = z.object({
  version: z.literal(1),
  source: z
    .object({
      root: z.string().default('.memory'),
      include: z.array(z.string()).default(['**/*.md']),
      exclude: z.array(z.string()).default(['.index/**'])
    })
    .prefault({}),
  ontology: z
    .object({
      file: z.string().default('.memory/entities.yaml')
    })
    .prefault({}),
  watch: z
    .object({
      debounceMs: z.number().int().positive().default(300)
    })
    .prefault({}),
  projections: z.array(projectionConfigSchema).default([
    { type: 'file', output: '.memory/.index' }
  ])
})

export type MemoryConfig = z.infer<typeof memoryConfigSchema>

/** Config plus the absolute paths every other module resolves against. */
export interface ResolvedConfig {
  config: MemoryConfig
  projectRoot: string
  memoryRoot: string
  ontologyPath: string
}

export const CONFIG_FILENAME = '.memory.yaml'
