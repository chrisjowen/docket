import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SEARCH_LIMIT } from '../commands/search.js';
import { MAX_SEARCH_LIMIT, searchGraph, searchText } from './search.js';
/*
 * docket's MCP server (docs/mcp.md): one tool, `docket_search`, whose result
 * an MCP Apps host (the `io.modelcontextprotocol/ui` extension, stable spec
 * 2026-01-26) draws with the app at `ui://docket/search.html`: the matching
 * resources and their links on the casebook's evidence board. Transport-free:
 * `docket open` serves it over Streamable HTTP at `/mcp`.
 */
/** The protocol versions it speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SEARCH_TOOL = 'docket_search';
export const APP_URI = 'ui://docket/search.html';
export const APP_MIME = 'text/html;profile=mcp-app';
const INSTRUCTIONS = 'This server searches one project\'s docket: its typed knowledge - services, decisions, constraints, owners, ' +
    'dependencies - kept as Markdown under .docket/. Call docket_search before reading the code when asked about ' +
    'the project, and read the canonical files it names for the full record.';
export const searchTool = {
    name: SEARCH_TOOL,
    title: 'Search the docket',
    description: 'Search this project\'s docket - its typed project knowledge (services, decisions, constraints, owners, ' +
        'dependencies) - for the resources that match a query. Returns each match with its canonical file and its ' +
        'links, the paths and relationships the projections returned with why they hold, and draws them, with the ' +
        'resources one link away as context, as a graph.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', minLength: 1, description: 'What to look for, in words: a name, a topic or a question.' },
            limit: {
                type: 'integer',
                minimum: 1,
                maximum: MAX_SEARCH_LIMIT,
                default: DEFAULT_SEARCH_LIMIT,
                description: 'Hits asked of each projection.'
            },
            project: {
                type: 'string',
                description: 'The project the host means, such as the Wheelhouse project id it routes the call by. Each server searches one docket, so it is not used.'
            }
        },
        required: ['query'],
        additionalProperties: false
    },
    annotations: { title: 'Search the docket', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: APP_URI } }
};
const appResource = {
    uri: APP_URI,
    name: 'docket-search',
    title: 'Docket search',
    description: 'The resources a docket search found, and their links, on the casebook\'s evidence board.',
    mimeType: APP_MIME
};
/** The app's `_meta.ui`: it needs no network, so it declares no origins. */
const APP_META = { ui: { prefersBorder: true } };
/** JSON-RPC's error codes. */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const RESOURCE_NOT_FOUND = -32002;
class RpcError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** docket's own version, for `serverInfo`. */
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
/** Where the build puts the app: `dist/mcp-app/search.html`, next to `dist/mcp`. */
export const defaultAppFile = () => join(import.meta.dirname, '..', 'mcp-app', 'search.html');
/** The `docket_search` arguments, checked, or why they will not do. */
const searchArguments = (raw) => {
    const args = raw === undefined ? {} : raw;
    if (!isObject(args))
        throw new RpcError(INVALID_PARAMS, 'docket_search takes { "query": "...", "limit"?: n, "project"?: "..." }.');
    const unknown = Object.keys(args).filter((key) => key !== 'query' && key !== 'limit' && key !== 'project');
    if (unknown.length > 0)
        throw new RpcError(INVALID_PARAMS, `docket_search does not take ${unknown.map((key) => `"${key}"`).join(', ')}.`);
    if (args.project !== undefined && typeof args.project !== 'string')
        throw new RpcError(INVALID_PARAMS, 'project must be a string.');
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (query === '')
        throw new RpcError(INVALID_PARAMS, 'Say what to look for: query is empty.');
    const limit = args.limit ?? DEFAULT_SEARCH_LIMIT;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
        throw new RpcError(INVALID_PARAMS, `limit must be a whole number from 1 to ${MAX_SEARCH_LIMIT}.`);
    }
    return { query, limit };
};
/**
 * Answers one JSON-RPC message: the response to a request, or null for a
 * notification. It keeps no session, so every request stands on its own.
 */
export const createMcpServer = (options) => {
    const appFile = options.appFile ?? defaultAppFile();
    const callTool = async (params) => {
        if (params.name !== SEARCH_TOOL)
            throw new RpcError(INVALID_PARAMS, `There is no tool "${String(params.name)}"; the one tool is ${SEARCH_TOOL}.`);
        const { query, limit } = searchArguments(params.arguments);
        try {
            const found = await searchGraph({ cwd: options.cwd, query, limit, viewer: options.viewer });
            return { content: [{ type: 'text', text: searchText(found) }], structuredContent: found };
        }
        catch (cause) {
            // A docket that cannot be read is the tool's answer, for the model to read, not a protocol error.
            return { content: [{ type: 'text', text: `The docket could not be searched: ${cause instanceof Error ? cause.message : String(cause)}` }], isError: true };
        }
    };
    const readApp = async () => {
        let text;
        try {
            text = await readFile(appFile, 'utf8');
        }
        catch {
            throw new Error(`docket's search app is not built (no ${appFile}). Build docket with \`pnpm build\` at the repository root.`);
        }
        return { contents: [{ uri: APP_URI, mimeType: APP_MIME, text, _meta: APP_META }] };
    };
    const answer = async (method, params) => {
        switch (method) {
            case 'initialize': {
                const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
                return {
                    protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                    capabilities: { tools: {}, resources: {} },
                    serverInfo: { name: 'docket', title: 'Docket', version: VERSION },
                    instructions: INSTRUCTIONS
                };
            }
            case 'ping':
                return {};
            case 'tools/list':
                return { tools: [searchTool] };
            case 'tools/call':
                return callTool(params);
            case 'resources/list':
                return { resources: [{ ...appResource, _meta: APP_META }] };
            case 'resources/templates/list':
                return { resourceTemplates: [] };
            case 'resources/read':
                if (params.uri !== APP_URI)
                    throw new RpcError(RESOURCE_NOT_FOUND, `There is no resource ${String(params.uri)}; the one resource is ${APP_URI}.`);
                return readApp();
            default:
                throw new RpcError(METHOD_NOT_FOUND, `docket's MCP server does not answer ${method}.`);
        }
    };
    return {
        async handle(message) {
            if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
                const id = isObject(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
                // A response sent to the server (to a request it never makes) is ignored like a notification.
                if (isObject(message) && message.method === undefined && ('result' in message || 'error' in message))
                    return null;
                return { jsonrpc: '2.0', id, error: { code: INVALID_REQUEST, message: 'Send one JSON-RPC 2.0 request or notification.' } };
            }
            if (message.id === undefined)
                return null;
            const id = message.id;
            if (message.params !== undefined && !isObject(message.params)) {
                return { jsonrpc: '2.0', id, error: { code: INVALID_PARAMS, message: 'params must be an object.' } };
            }
            try {
                return { jsonrpc: '2.0', id, result: await answer(message.method, message.params ?? {}) };
            }
            catch (cause) {
                const code = cause instanceof RpcError ? cause.code : -32603;
                return { jsonrpc: '2.0', id, error: { code, message: cause instanceof Error ? cause.message : String(cause) } };
            }
        }
    };
};
