import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

import type { ResolvedConfig } from '../config/config.js'
import {
  type Diagnostic,
  type Ontology,
  error,
  ontologySchema
} from '../model/index.js'

export interface LoadedOntology {
  /** `null` when the file is missing, unparseable, or fails the schema. */
  ontology: Ontology | null
  diagnostics: Diagnostic[]
}

const fail = (code: string, message: string, path: string): LoadedOntology => ({
  ontology: null,
  diagnostics: [error(code, message, { path })]
})

/**
 * Read and validate the ontology registry. The path always comes from resolved
 * configuration - never hardcode `.docket/entities.yaml`.
 *
 * Never throws: every failure mode is reported as a diagnostic.
 */
export const loadOntology = async (
  config: ResolvedConfig
): Promise<LoadedOntology> => {
  const path = config.ontologyPath

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    return code === 'ENOENT'
      ? fail(
          'ontology-missing',
          `Ontology file not found at ${path}. Run \`docket init\` to create one.`,
          path
        )
      : fail(
          'ontology-unreadable',
          `Could not read ontology file ${path}: ${(cause as Error).message}`,
          path
        )
  }

  let data: unknown
  try {
    data = parseYaml(raw)
  } catch (cause) {
    return fail(
      'ontology-parse-error',
      `Ontology file ${path} is not valid YAML: ${(cause as Error).message}`,
      path
    )
  }

  const parsed = ontologySchema.safeParse(data)
  if (!parsed.success) {
    return {
      ontology: null,
      diagnostics: parsed.error.issues.map((issue) =>
        error(
          'ontology-invalid',
          `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          { path }
        )
      )
    }
  }

  return { ontology: parsed.data, diagnostics: [] }
}
