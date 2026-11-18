/*
 * What the workspace core reads documents and ontologies with: docket's own
 * parser, ontology loader and validator, so a write, a change check or an MCP
 * tool validates exactly as `docket validate` does, whichever store holds the
 * documents.
 */

import { parseOntology as docketParseOntology, type LoadedOntology } from '../ontology/loader.js'

export type { MemoryDocument, Ontology, Diagnostic } from '../model/index.js'
export { EVIDENCE_LOCATION_FIELDS } from '../model/index.js'
export { InvalidArgumentsError } from '../mcp/errors.js'
export { parseMemoryFile } from '../source/parser.js'
export { validateDocuments } from '../ontology/validator.js'

/** Where a workspace's ontology appears to live, so diagnostics read as they would in a repo. */
export const ONTOLOGY_PATH = '.docket/entities.yaml'

/** docket's `parseOntology`, reading the text as the workspace's ontology. Never throws. */
export function parseOntology(raw: string): LoadedOntology {
  return docketParseOntology(raw, ONTOLOGY_PATH)
}
