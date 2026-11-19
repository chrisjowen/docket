import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

import type { ResolvedConfig } from '../config/config.js'
import { builtinOntology, policyConditions } from '../evidence/confidence.js'
import { hasLegacyTrust, usesTrustSettings, withTrustSettings } from '../evidence/legacy.js'
import {
  type Diagnostic,
  type Ontology,
  EVIDENCE_LOCATION_FIELDS,
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

/** Why an ontology file at `path` could not be read: missing, or unreadable. */
export const unreadableOntology = (cause: unknown, path: string): LoadedOntology =>
  (cause as NodeJS.ErrnoException).code === 'ENOENT'
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
    return unreadableOntology(cause, path)
  }
  return parseOntology(raw, path)
}

/** Validate the ontology registry's text, read from `path`. Never throws. */
export const parseOntology = (raw: string, path: string): LoadedOntology => {
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

  const ontology = withTrustSettings(parsed.data, builtinOntology())
  return {
    ontology,
    diagnostics: [...checkLegacyTrust(parsed.data, path), ...checkTrust(ontology, path), ...checkIcons(ontology, path)]
  }
}

/**
 * Legacy evidence settings still score as they did, read as sources and
 * policies; `docket ontology convert` writes them in that form.
 */
const checkLegacyTrust = (ontology: Ontology, path: string): Diagnostic[] => {
  if (!hasLegacyTrust(ontology)) return []
  return usesTrustSettings(ontology)
    ? [
        warning(
          'legacy-evidence-ignored',
          'The ontology gives sources: or trust:, so its legacy evidence: block and confidence: rules are not used; remove them.',
          { path }
        )
      ]
    : [
        warning(
          'legacy-evidence-settings',
          'evidence: and confidence: rules are the legacy form; they are read as sources: and trust: policies and score as before. Run `docket ontology convert` to rewrite them.',
          { path }
        )
      ]
}

/** What a source type lets an observation point with: its own locator fields and the legacy ones. */
const locatorFields = (definition: { locator?: Record<string, unknown> }): Set<string> =>
  new Set([...EVIDENCE_LOCATION_FIELDS, ...Object.keys(definition.locator ?? {})])

/**
 * Sources and policies that cannot work as written: a policy naming a source,
 * subject, attribute or locator field the ontology does not have never
 * applies, and two policies with the same conditions and different scores
 * tie - the lower one wins, which is likely not what was meant.
 */
const checkTrust = (ontology: Ontology, path: string): Diagnostic[] => {
  const out: Diagnostic[] = []
  const where = { path }
  const sources = ontology.sources ?? {}

  for (const [name, definition] of Object.entries(sources)) {
    const fields = locatorFields(definition)
    for (const [list, names] of [['identifiedBy', definition.identifiedBy], ['requiresAny', definition.requiresAny]] as const) {
      for (const field of names ?? []) {
        if (!fields.has(field)) {
          out.push(warning('unknown-locator-field', `sources.${name}.${list} names "${field}", which is not one of its locator fields.`, where))
        }
      }
    }
  }

  const subjects = new Set([...Object.keys(ontology.resourceTypes), ...Object.keys(ontology.relationships)])
  const names = new Set<string>()
  const scores = new Map<string, { name: string; score: number }>()
  for (const policy of ontology.trust?.policies ?? []) {
    const at = `trust.policies "${policy.name}"`
    if (names.has(policy.name)) out.push(warning('duplicate-policy-name', `${at}: another policy has this name; give each its own.`, where))
    names.add(policy.name)

    const source = sources[policy.when.source]
    if (!source) {
      out.push(warning('unknown-evidence-source', `${at} names source "${policy.when.source}", which is not registered under sources.`, where))
    }
    if (policy.when.about !== undefined && !subjects.has(policy.when.about) && policy.when.about !== 'supersedes') {
      out.push(warning('unknown-policy-subject', `${at} is about "${policy.when.about}", which is not a resource type or relationship.`, where))
    }
    if (source) {
      const fields = locatorFields(source)
      for (const [key] of policyConditions(policy)) {
        const known = key.startsWith('@') ? fields.has(key.slice(1)) : key in (source.attributes ?? {})
        if (!known) {
          out.push(
            warning(
              'unknown-policy-condition',
              `${at} tests "${key}", which is not ${key.startsWith('@') ? 'a locator field' : 'an attribute'} of source "${policy.when.source}".`,
              where
            )
          )
        }
      }
    }

    if (policy.score === undefined) continue
    const key = JSON.stringify(Object.entries(policy.when).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    const twin = scores.get(key)
    if (twin && twin.score !== policy.score) {
      out.push(
        warning(
          'tied-policies',
          `${at} and "${twin.name}" apply to the same observations with different scores; the lower, ${Math.min(twin.score, policy.score)}, wins.`,
          where
        )
      )
    } else if (!twin) scores.set(key, { name: policy.name, score: policy.score })
  }
  return out
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
