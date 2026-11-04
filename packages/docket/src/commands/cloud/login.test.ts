import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CredentialStore } from '@docket/adapter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { cloudFixture, type CloudFixture } from '../../../test/cloud.js'
import type { LoginIO } from '../../cloud/client.js'
import { cloudLogin, cloudLogout, cloudWhoami } from './login.js'

let fixture: CloudFixture

afterEach(async () => {
  await fixture.close()
})

/** A login's terminal and browser, recorded; time passes only as it sleeps. */
const recordingIO = () => {
  let clock = 1_800_000_000_000
  const io = {
    shown: [] as { url: string; userCode: string }[],
    opened: [] as string[],
    slept: [] as number[],
    show: (prompt: { url: string; userCode: string }) => void io.shown.push(prompt),
    openBrowser: (url: string) => void io.opened.push(url),
    sleep: async (ms: number) => {
      io.slept.push(ms)
      clock += ms
    },
    now: () => clock
  }
  return io satisfies LoginIO
}

describe('docket cloud login', () => {
  it('polls the token endpoint at the advertised interval, and writes the session file 0600 without a keychain', async () => {
    fixture = await cloudFixture({ pendingPolls: 2, interval: 7 })
    const io = recordingIO()
    const store = new CredentialStore({ file: join(fixture.root, 'config', 'credentials.json'), keychain: null })

    const result = await cloudLogin({ cwd: fixture.root, store, io })

    expect(result).toMatchObject({ location: 'file', file: store.file })
    expect(io.shown).toEqual([{ url: `${fixture.cloud.url}/device`, userCode: 'WDJB-MJHT' }])
    expect(io.opened).toEqual([`${fixture.cloud.url}/device?user_code=WDJB-MJHT`])
    expect(io.slept).toEqual([7000, 7000, 7000])
    expect(fixture.cloud.tokenRequests.map((form) => form.get('grant_type'))).toEqual(Array(3).fill('urn:ietf:params:oauth:grant-type:device_code'))
    expect(fixture.cloud.tokenRequests.every((form) => form.get('resource') === `${fixture.cloud.url}/mcp/acme/platform`)).toBe(true)
    expect((await stat(store.file)).mode & 0o777).toBe(0o600)
    expect(await store.read(`${fixture.cloud.url}/mcp/acme/platform`)).toMatchObject({ clientId: 'docket-cli', refreshToken: expect.any(String) })
  })

  it('says plainly when the cloud does not offer device sign-in', async () => {
    fixture = await cloudFixture({ deviceFlow: false })

    await expect(cloudLogin({ cwd: fixture.root, store: fixture.store, io: recordingIO() })).rejects.toThrow(/does not offer device sign-in yet/)
    expect(fixture.cloud.tokenRequests).toEqual([])
  })

  it('names the link to run first in a project that is not linked', async () => {
    fixture = await cloudFixture()
    await writeFile(join(fixture.root, '.docket.yaml'), 'version: 2\n')

    for (const run of [
      () => cloudLogin({ cwd: fixture.root, store: fixture.store, io: recordingIO() }),
      () => cloudLogout({ cwd: fixture.root, store: fixture.store }),
      () => cloudWhoami({ cwd: fixture.root, store: fixture.store })
    ]) {
      await expect(run()).rejects.toThrow('Not linked to a cloud workspace: run `docket cloud link <org>/<workspace>` first, then `docket cloud login`.')
    }
  })

  it('refuses a cloud other than the one the project is linked to', async () => {
    fixture = await cloudFixture()

    await expect(cloudLogin({ cwd: fixture.root, url: 'https://elsewhere.example.test', store: fixture.store, io: recordingIO() })).rejects.toThrow(
      /linked to acme\/platform on http:\/\/127\.0\.0\.1:\d+, not https:\/\/elsewhere\.example\.test/
    )
  })
})

describe('docket cloud logout', () => {
  it('forgets the session and revokes it at the cloud', async () => {
    fixture = await cloudFixture()
    await fixture.signIn()

    expect(await cloudLogout({ cwd: fixture.root, store: fixture.store })).toMatchObject({ removed: true, revoked: true })
    expect(await fixture.store.read(`${fixture.cloud.url}/mcp/acme/platform`)).toBeUndefined()
    expect(await cloudLogout({ cwd: fixture.root, store: fixture.store })).toMatchObject({ removed: false, revoked: false })
  })
})

describe('docket cloud whoami', () => {
  it('says who the cloud knows the session as', async () => {
    fixture = await cloudFixture()
    await fixture.signIn()

    expect((await cloudWhoami({ cwd: fixture.root, store: fixture.store })).identity).toMatchObject({ login: 'octocat', role: 'member' })
  })

})
