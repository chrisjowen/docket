/**
 * Where a stored document came from: written through the server (`cloud`),
 * synced from a repository (`repo`), pushed with docket's CLI (`cli`), or one
 * of the project's own files, read and written in place by docket's local MCP
 * server (`local`). A repo or CLI document changes at its source, never in
 * place on the server.
 */
export type Origin = 'repo' | 'cloud' | 'cli' | 'local'

/** Whether the store that holds a document may rewrite it in place: its own documents, not a repo's or a CLI push's. */
export const writableHere = (origin: Origin): boolean => origin === 'cloud' || origin === 'local'
