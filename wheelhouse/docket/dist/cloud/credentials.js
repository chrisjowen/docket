import { CloudWorkspace } from '../bundled/adapter-kit/dist/index.js';
export { CredentialStore, defaultCredentialsFile, KEYCHAIN_ENV } from '../bundled/adapter-kit/dist/index.js';
/**
 * The linked workspace, signed in as the commands sign in: with the API token
 * the link's `tokenEnv` names when that variable is set (CI), and otherwise
 * with the session `docket cloud login` kept.
 */
export const linkedWorkspace = (link, options = {}) => {
    const env = options.env ?? process.env;
    const token = link.tokenEnv === undefined ? undefined : env[link.tokenEnv] || undefined;
    return new CloudWorkspace({ url: link.url, org: link.org, workspace: link.workspace, token, store: options.store });
};
