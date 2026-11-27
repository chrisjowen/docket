// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one place docket-cloud reaches into docket's core: its ports, document
 * parser, ontology loader, validator, aggregation and hashing, so the cloud
 * validates exactly as `docket validate` does (§6.1, §13.5) and never invents
 * a second rule. All of it is docket's public API.
 */
import { memoryConfigSchema, parseOntology as docketParseOntology } from '@chrisjowen/docket'
import type { LoadedOntology, ResolvedConfig } from '@chrisjowen/docket'

export type {
  AdapterManifest,
  CanonicalDocument,
  CanonicalRead,
  CanonicalSource,
  LoadedOntology,
  ManifestStore,
  MemoryDocument,
  MemoryEntity,
  Ontology,
  ResolvedConfig,
  UnreadableDocument,
  ValidateResult,
  ValidationDiagnostic as Diagnostic,
  ConfidenceModel,
  Explanation,
  PeopleDirectory,
  SourceRegistry,
  SourceTypeDefinition,
  Subject,
} from '@chrisjowen/docket'
export {
  ATTRIBUTE_TYPES,
  EVIDENCE_LOCATION_FIELDS,
  FALLBACK_ICON,
  ICON_NAMES,
  aggregate,
  assess,
  bandOf,
  confidenceModel,
  explain,
  findPerson,
  hashContent,
  parseMemoryFile,
  readCanonical,
  validateDocuments,
} from '@chrisjowen/docket'
export { writeDiagnostics } from '@chrisjowen/docket/workspace'

/** Where a workspace's documents appear to live, so paths and diagnostics read as they would in a repo. */
export const CLOUD_ONTOLOGY_PATH = '.docket/entities.yaml'

/**
 * The configuration a cloud workspace is read under. It names no adapters:
 * the cloud never loads adapter modules named in customer config (§6.4); the
 * worker registers its own instances.
 */
export function cloudResolvedConfig(workspaceId: string): ResolvedConfig {
  const projectRoot = `/workspaces/${workspaceId}`
  return {
    config: memoryConfigSchema.parse({ version: 2, adapters: [] }),
    projectRoot,
    memoryRoot: `${projectRoot}/.docket`,
    ontologyPath: CLOUD_ONTOLOGY_PATH,
  }
}

/** docket's `parseOntology`, reading the text as a workspace's ontology unless told another path. Never throws. */
export function parseOntology(raw: string, path: string = CLOUD_ONTOLOGY_PATH): LoadedOntology {
  return docketParseOntology(raw, path)
}
