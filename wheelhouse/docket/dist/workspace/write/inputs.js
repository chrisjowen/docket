/*
 * Structured writes: `docket_remember` and the other write tools, and a web
 * app's capture forms, all write through the same path. A write is rendered
 * as a docket Markdown document, validated against the published ontology
 * head inside the transaction it commits in, and stored with its evidence
 * stamped with who wrote it. The validator is docket's own; on top of it,
 * every write carries evidence. These are its inputs and its answer.
 */
/** Server-side write limits. */
export const WRITE_LIMITS = {
    evidencePerCall: 50,
    linksPerResource: 100,
    reasonLength: 500
};
