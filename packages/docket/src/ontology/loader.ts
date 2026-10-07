import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

import type { ResolvedConfig } from '../config/config.js'
import { confidenceModel } from '../evidence/confidence.js'
import {
  type ConfidenceRules,
  type Diagnostic,
  type Ontology,
  error,
  ontologySchema,
  warning
} from '../model/index.js'
import { FALLBACK_ICON, isIconName } from './icons.js'

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

  return {
    ontology: parsed.data,
    diagnostics: [...checkConfidenceRules(parsed.data, path), ...checkIcons(parsed.data, path)]
  }
}

/**
 * A `confidence:` rule for a source kind that is not registered can never
 * apply - most likely a typo, so it is worth a warning.
 */
const checkConfidenceRules = (ontology: Ontology, path: string): Diagnostic[] => {
  const sources = confidenceModel(ontology).sources
  const check = (section: string, definitions: Record<string, { confidence?: ConfidenceRules }>) =>
    Object.entries(definitions).flatMap(([name, definition]) =>
      Object.keys(definition.confidence ?? {})
        .filter((source) => !(source in sources))
        .map((source) =>
          warning(
            'unknown-evidence-source',
            `${section}.${name}.confidence names source "${source}", which is not registered under evidence.sources.`,
            { path }
          )
        )
    )
  return [
    ...check('resourceTypes', ontology.resourceTypes),
    ...check('relationships', ontology.relationships)
  ]
}

/** An icon the UI does not bundle cannot be drawn, so the type falls back to a generic one. */
const checkIcons = (ontology: Ontology, path: string): Diagnostic[] =>
  Object.entries(ontology.resourceTypes)
    .filter(([, definition]) => definition.icon !== undefined && !isIconName(definition.icon))
    .map(([name, definition]) =>
      warning(
        'unknown-icon',
        `resourceTypes.${name}.icon "${definition.icon}" is not an icon docket bundles; it is drawn as "${FALLBACK_ICON}".`,
        { path }
      )
    )
