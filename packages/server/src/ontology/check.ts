/** Moved to docket's workspace core (workspace/ontology/check), which docket's local MCP server writes through too; re-exported for the server core. */
export {
  type CheckResult,
  type DraftCheck,
  type Disposition,
  DISPOSITIONS,
  type Unresolved,
  type Disposed,
  diagnosticKey,
  breakingChange,
  classify,
  compare,
  parseDraft,
  type WorkspaceSnapshot,
  type StoredDocument,
  type Rewrite,
  type Evaluation,
  evaluateDraft,
  checkDraft
} from '../docket.js'
