import { CloudWorkspace, CredentialStore } from '@docket/adapter-kit'

import type { CloudLink } from './project.js'

export {
  CredentialStore,
  defaultCredentialsFile,
  KEYCHAIN_ENV,
  type CloudCredential,
  type CredentialLocation,
  type Keychain
} from '@docket/adapter-kit'

/**
 * The linked workspace, signed in as the commands sign in: with the API token
 * the link's `tokenEnv` names when that variable is set (CI), and otherwise
 * with the session `docket cloud login` kept.
 */
export const linkedWorkspace = (
  link: CloudLink,
  options: { store?: CredentialStore | undefined; env?: NodeJS.ProcessEnv } = {}
): CloudWorkspace => {
  const env = options.env ?? process.env
  const token = link.tokenEnv === undefined ? undefined : env[link.tokenEnv] || undefined
  return new CloudWorkspace({ url: link.url, org: link.org, workspace: link.workspace, token, store: options.store })
}
