/**
 * Where a stored document came from: written through the server (`cloud`),
 * synced from a repository (`repo`), or pushed with docket's CLI (`cli`). A
 * repo or CLI document changes at its source, never in place on the server.
 */
export type Origin = 'repo' | 'cloud' | 'cli'
