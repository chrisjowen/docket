import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cloudFixture, type CloudFixture } from '../../../test/cloud.js'
import { write } from '../../../test/helpers.js'
import { hashContent } from '../../source/hashing.js'
import { cloudPull } from './pull.js'

const ONTOLOGY = 'version: 1\nresourceTypes:\n  team:\n    description: A team\nrelationships: {}\n'
const BILLING = '---\nid: team.billing\ntype: team\ntitle: Billing\n---\n\nWritten in the cloud.\n'

let fixture: CloudFixture

beforeEach(async () => {
  fixture = await cloudFixture()
  await fixture.signIn()
  fixture.cloud.ontology = { version: 5, yaml: ONTOLOGY }
})

afterEach(async () => {
  await fixture.close()
})

const pull = (options: { ontology?: boolean; resources?: boolean } = {}) => cloudPull({ cwd: fixture.root, store: fixture.store, ...options })

const cloudDocument = (path: string, raw: string) => fixture.cloud.documents.push({ path, raw, hash: hashContent(raw), origin: 'cloud' })

describe('docket cloud pull', () => {
  it('writes the published ontology by default', async () => {
    expect(await pull()).toMatchObject({ ontology: { version: 5, path: '.docket/entities.yaml', changed: true } })
    expect(await readFile(join(fixture.root, '.docket/entities.yaml'), 'utf8')).toBe(ONTOLOGY)
    expect((await pull()).ontology?.changed).toBe(false)
  })

  it('with --resources, writes the cloud-origin documents, never overwriting a local file', async () => {
    cloudDocument('.docket/resources/team/billing.md', BILLING)
    cloudDocument('.docket/resources/team/payments.md', 'cloud copy')
    cloudDocument('../outside.md', 'never written')
    await write(fixture.root, '.docket/resources/team/payments.md', 'local copy')

    const result = await pull({ resources: true })

    expect(result.ontology).toBeUndefined()
    expect(result.resources).toEqual({
      written: ['.docket/resources/team/billing.md'],
      unchanged: [],
      kept: ['.docket/resources/team/payments.md'],
      refused: ['../outside.md']
    })
    expect(await readFile(join(fixture.root, '.docket/resources/team/billing.md'), 'utf8')).toBe(BILLING)
    expect(await readFile(join(fixture.root, '.docket/resources/team/payments.md'), 'utf8')).toBe('local copy')
    expect(existsSync(join(fixture.root, '..', 'outside.md'))).toBe(false)
  })

  it('with both flags, writes both', async () => {
    cloudDocument('.docket/resources/team/billing.md', BILLING)

    const result = await pull({ ontology: true, resources: true })

    expect(result.ontology?.changed).toBe(true)
    expect(result.resources?.written).toEqual(['.docket/resources/team/billing.md'])
  })
})
