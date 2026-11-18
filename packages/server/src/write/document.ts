/** Moved to docket's workspace core (workspace/write/document), which docket's local MCP server writes through too; re-exported for the server core. */
export {
  splitDocument,
  renderDocument,
  type ResourceChange,
  type EvidenceGroup,
  type ComposedDocument,
  composeDocument,
  sameMeaning,
  appendedNotes
} from '../docket.js'
