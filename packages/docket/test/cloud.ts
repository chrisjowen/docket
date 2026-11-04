import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CredentialStore } from '@docket/adapter-kit'
import { startFakeCloud, type FakeCloud } from '@docket/adapter-kit/testing'

import { cloudLink } from '../src/commands/cloud/link.js'
import { init } from '../src/commands/init.js'

/** A project linked to `acme/platform` on a fake cloud, and a session store of its own. */
export interface CloudFixture {
  root: string
  cloud: FakeCloud
  store: CredentialStore
  /** Signs in as `docket cloud login` would have. */
  signIn(): Promise<void>
  close(): Promise<void>
}

export const cloudFixture = async (options: Parameters<typeof startFakeCloud>[0] = {}): Promise<CloudFixture> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-cloud-')))
  await init({ cwd: root })
  const cloud = await startFakeCloud(options)
  await cloudLink('acme/platform', { cwd: root, url: cloud.url })
  const store = new CredentialStore({ file: join(root, '.credentials.json'), keychain: null })
  return {
    root,
    cloud,
    store,
    async signIn() {
      const { accessToken, refreshToken } = cloud.issue()
      await store.write(`${cloud.url}/mcp/acme/platform`, {
        accessToken,
        refreshToken,
        clientId: 'docket-cli',
        tokenEndpoint: `${cloud.url}/oauth/token`,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        scope: 'docket:read docket:write ontology:read ontology:propose'
      })
    },
    async close() {
      await cloud.close()
      await rm(root, { recursive: true, force: true })
    }
  }
}
