import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { checkoutScope } from '@docket/adapter-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cloudFixture, type CloudFixture } from '../../../test/cloud.js'
import { write } from '../../../test/helpers.js'
import { hashContent } from '../../source/hashing.js'
import { cloudPush, PUSH_BATCH_BYTES } from './push.js'

const ORDERS = '---\nid: service.orders\ntype: service\ntitle: Orders API\n---\n\nHandles orders.\n'
const PAYMENTS = '---\nid: team.payments\ntype: team\ntitle: Payments\n---\n\nThe payments team.\n'

let fixture: CloudFixture

beforeEach(async () => {
  fixture = await cloudFixture()
  await fixture.signIn()
  await write(fixture.root, '.docket/resources/service/orders.md', ORDERS)
  await write(fixture.root, '.docket/resources/team/payments.md', PAYMENTS)
  // The cloud already publishes this checkout's ontology.
  fixture.cloud.ontology = { version: 3, yaml: await readFile(join(fixture.root, '.docket/entities.yaml'), 'utf8') }
})

afterEach(async () => {
  await fixture.close()
})

const push = (dryRun = false) => cloudPush({ cwd: fixture.root, store: fixture.store, dryRun })

/** The cloud holds `path` for this checkout with `raw`. */
const held = (path: string, raw: string) =>
  fixture.cloud.documents.push({ path, raw, hash: hashContent(raw), origin: 'cli', originRef: checkoutScope(fixture.root) })

describe('docket cloud push', () => {
  it('uploads only the files whose hash differs from the cloud\'s, keyed by the checkout', async () => {
    held('.docket/resources/service/orders.md', ORDERS)
    held('.docket/resources/team/payments.md', 'an older version')

    const result = await push()

    expect(result).toMatchObject({ ok: true, uploaded: ['.docket/resources/team/payments.md'], unchanged: 1, removed: [] })
    expect(fixture.cloud.pushes).toEqual([
      { checkout: checkoutScope(fixture.root), dryRun: false, upsert: [{ path: '.docket/resources/team/payments.md', raw: PAYMENTS }], remove: [] }
    ])
  })

  it('sends nothing when every file matches', async () => {
    held('.docket/resources/service/orders.md', ORDERS)
    held('.docket/resources/team/payments.md', PAYMENTS)

    expect(await push()).toMatchObject({ ok: true, uploaded: [], removed: [], unchanged: 2 })
    expect(fixture.cloud.pushes).toEqual([])
  })

  it('retires the documents this checkout no longer has', async () => {
    held('.docket/resources/service/orders.md', ORDERS)
    held('.docket/resources/team/payments.md', PAYMENTS)
    await rm(join(fixture.root, '.docket/resources/team/payments.md'))

    expect(await push()).toMatchObject({ removed: ['.docket/resources/team/payments.md'], uploaded: [] })
    expect(fixture.cloud.pushes[0]?.remove).toEqual(['.docket/resources/team/payments.md'])
  })

  it('returns the server\'s validator diagnostics, and fails when it refused the push', async () => {
    fixture.cloud.pushDiagnostics = [
      { severity: 'error', code: 'unknown-type', message: 'Type "service" is not in the published ontology.', path: '.docket/resources/service/orders.md' }
    ]

    const result = await push()

    expect(result).toMatchObject({ ok: false, uploaded: [], removed: [], notStored: ['.docket/resources/service/orders.md', '.docket/resources/team/payments.md'] })
    expect(result.diagnostics).toEqual(fixture.cloud.pushDiagnostics)
    expect(fixture.cloud.documents).toEqual([])
  })

  it('reports only the batches the cloud stored when it refuses a later one, and still proposes the differing ontology as a draft', async () => {
    const large = `${ORDERS}${'x'.repeat(PUSH_BATCH_BYTES)}\n`
    await write(fixture.root, '.docket/resources/service/orders.md', large)
    held('.docket/resources/team/retired.md', 'gone from the checkout')
    fixture.cloud.ontology = { version: 3, yaml: 'version: 1\nresourceTypes: {}\nrelationships: {}\n' }
    fixture.cloud.pushDiagnostics = [
      { severity: 'error', code: 'unknown-type', message: 'Type "team" is not in the published ontology.', path: '.docket/resources/team/payments.md' }
    ]

    const result = await push()

    expect(fixture.cloud.pushes.map((request) => request.upsert.map((upsert) => upsert.path))).toEqual([
      ['.docket/resources/service/orders.md'],
      ['.docket/resources/team/payments.md']
    ])
    expect(result).toMatchObject({
      ok: false,
      uploaded: ['.docket/resources/service/orders.md'],
      removed: ['.docket/resources/team/retired.md'],
      notStored: ['.docket/resources/team/payments.md'],
      ontology: { state: 'proposed', version: 3, proposal: { draftId: 'draft-1' } }
    })
    expect(fixture.cloud.documents.map((document) => document.path)).toEqual(['.docket/resources/service/orders.md'])
    expect(fixture.cloud.toolCalls.map((call) => call.name)).toEqual(['docket_ontology', 'docket_propose_ontology_change'])
  })

  it('sends a differing ontology as a draft, never publishing it', async () => {
    fixture.cloud.ontology = { version: 3, yaml: 'version: 1\nresourceTypes: {}\nrelationships: {}\n' }

    const result = await push()

    expect(result.ontology).toMatchObject({ state: 'proposed', version: 3, proposal: { draftId: 'draft-1' } })
    const proposal = fixture.cloud.toolCalls.find((call) => call.name === 'docket_propose_ontology_change')
    expect(proposal?.arguments).toEqual({
      yaml: await readFile(join(fixture.root, '.docket/entities.yaml'), 'utf8'),
      message: `Proposed by docket cloud push from ${checkoutScope(fixture.root)}`
    })
  })

  it('leaves an unchanged ontology alone', async () => {
    expect((await push()).ontology).toEqual({ state: 'same', version: 3 })
    expect(fixture.cloud.toolCalls.map((call) => call.name)).toEqual(['docket_ontology'])
  })

  it('with --dry-run, has the cloud validate and changes nothing, proposing no draft', async () => {
    await writeFile(join(fixture.root, '.docket/entities.yaml'), 'version: 1\n# edited\n')

    const result = await push(true)

    expect(result).toMatchObject({ dryRun: true, ok: true, uploaded: ['.docket/resources/service/orders.md', '.docket/resources/team/payments.md'] })
    expect(result.ontology).toEqual({ state: 'differs', version: 3 })
    expect(fixture.cloud.pushes[0]?.dryRun).toBe(true)
    expect(fixture.cloud.documents).toEqual([])
    expect(fixture.cloud.toolCalls.map((call) => call.name)).toEqual(['docket_ontology'])
  })

  it('says plainly when the cloud does not offer a documents API yet', async () => {
    await fixture.close()
    fixture = await cloudFixture({ restApi: false })
    await fixture.signIn()

    await expect(push()).rejects.toThrow(/does not offer a documents API yet/)
  })
})
