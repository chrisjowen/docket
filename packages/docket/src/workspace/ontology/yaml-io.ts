import { parseOntology, type Diagnostic, type Ontology } from '../docket.js'

/** The largest ontology accepted: docket's SDLC ontology is about 90 KB. */
export const MAX_ONTOLOGY_BYTES = 512 * 1024

/** Why a text is too large to be an ontology; null when it is not. */
export function sizeProblem(text: string): Diagnostic | null {
  if (Buffer.byteLength(text, 'utf8') <= MAX_ONTOLOGY_BYTES) return null
  return { severity: 'error', code: 'ontology-too-large', message: `An ontology holds at most ${MAX_ONTOLOGY_BYTES / 1024} KB.` }
}

/** The first line of every export: `# docket-cloud: acme/platform ontology v14 (sha256:…)`. */
const HEADER = /^# docket-cloud: [^\n]* ontology v\d+ \(sha256:[0-9a-f]{64}\)\r?\n/

export function exportHeader(parts: { org: string; workspace: string; number: number; hash: string }): string {
  return `# docket-cloud: ${parts.org}/${parts.workspace} ontology v${parts.number} (${parts.hash})\n`
}

/** A version as `entities.yaml`: the header line, then the text exactly as it was published. */
export function exportYaml(parts: { org: string; workspace: string; number: number; hash: string; yaml: string }): string {
  return exportHeader(parts) + parts.yaml
}

/** The text without an earlier export's header, so re-importing an export does not stack headers. */
export function stripHeader(text: string): string {
  return text.replace(HEADER, '')
}

export interface Imported {
  /** The text that will be stored: the file as given, without an export header. */
  yaml: string
  ontology: Ontology | null
  /** YAML and schema errors with their paths, and docket's loader warnings. */
  diagnostics: Diagnostic[]
}

/**
 * Reads an uploaded or pasted `entities.yaml` with docket's loader. The text
 * is kept as it is, comments and all; only the header is dropped.
 */
export function importYaml(text: string): Imported {
  const tooLarge = sizeProblem(text)
  if (tooLarge) return { yaml: text, ontology: null, diagnostics: [tooLarge] }
  const yaml = stripHeader(text)
  const loaded = parseOntology(yaml)
  return { yaml, ontology: loaded.ontology, diagnostics: loaded.ontology ? [...loaded.diagnostics, ...lintOntology(loaded.ontology)] : loaded.diagnostics }
}

/**
 * What docket's loader does not check but an editor should say: a
 * relationship end naming a type the ontology does not have, which no
 * resource can ever satisfy.
 */
export function lintOntology(ontology: Ontology): Diagnostic[] {
  const types = new Set(Object.keys(ontology.resourceTypes))
  const out: Diagnostic[] = []
  for (const [name, relationship] of Object.entries(ontology.relationships)) {
    for (const end of ['from', 'to'] as const) {
      const constraint = relationship[end]
      if (constraint === '*') continue
      for (const type of constraint) {
        if (!types.has(type)) {
          out.push({
            severity: 'warning',
            code: 'unknown-constraint-type',
            message: `relationships.${name}.${end} names type "${type}", which is not a resource type.`
          })
        }
      }
    }
  }
  return out
}
