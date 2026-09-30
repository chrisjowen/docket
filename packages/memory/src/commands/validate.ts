import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import type { Diagnostic, MemoryDocument, Ontology } from '../model/index.js'
import { loadOntology } from '../ontology/loader.js'
import { validateDocuments } from '../ontology/validator.js'
import { scanSource } from '../source/scanner.js'

export interface ValidateOptions {
  /** Directory to resolve `.memory.yaml` from. Defaults to the working directory. */
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
  diagnostics: Diagnostic[]
}

/**
 * One read-only pass: scan, load the ontology, validate (spec §40). Writes
 * nothing. `sync` and `rebuild` build on this - it is the whole front half of
 * their algorithm (spec §38, §39).
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
  if (loaded.ontology) {
    diagnostics.push(
      ...validateDocuments(scan.documents, loaded.ontology, {
        strict: options.strict ?? false
      })
    )
  }

  return {
    resolved,
    ontology: loaded.ontology,
    documents: scan.documents,
    diagnostics
  }
}
