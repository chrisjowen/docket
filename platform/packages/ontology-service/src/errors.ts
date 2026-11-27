// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ontology change errors (§13.4, §13.5) are docket's, so a check docket
 * runs throws the classes the cloud catches.
 */
export {
  BREAKING_CODES,
  MigrationInvalid,
  OntologyBreakingChange,
  OntologyInvalid,
  OntologyNarrowingChange,
  OntologyWriteDisabled,
  StaleDraft,
  VersionNotFound,
  isBreaking,
} from '@chrisjowen/docket/workspace'
