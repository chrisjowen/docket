import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkoutScope, OFFLINE_ENV } from '@docket/adapter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cloudFixture, type CloudFixture } from '../../../test/cloud.js'
import { write } from '../../../test/helpers.js'
import { hashContent } from '../../source/hashing.js'
import { init } from '../init.js'
import { cloudStatus } from './status.js'

let fixture: CloudFixture | undefined

afterEach(async () => {
  vi.unstubAllEnvs()
  await fixture?.close()
  fixture = undefined
})

describe('docket cloud status', () => {
  it('reports the link, the sign-in, the ontology against the cloud\'s and the pending pushes', async () => {
    fixture = await cloudFixture()
    await fixture.signIn()
    fixture.cloud.ontology = { version: 7, yaml: await readFile(join(fixture.root, '.docket/entities.yaml'), 'utf8') }
    await write(fixture.root, '.docket/resources/team/payments.md', 'payments')
    await write(fixture.root, '.docket/resources/team/billing.md', 'billing')
    const ref = checkoutScope(fixture.root)
    fixture.cloud.documents.push(
      { path: '.docket/resources/team/payments.md', raw: 'payments', hash: hashContent('payments'), origin: 'cli', originRef: ref },
      { path: '.docket/resources/team/gone.md', raw: 'gone', hash: hashContent('gone'), origin: 'cli', originRef: ref }
    )

    const status = await cloudStatus({ cwd: fixture.root, store: fixture.store })

    expect(status.link).toEqual({ adapter: 'cloud', workspace: 'acme/platform', url: fixture.cloud.url })
    expect(status.session).toMatchObject({ kind: 'session', expiresAt: expect.any(String) })
    expect(status.ontology).toMatchObject({ ok: true, version: 7, same: true })
    expect(status.pending).toEqual({ ok: true, upload: 1, remove: 1 })
  })

  it('still reports the link and sign-in offline, each cloud part saying why it is missing', async () => {
    fixture = await cloudFixture()
    vi.stubEnv(OFFLINE_ENV, '1')

    const status = await cloudStatus({ cwd: fixture.root, store: fixture.store })

    expect(status.link?.workspace).toBe('acme/platform')
    expect(status.session).toEqual({ kind: 'none' })
    expect(status.ontology).toEqual({ ok: false, error: `network access is turned off (${OFFLINE_ENV} is set)` })
    expect(status.pending).toEqual({ ok: false, error: `network access is turned off (${OFFLINE_ENV} is set)` })
    expect(fixture.cloud.requests).toEqual([])
  })

  it('says only where the project is when it is not linked', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-cloud-status-')))
    try {
      await init({ cwd: root })
      expect(await cloudStatus({ cwd: root })).toEqual({ projectRoot: root })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
