import { authorizationServer, cloudOrigin } from '../../bundled/adapter-kit/dist/index.js';
import { deviceLogin, revokeToken, whoAmI } from '../../cloud/client.js';
import { CredentialStore as Store, linkedWorkspace } from '../../cloud/credentials.js';
import { requireCloudLink } from '../../cloud/project.js';
/**
 * Signs in to the workspace the project is linked to - a sign-in is for one
 * workspace, as its tokens are - with the device authorization grant. The
 * session goes to the keychain, or a file only the user can read.
 */
export const cloudLogin = async (options) => {
    const { link } = await requireCloudLink(options.cwd ?? process.cwd());
    if (options.url !== undefined && cloudOrigin(options.url) !== cloudOrigin(link.url)) {
        throw new Error(`This project is linked to ${link.org}/${link.workspace} on ${link.url}, not ${cloudOrigin(options.url)}.`);
    }
    const store = options.store ?? new Store();
    const workspace = linkedWorkspace(link, { store, env: {} });
    const server = await authorizationServer(workspace.origin);
    const credential = await deviceLogin(server, workspace.resource, options.io);
    const location = await store.write(workspace.resource, credential);
    return { workspace: workspace.label, location, ...(location === 'file' ? { file: store.file } : {}) };
};
/** Forgets the linked workspace's session, and asks the cloud to revoke it. */
export const cloudLogout = async (options = {}) => {
    const { link } = await requireCloudLink(options.cwd ?? process.cwd());
    const store = options.store ?? new Store();
    const workspace = linkedWorkspace(link, { store, env: {} });
    const credential = await store.read(workspace.resource);
    let revoked = false;
    if (credential?.refreshToken !== undefined && credential.clientId !== undefined) {
        try {
            revoked = await revokeToken(await authorizationServer(workspace.origin), credential.refreshToken, credential.clientId);
        }
        catch {
            // Unreachable: the session is still forgotten here, and expires there.
        }
    }
    return { workspace: workspace.label, removed: await store.remove(workspace.resource), revoked };
};
/** Who the linked workspace's session acts as. */
export const cloudWhoami = async (options = {}) => {
    const { link } = await requireCloudLink(options.cwd ?? process.cwd());
    const workspace = linkedWorkspace(link, { store: options.store });
    return { workspace: workspace.label, identity: await whoAmI(workspace) };
};
