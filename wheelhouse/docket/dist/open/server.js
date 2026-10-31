import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createMcpServer, INVALID_REQUEST, PARSE_ERROR } from '../mcp/server.js';
import { AskCancelledError, AskRequestError, askProject } from '../query/ask.js';
import { EvidenceRequestError, readEvidenceBody, resolveReferences } from '../query/evidence.js';
import { takeSnapshot } from '../query/snapshot.js';
import { adaptersStatus } from '../query/status.js';
import { ask } from './ask.js';
import { chat } from './chat.js';
import { readGraph } from './graph.js';
import { SyncBusyError, SyncRunner } from './sync-run.js';
/** Tried first so the UI keeps one address between runs; any free port when it is taken. */
export const DEFAULT_PORT = 4380;
export const DEFAULT_ASK_LIMIT = 10;
const MAX_ASK_LIMIT = 50;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8'
};
/**
 * Loopback, so only this machine can reach the UI unless `--host` says
 * otherwise. The API never changes the canonical files - its writes are the
 * summary cache and, when asked from this machine, a sync of the projections -
 * but it serves the repository's knowledge to whoever can reach it, so
 * listening on any other interface is an explicit choice.
 */
export const DEFAULT_HOST = '127.0.0.1';
/** Hosts that listen on every interface: the UI is still addressed through loopback. */
const WILDCARD = new Set(['0.0.0.0', '::']);
/** Addresses a request from this machine arrives from. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** The header carrying the per-launch session token back. */
export const SESSION_HEADER = 'x-docket-session';
/** What `GET /api/health` names itself, so a client can tell docket open from another server on the port. */
export const HEALTH_SERVICE = 'docket-open';
/** Where docket's MCP server answers, over Streamable HTTP (docs/mcp.md). */
export const MCP_PATH = '/mcp';
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
/**
 * An origin another page may use the API from, normalised (`http://127.0.0.1:4310`),
 * or why it cannot. Only http(s) pages on this machine: the API serves the
 * repository's knowledge and starts syncs, so a page elsewhere never gets it.
 */
export const allowedOrigin = (raw) => {
    let url;
    try {
        url = new URL(raw.trim());
    }
    catch {
        return { ok: false, reason: `"${raw}" is not an origin such as http://127.0.0.1:4310` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, reason: `"${raw}" is not an http or https origin` };
    }
    if (!LOOPBACK_NAMES.has(url.hostname)) {
        return { ok: false, reason: `"${raw}" is not on this machine: only 127.0.0.1, localhost and [::1] may be allowed` };
    }
    if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
        return { ok: false, reason: `"${raw}" is more than an origin: give the scheme, host and port only` };
    }
    return { ok: true, origin: url.origin };
};
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const sendJson = (response, status, body) => {
    response.writeHead(status, {
        'content-type': MIME['.json'],
        'cache-control': 'no-store'
    });
    response.end(JSON.stringify(body));
};
const askLimit = (raw) => {
    if (raw === null)
        return DEFAULT_ASK_LIMIT;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new HttpError(400, `limit must be a positive whole number, got "${raw}"`);
    }
    return Math.min(limit, MAX_ASK_LIMIT);
};
const question = (url) => {
    const query = url.searchParams.get('q')?.trim() ?? '';
    if (query === '')
        throw new HttpError(400, 'Ask something: the q parameter is empty.');
    return query;
};
/** A JSON body is a question or a handful of references: anything larger is refused. */
const MAX_BODY_BYTES = 256 * 1024;
/** A request id the client chose: short and printable, so it is safe to log and echo. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/**
 * Refuses a request that does not come from this machine, addressed to this
 * server by its loopback name - so neither another machine on the network nor
 * a page on another site, through a DNS name rebound to 127.0.0.1, gets past
 * it - or that a browser says another site sent, unless that site is one
 * `--allow-origin` named.
 */
const localOnly = (request, port, allowOrigins) => {
    const here = `http://127.0.0.1:${port}/`;
    if (!LOOPBACK.has(request.socket.remoteAddress ?? '')) {
        throw new HttpError(403, `This can only be done on the machine running docket open, at ${here}`);
    }
    const host = request.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && host !== `[::1]:${port}`) {
        throw new HttpError(403, `This can only be done from the page docket open serves, at ${here}`);
    }
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none' && !allowOrigins.has(request.headers.origin ?? '')) {
        throw new HttpError(403, `This can only be done from the page docket open serves, at ${here}`);
    }
};
/**
 * `localOnly`, and a change sent by the page itself - from its own origin, or
 * one `--allow-origin` named - carrying the token this launch handed it.
 */
const pageChange = (request, port, token, allowOrigins) => {
    localOnly(request, port, allowOrigins);
    const here = `http://127.0.0.1:${port}/`;
    const origin = request.headers.origin ?? '';
    if (origin !== `http://${request.headers.host ?? ''}` && !allowOrigins.has(origin)) {
        throw new HttpError(403, `This can only be done from the page docket open serves, at ${here}`);
    }
    if (request.headers[SESSION_HEADER] !== token) {
        throw new HttpError(403, 'This page is from an earlier docket open, or its session is missing. Reload the page and try again.');
    }
};
/** Checks a `POST /api/sync` body: nothing, or the instances to sync. */
const syncBody = (body) => {
    if (body === null || body === undefined)
        return null;
    if (!isObject(body))
        throw new HttpError(400, 'Send a JSON object: { "adapters": ["..."] }, or nothing to sync every adapter.');
    const { adapters } = body;
    if (adapters === undefined || adapters === null)
        return null;
    if (!Array.isArray(adapters) || adapters.length === 0 || !adapters.every((id) => typeof id === 'string' && id !== '')) {
        throw new HttpError(400, 'adapters must be a list of adapter instance ids, or left out to sync every adapter.');
    }
    return [...new Set(adapters)];
};
const readJson = (request, response, options = {}) => new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            request.removeAllListeners('data');
            request.resume();
            response.setHeader('connection', 'close');
            fail(new HttpError(413, `The request body is larger than ${MAX_BODY_BYTES} bytes.`));
            return;
        }
        chunks.push(chunk);
    });
    request.on('error', fail);
    request.on('end', () => {
        try {
            const text = Buffer.concat(chunks).toString('utf8');
            done(text.trim() === '' && options.allowEmpty ? null : JSON.parse(text));
        }
        catch {
            fail(new HttpError(400, 'The request body is not JSON.'));
        }
    });
});
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Checks a `POST /api/ask` body field by field, so a bad one says which. */
const askBody = (body) => {
    if (!isObject(body))
        throw new HttpError(400, 'Send a JSON object: { "question": "..." }.');
    const { question, adapters, conversation, synthesis, timezone, requestId } = body;
    if (typeof question !== 'string' || question.trim() === '')
        throw new HttpError(400, 'Ask something: question is empty.');
    if (adapters !== undefined && !(Array.isArray(adapters) && adapters.every((id) => typeof id === 'string'))) {
        throw new HttpError(400, 'adapters must be a list of adapter instance ids.');
    }
    const turns = conversation === undefined
        ? undefined
        : Array.isArray(conversation) &&
            conversation.every((turn) => isObject(turn) && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
            ? conversation.map(({ role, content }) => ({ role, content }))
            : (() => {
                throw new HttpError(400, 'conversation must be a list of { role: "user" | "assistant", content } turns.');
            })();
    if (synthesis !== undefined && typeof synthesis !== 'boolean')
        throw new HttpError(400, 'synthesis must be true or false.');
    if (timezone !== undefined && typeof timezone !== 'string')
        throw new HttpError(400, 'timezone must be an IANA time zone name.');
    if (requestId !== undefined && (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))) {
        throw new HttpError(400, 'requestId must be 1 to 128 letters, digits, ".", "_", ":" or "-".');
    }
    return {
        question,
        ...(adapters !== undefined ? { adapters: adapters } : {}),
        ...(turns !== undefined ? { conversation: turns } : {}),
        ...(synthesis !== undefined ? { synthesis } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(requestId !== undefined ? { requestId } : {})
    };
};
/**
 * `POST /api/ask`: one question through the shared coordinator. The request
 * id - the body's, or one made here - comes back in `x-request-id` and in the
 * answer. The question is cancelled when the client goes away or sends
 * `DELETE /api/ask/<id>`: adapters still answering are closed and the model
 * stopped.
 */
const coordinatedAsk = async (request, response, cwd, inFlight) => {
    const body = askBody(await readJson(request, response));
    const requestId = body.requestId ?? randomUUID();
    if (inFlight.has(requestId))
        throw new HttpError(409, `A question with request id "${requestId}" is already being answered.`);
    response.setHeader('x-request-id', requestId);
    const controller = new AbortController();
    inFlight.set(requestId, controller);
    const gone = () => {
        if (!response.writableFinished)
            controller.abort();
    };
    response.once('close', gone);
    try {
        const { answer } = await askProject(cwd, { ...body, requestId, signal: controller.signal });
        return answer;
    }
    catch (cause) {
        if (cause instanceof AskRequestError)
            throw new HttpError(400, cause.message);
        if (cause instanceof AskCancelledError)
            throw new HttpError(409, `Question ${requestId} was cancelled.`);
        throw cause;
    }
    finally {
        inFlight.delete(requestId);
    }
};
const api = async (request, response, url, context) => {
    const { cwd, inFlight } = context;
    const method = request.method ?? 'GET';
    const allow = (...methods) => {
        if (!methods.includes(method)) {
            response.setHeader('allow', methods.join(', '));
            throw new HttpError(405, `${url.pathname} answers ${methods.join(' and ')}, not ${method}.`);
        }
    };
    const cancel = /^\/api\/ask\/([^/]+)$/.exec(url.pathname);
    if (cancel) {
        allow('DELETE');
        const id = decodeURIComponent(cancel[1]);
        const controller = inFlight.get(id);
        if (!controller)
            throw new HttpError(404, `No question with request id "${id}" is being answered.`);
        controller.abort();
        return { requestId: id, cancelled: true };
    }
    switch (url.pathname) {
        case '/api/graph':
            allow('GET', 'HEAD');
            return readGraph(cwd);
        case '/api/ask':
            allow('GET', 'HEAD', 'POST');
            // GET is the legacy search answer; POST asks the coordinator.
            if (method === 'POST')
                return coordinatedAsk(request, response, cwd, inFlight);
            return ask(cwd, question(url), askLimit(url.searchParams.get('limit')));
        case '/api/chat':
            allow('GET', 'HEAD');
            return chat(cwd, question(url), askLimit(url.searchParams.get('limit')));
        case '/api/adapters':
            allow('GET', 'HEAD');
            return adaptersStatus(cwd);
        case '/api/health': {
            allow('GET', 'HEAD');
            const health = { service: HEALTH_SERVICE, root: cwd, allowOrigins: [...context.allowOrigins], mcp: MCP_PATH };
            return health;
        }
        case '/api/session': {
            allow('GET');
            localOnly(request, context.port, context.allowOrigins);
            const session = { token: context.token };
            return session;
        }
        case '/api/sync': {
            allow('GET', 'HEAD', 'POST');
            if (method !== 'POST')
                return context.sync.status();
            pageChange(request, context.port, context.token, context.allowOrigins);
            const adapters = syncBody(await readJson(request, response, { allowEmpty: true }));
            try {
                context.sync.start(adapters);
            }
            catch (cause) {
                if (cause instanceof SyncBusyError)
                    throw new HttpError(409, cause.message);
                throw cause;
            }
            response.statusCode = 202;
            return context.sync.status();
        }
        case '/api/evidence': {
            allow('POST');
            let references;
            try {
                references = readEvidenceBody(await readJson(request, response));
            }
            catch (cause) {
                if (cause instanceof EvidenceRequestError)
                    throw new HttpError(400, cause.message);
                throw cause;
            }
            const resolved = { references: resolveReferences(await takeSnapshot(cwd), references) };
            return resolved;
        }
        default:
            throw new HttpError(404, `No API at ${url.pathname}`);
    }
};
/** A file under `uiDir`, never outside it, or null. */
const staticFile = async (uiDir, pathname) => {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    }
    catch {
        return null;
    }
    const file = resolve(uiDir, `.${normalize(`/${decoded}`)}`);
    if (file !== uiDir && !file.startsWith(`${uiDir}${sep}`))
        return null;
    try {
        return (await stat(file)).isFile() ? file : null;
    }
    catch {
        return null;
    }
};
const serveFile = (response, file, head) => {
    // SvelteKit content-hashes everything under _app/immutable.
    const immutable = file.includes(`${sep}_app${sep}immutable${sep}`);
    response.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff'
    });
    if (head)
        response.end();
    else
        createReadStream(file).pipe(response);
};
/** The methods and request headers another allowed page may use. */
const CORS_METHODS = 'GET, HEAD, POST, DELETE';
const CORS_HEADERS = `content-type, ${SESSION_HEADER}`;
/**
 * Lets a page `--allow-origin` named read the API's answers, and answers its
 * preflight; a preflight from any other page is refused. True when the
 * request was a preflight, answered here. Other cross-origin requests go on
 * without these headers, so the browser keeps their answers from the page.
 */
const crossOrigin = (request, response, allowOrigins) => {
    if (allowOrigins.size > 0)
        response.setHeader('vary', 'Origin');
    const origin = request.headers.origin;
    const allowed = origin !== undefined && allowOrigins.has(origin);
    if (allowed) {
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('access-control-expose-headers', 'x-request-id');
    }
    if (request.method !== 'OPTIONS')
        return false;
    if (!allowed) {
        sendJson(response, 403, { error: 'Only docket open\'s own page, and the pages it was started with --allow-origin for, can use this API.' });
        return true;
    }
    response.writeHead(204, {
        'access-control-allow-methods': CORS_METHODS,
        'access-control-allow-headers': CORS_HEADERS,
        'access-control-max-age': '600'
    });
    response.end();
    return true;
};
/**
 * `POST /mcp`: one JSON-RPC message to docket's MCP server, answered as JSON
 * (Streamable HTTP without sessions or a stream of its own). It is for
 * programs on this machine only, such as Wheelhouse's MCP client, which sends
 * no browser headers. A browser page, even one `--allow-origin` named, cannot
 * reach it: it cannot send JSON without a preflight, and /mcp answers none.
 */
const mcp = async (request, response, context) => {
    const reply = (status, body) => sendJson(response, status, body);
    if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'content-type': MIME['.json'] });
        response.end(JSON.stringify({ error: `${MCP_PATH} answers POST: one JSON-RPC message (MCP Streamable HTTP).` }));
        return;
    }
    try {
        localOnly(request, context.port, context.allowOrigins);
    }
    catch (cause) {
        reply(cause instanceof HttpError ? cause.status : 403, { error: cause instanceof Error ? cause.message : String(cause) });
        return;
    }
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
        reply(415, { error: `Send ${MCP_PATH} a JSON-RPC message as application/json.` });
        return;
    }
    let message;
    try {
        message = await readJson(request, response);
    }
    catch (cause) {
        if (cause instanceof HttpError && cause.status === 413) {
            reply(413, { error: cause.message });
            return;
        }
        reply(400, { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'The request body is not JSON.' } });
        return;
    }
    if (Array.isArray(message)) {
        reply(400, { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'Send one JSON-RPC message, not a batch.' } });
        return;
    }
    const answer = await context.mcp.handle(message);
    if (answer === null) {
        response.writeHead(202);
        response.end();
        return;
    }
    reply(200, answer);
};
const handle = async (request, response, options) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === MCP_PATH) {
        await mcp(request, response, options);
        return;
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (crossOrigin(request, response, options.allowOrigins))
            return;
        try {
            const body = await api(request, response, url, options);
            if (!response.destroyed)
                sendJson(response, response.statusCode === 202 ? 202 : 200, body);
        }
        catch (cause) {
            const status = cause instanceof HttpError ? cause.status : 500;
            if (!response.headersSent && !response.destroyed) {
                sendJson(response, status, { error: cause instanceof Error ? cause.message : String(cause) });
            }
        }
        return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end();
        return;
    }
    const head = request.method === 'HEAD';
    const file = await staticFile(options.uiDir, url.pathname);
    if (file) {
        serveFile(response, file, head);
        return;
    }
    // A single-page app: any other route is the app's, unless it names an asset.
    // Entity ids hold dots, so "has an extension" would wrongly 404 them.
    const asset = url.pathname.startsWith('/_app/') || extname(url.pathname) in MIME;
    const index = asset ? null : await staticFile(options.uiDir, '/index.html');
    if (index) {
        serveFile(response, index, head);
        return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
};
const listen = (server, port, host) => new Promise((done, fail) => {
    const onError = (cause) => {
        server.off('listening', onListening);
        fail(cause);
    };
    const onListening = () => {
        server.off('error', onError);
        done();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
});
/**
 * Serves the built UI and a JSON API over the repository: the graph from the
 * canonical files; questions put to the adapters through the shared
 * coordinator (`POST /api/ask`), optionally summarized by a model; adapter
 * status (`GET /api/adapters`); canonical references resolved for the
 * evidence inspector (`POST /api/evidence`); the legacy `GET /api/ask`
 * and `GET /api/chat`, translated from the coordinator's answers; and
 * `docket sync` (`POST /api/sync`, its progress at `GET /api/sync`). Every
 * request re-reads the files, so a refresh shows edits made since. Nothing it
 * does changes the files; summaries are kept in the docket's disposable
 * `.cache/`. Starting a sync is the one request it accepts only from this
 * machine's own page: from 127.0.0.1, its origin, carrying the token
 * `GET /api/session` hands that page. `allowOrigins` names other pages on this
 * machine that are as good as its own - Wheelhouse's, which draws this UI in
 * its own page: they may read every answer (CORS) and, with the token, sync.
 * `GET /api/health` says which docket this is and which pages it allows.
 * `POST /mcp` is docket's MCP server (docs/mcp.md), for this machine only.
 */
export const startUiServer = async (options) => {
    const origins = (options.allowOrigins ?? []).map((raw) => {
        const checked = allowedOrigin(raw);
        if (!checked.ok)
            throw new Error(`Cannot allow ${checked.reason}.`);
        return checked.origin;
    });
    const context = {
        cwd: options.cwd,
        allowOrigins: new Set(origins),
        uiDir: resolve(options.uiDir),
        inFlight: new Map(),
        sync: new SyncRunner(options.cwd, options.runSync),
        token: randomUUID(),
        port: 0,
        mcp: null
    };
    const server = createServer((request, response) => {
        handle(request, response, context).catch((cause) => {
            if (!response.headersSent) {
                sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) });
            }
            else {
                response.destroy();
            }
        });
    });
    const host = options.host ?? DEFAULT_HOST;
    if (options.port !== undefined) {
        await listen(server, options.port, host);
    }
    else {
        try {
            await listen(server, DEFAULT_PORT, host);
        }
        catch (cause) {
            if (cause.code !== 'EADDRINUSE')
                throw cause;
            await listen(server, 0, host);
        }
    }
    const { port } = server.address();
    context.port = port;
    // A wildcard is reached through loopback; any other address through itself.
    const address = WILDCARD.has(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
    context.mcp = createMcpServer({ cwd: options.cwd, appFile: options.mcpAppFile, viewer: `http://${address}:${port}/` });
    return {
        url: `http://${address}:${port}/`,
        port,
        host,
        allowOrigins: [...context.allowOrigins],
        close: async () => {
            await new Promise((done, fail) => {
                server.closeAllConnections();
                server.close((cause) => (cause ? fail(cause) : done()));
            });
            // A sync started here finishes and records what it did, rather than stopping half-written.
            await context.sync.settled();
        }
    };
};
/** Where the build puts the UI: `dist/ui`, next to `dist/open`. */
export const defaultUiDir = () => join(import.meta.dirname, '..', 'ui');
