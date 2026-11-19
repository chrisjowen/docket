/*
 * The one place the server core reaches into docket: its document parser,
 * ontology loader and validator, so a server validates exactly as `docket
 * validate` does and never invents a second rule, and the workspace core and
 * MCP surface docket's own local MCP server shares - how a write becomes a
 * document, the ontology's change check, and every tool's definition,
 * argument checks and answers - so every Docket MCP server offers the same
 * tools. All of it is docket's public API, and `@chrisjowen/docket` is a peer
 * dependency, so the core validates with the host's own docket.
 */

import { parseOntology as docketParseOntology, type LoadedOntology } from '@chrisjowen/docket'

export type {
  AdapterManifest,
  CanonicalSource,
  ManifestStore,
  MemoryDocument,
  Ontology,
  ResolvedConfig,
  ValidationDiagnostic as Diagnostic
} from '@chrisjowen/docket'
export {
  EMPTY_DIRECTORY,
  EVIDENCE_LOCATION_FIELDS,
  findPerson,
  peopleDirectorySchema,
  type PeopleDirectory,
  InvalidArgumentsError,
  hashContent,
  memoryConfigSchema,
  parseMemoryFile,
  readCanonical,
  validateDocuments
} from '@chrisjowen/docket'

export * from '@chrisjowen/docket/workspace'
export * from '@chrisjowen/docket/mcp/surface'

/** Where a server's ontology appears to live, so diagnostics read as they would in a repo. */
export const ONTOLOGY_PATH = '.docket/entities.yaml'

/** docket's `parseOntology`, reading the text as the workspace's ontology. Never throws. */
export function parseOntology(raw: string): LoadedOntology {
  return docketParseOntology(raw, ONTOLOGY_PATH)
}
