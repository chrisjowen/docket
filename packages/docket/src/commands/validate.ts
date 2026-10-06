import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { aggregate } from '../evidence/aggregate.js'
import { confidenceModel } from '../evidence/confidence.js'
import type { Diagnostic, MemoryDocument, MemoryEntity, Ontology } from '../model/index.js'
import { loadOntology } from '../ontology/loader.js'
import { validateDocuments } from '../ontology/validator.js'
import { scanSource } from '../source/scanner.js'

export interface ValidateOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  cwd?: string | undefined
  /** Promote dangling references to errors (spec §17, §40). */
  strict?: boolean | undefined
}

export interface ValidateResult {
  resolved: ResolvedConfig
  /** `null` when the ontology could not be loaded - then nothing was validated. */
  ontology: Ontology | null
  /** Every document that parsed, in path order. */
  documents: MemoryDocument[]
  /**
   * The valid documents merged one per id, with confidence computed. Empty
   * when the ontology could not be loaded.
   */
  entities: MemoryEntity[]
  /** Paths with at least one error. Their documents are not in `entities`. */
  broken: ReadonlySet<string>
  diagnostics: Diagnostic[]
}

const errorPaths = (diagnostics: readonly Diagnostic[]): string[] =>
  diagnostics.flatMap((d) => (d.severity === 'error' && d.path !== undefined ? [d.path] : []))

/**
 * One read-only pass: scan, load the ontology, validate, aggregate (spec §40).
 * Writes nothing. `sync` and `rebuild` build on this - it is the whole front
 * half of their algorithm (spec §38, §39).
 *
 * Diagnostics are returned, never printed; only the CLI prints.
 */
export const validate = async (
  options: ValidateOptions = {}
): Promise<ValidateResult> => {
  const resolved = await loadConfig(options.cwd ?? process.cwd())
  const [scan, loaded] = await Promise.all([
    scanSource(resolved),
    loadOntology(resolved)
  ])

  const diagnostics = [...scan.diagnostics, ...loaded.diagnostics]
  const result: ValidateResult = {
    resolved,
    ontology: loaded.ontology,
    documents: scan.documents,
    entities: [],
    broken: new Set(errorPaths(diagnostics)),
    diagnostics
  }
  if (!loaded.ontology) return result

  diagnostics.push(
    ...validateDocuments(scan.documents, loaded.ontology, {
      strict: options.strict ?? false
    })
  )
  const broken = new Set(errorPaths(diagnostics))
  const merged = aggregate(
    scan.documents.filter((document) => !broken.has(document.path)),
    confidenceModel(loaded.ontology)
  )
  diagnostics.push(...merged.diagnostics)

  return {
    ...result,
    entities: merged.entities,
    broken: new Set(errorPaths(diagnostics))
  }
}
