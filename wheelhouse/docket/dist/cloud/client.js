import { CloudApiError, cloudFetch, credentialFrom } from '../bundled/adapter-kit/dist/index.js';
/*
 * What `docket cloud` asks of the cloud: signing in, and the workspace's REST
 * API and MCP tools. The REST routes are the bearer API docket-cloud offers
 * for the CLI; a cloud without one answers 404, reported as "not offered yet".
 */
/** The public client the cloud registers for this CLI's device authorization. */
export const CLI_CLIENT_ID = 'docket-cli';
/** Everything a CLI session may do; the cloud caps them at the user's role. */
export const LOGIN_SCOPES = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'];
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const form = async (url, fields) => cloudFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(fields)
});
const oauthError = async (response) => {
    try {
        const body = (await response.json());
        return {
            error: typeof body.error === 'string' ? body.error : `http_${response.status}`,
            ...(typeof body.error_description === 'string' ? { description: body.error_description } : {})
        };
    }
    catch {
        return { error: `http_${response.status}` };
    }
};
/**
 * OAuth 2.0 device authorization (RFC 8628): shows a code and opens the
 * browser, then polls the token endpoint at the interval the cloud advertised
 * - five seconds more after each `slow_down` - until the user approves,
 * declines or the code expires.
 */
export const deviceLogin = async (server, resource, io) => {
    const endpoint = server.device_authorization_endpoint;
    if (endpoint === undefined)
        throw new Error(`${server.issuer} does not offer device sign-in yet.`);
    const now = io.now ?? Date.now;
    const started = await form(endpoint, { client_id: CLI_CLIENT_ID, scope: LOGIN_SCOPES.join(' '), resource });
    if (!started.ok) {
        const { error, description } = await oauthError(started);
        throw new Error(`${server.issuer} refused to start a sign-in: ${description ?? error}`);
    }
    const authorization = (await started.json());
    io.show({ url: authorization.verification_uri, userCode: authorization.user_code });
    io.openBrowser(authorization.verification_uri_complete ?? authorization.verification_uri);
    let interval = (authorization.interval ?? 5) * 1000;
    const deadline = now() + authorization.expires_in * 1000;
    while (now() < deadline) {
        await io.sleep(interval);
        const polled = await form(server.token_endpoint, {
            grant_type: DEVICE_GRANT,
            device_code: authorization.device_code,
            client_id: CLI_CLIENT_ID,
            resource
        });
        if (polled.ok) {
            return credentialFrom((await polled.json()), { clientId: CLI_CLIENT_ID, tokenEndpoint: server.token_endpoint, now: new Date(now()) });
        }
        const { error, description } = await oauthError(polled);
        if (error === 'authorization_pending')
            continue;
        if (error === 'slow_down') {
            interval += 5000;
            continue;
        }
        if (error === 'access_denied')
            throw new Error('The sign-in was declined.');
        if (error === 'expired_token')
            break;
        throw new Error(`The sign-in failed: ${description ?? error}`);
    }
    throw new Error('The sign-in code expired before it was approved; run `docket cloud login` again.');
};
/** Revokes a token at the cloud (RFC 7009). Best effort: a failure leaves only the token to expire. */
export const revokeToken = async (server, token, clientId) => {
    if (server.revocation_endpoint === undefined)
        return false;
    try {
        return (await form(server.revocation_endpoint, { token, client_id: clientId })).ok;
    }
    catch {
        return false;
    }
};
// ---------------------------------------------------------------------------
// The workspace's REST API and MCP tools
/** The cloud has no such route. */
export class NotOfferedError extends Error {
    name = 'NotOfferedError';
}
/**
 * A REST call. A 404 without an OAuth-style `error` code is a route the cloud
 * does not have - SvelteKit's own not-found - and says so plainly; the API's
 * own 404s (an unknown workspace or token) carry `error` and are passed on.
 */
const rest = async (workspace, what, method, path, body) => {
    try {
        return await workspace.api(method, path, body);
    }
    catch (cause) {
        if (cause instanceof CloudApiError && cause.status === 404 && cause.code === undefined) {
            throw new NotOfferedError(`${workspace.origin} does not offer ${what} yet.`);
        }
        throw cause;
    }
};
export const whoAmI = (workspace) => rest(workspace, 'whoami', 'GET', 'me');
export const listTokens = async (workspace) => (await rest(workspace, 'API tokens over its API', 'GET', 'tokens')).tokens;
export const createToken = (workspace, input) => rest(workspace, 'API tokens over its API', 'POST', 'tokens', input);
export const deleteToken = (workspace, id) => rest(workspace, 'API tokens over its API', 'DELETE', `tokens/${encodeURIComponent(id)}`);
/** Every page of a document listing. */
export const listDocuments = async (workspace, query) => {
    const documents = [];
    let cursor;
    do {
        const params = new URLSearchParams({ origin: query.origin });
        if (query.originRef !== undefined)
            params.set('originRef', query.originRef);
        if (query.raw)
            params.set('include', 'raw');
        if (cursor !== undefined)
            params.set('cursor', cursor);
        const page = await rest(workspace, 'a documents API', 'GET', `documents?${params}`);
        documents.push(...page.documents);
        cursor = page.next;
    } while (cursor !== undefined);
    return documents;
};
export const pushDocuments = (workspace, request) => rest(workspace, 'a documents API', 'POST', 'documents/push', request);
export const cloudOntology = async (workspace) => (await workspace.callTool('docket_ontology', {})).structured;
export const proposeOntology = async (workspace, yaml, message) => (await workspace.callTool('docket_propose_ontology_change', { yaml, message })).structured;
