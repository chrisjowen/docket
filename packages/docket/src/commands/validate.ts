import { filesystemSource, readCanonical, type CanonicalSource } from '../canonical/source.js'
import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { aggregate } from '../evidence/aggregate.js'
import { confidenceModel } from '../evidence/confidence.js'
import type { Diagnostic, MemoryDocument, MemoryEntity, Ontology } from '../model/index.js'
import { validateDocuments } from '../ontology/validator.js'

export interface ValidateOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  cwd?: string | undefined
  /** Where the documents and ontology come from, instead of the files under `cwd`. */
  source?: CanonicalSource | undefined
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
  /** Each document's raw text, by path, as it was read. */
  files: ReadonlyMap<string, string>
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
  const source = options.source ?? filesystemSource(await loadConfig(options.cwd ?? process.cwd()))
  const { documents, diagnostics: read, files, ontology: loaded } = await readCanonical(source)

  const diagnostics = [...read, ...loaded.diagnostics]
  const result: ValidateResult = {
    resolved: source.resolved,
    ontology: loaded.ontology,
    documents,
    entities: [],
    broken: new Set(errorPaths(diagnostics)),
    diagnostics,
    files
  }
  if (!loaded.ontology) return result

  diagnostics.push(
    ...validateDocuments(documents, loaded.ontology, {
      strict: options.strict ?? false
    })
  )
  const broken = new Set(errorPaths(diagnostics))
  const merged = aggregate(
    documents.filter((document) => !broken.has(document.path)),
    confidenceModel(loaded.ontology)
  )
  diagnostics.push(...merged.diagnostics)

  return {
    ...result,
    entities: merged.entities,
    broken: new Set(errorPaths(diagnostics))
  }
}
