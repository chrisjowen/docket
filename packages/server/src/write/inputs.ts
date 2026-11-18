/** Moved to docket's workspace core (workspace/write/inputs), which docket's local MCP server writes through too; re-exported for the server core. */
export {
  type EvidenceInput,
  type StampedEvidence,
  type LinkInput,
  type RememberInput,
  type AddEvidenceInput,
  type AppendNotesInput,
  type Channel,
  type Writer,
  type WriteOptions,
  type WriteResult,
  WRITE_LIMITS
} from '../docket.js'
