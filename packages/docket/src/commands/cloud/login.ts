import { authorizationServer, cloudOrigin, type CredentialLocation, type CredentialStore } from '@docket/adapter-kit'

import { deviceLogin, revokeToken, whoAmI, type Identity, type LoginIO } from '../../cloud/client.js'
import { CredentialStore as Store, linkedWorkspace } from '../../cloud/credentials.js'
import { requireCloudLink } from '../../cloud/project.js'

export interface CloudSessionOptions {
  cwd?: string | undefined
  /** Where sessions are kept. Default: the keychain, or `~/.config/docket/credentials.json`. */
  store?: CredentialStore | undefined
}

export interface CloudLoginOptions extends CloudSessionOptions {
  /** The cloud; it must be the one the project is linked to. */
  url?: string | undefined
  io: LoginIO
}

export interface CloudLoginResult {
  /** `acme/platform on https://...`. */
  workspace: string
  location: CredentialLocation
  /** The credentials file, when that is where the session went. */
  file?: string
}

/**
 * Signs in to the workspace the project is linked to - a sign-in is for one
 * workspace, as its tokens are - with the device authorization grant. The
 * session goes to the keychain, or a file only the user can read.
 */
export const cloudLogin = async (options: CloudLoginOptions): Promise<CloudLoginResult> => {
  const { link } = await requireCloudLink(options.cwd ?? process.cwd())
  if (options.url !== undefined && cloudOrigin(options.url) !== cloudOrigin(link.url)) {
    throw new Error(`This project is linked to ${link.org}/${link.workspace} on ${link.url}, not ${cloudOrigin(options.url)}.`)
  }
  const store = options.store ?? new Store()
  const workspace = linkedWorkspace(link, { store, env: {} })
  const server = await authorizationServer(workspace.origin)
  const credential = await deviceLogin(server, workspace.resource, options.io)
  const location = await store.write(workspace.resource, credential)
  return { workspace: workspace.label, location, ...(location === 'file' ? { file: store.file } : {}) }
}

export interface CloudLogoutResult {
  workspace: string
  /** Whether there was a session to forget. */
  removed: boolean
  /** Whether the cloud revoked its refresh token too; offline, it simply expires. */
  revoked: boolean
}

/** Forgets the linked workspace's session, and asks the cloud to revoke it. */
export const cloudLogout = async (options: CloudSessionOptions = {}): Promise<CloudLogoutResult> => {
  const { link } = await requireCloudLink(options.cwd ?? process.cwd())
  const store = options.store ?? new Store()
  const workspace = linkedWorkspace(link, { store, env: {} })
  const credential = await store.read(workspace.resource)
  let revoked = false
  if (credential?.refreshToken !== undefined && credential.clientId !== undefined) {
    try {
      revoked = await revokeToken(await authorizationServer(workspace.origin), credential.refreshToken, credential.clientId)
    } catch {
      // Unreachable: the session is still forgotten here, and expires there.
    }
  }
  return { workspace: workspace.label, removed: await store.remove(workspace.resource), revoked }
}

export interface CloudWhoamiResult {
  workspace: string
  /** Who the cloud says the session acts as. */
  identity: Identity
}

/** Who the linked workspace's session acts as. */
export const cloudWhoami = async (options: CloudSessionOptions = {}): Promise<CloudWhoamiResult> => {
  const { link } = await requireCloudLink(options.cwd ?? process.cwd())
  const workspace = linkedWorkspace(link, { store: options.store })
  return { workspace: workspace.label, identity: await whoAmI(workspace) }
}
