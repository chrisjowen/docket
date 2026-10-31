/*
 * The wire format of docket's MCP server (docs/mcp.md): what `docket_search`
 * returns as `structuredContent`, which its app (`ui://docket/search.html`,
 * built from docket-ui's src/mcp-app) draws. Defined once, here; the app
 * imports these types.
 */
/** `structuredContent.schema` of a `docket_search` result. */
export const SEARCH_SCHEMA = 'docket-search.v1';
