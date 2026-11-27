// SPDX-License-Identifier: AGPL-3.0-only
import { join } from 'node:path'

import { FIXTURE_ROOT, readFixture } from '@docket/platform-canonical-store/fixture'
import { describe, expect, it } from 'vitest'

import { ImportRefused, parseDocketTree, readDocketTree } from './import-docket.js'

const FIXTURE_DOCKET = join(FIXTURE_ROOT, '.docket')

describe('readDocketTree', () => {
  it("reads entities.yaml and every Markdown file under .docket, at docket's paths", async () => {
    const tree = await readDocketTree(FIXTURE_DOCKET)
    const fixture = await readFixture()
    expect(tree.ontology).toBe(fixture.ontology)
    expect(tree.documents).toEqual(fixture.documents)
    expect(tree.documents.every((d) => d.path.startsWith('.docket/resources/'))).toBe(true)
  })

  it('refuses a directory without entities.yaml', async () => {
    await expect(readDocketTree(FIXTURE_ROOT)).rejects.toBeInstanceOf(ImportRefused)
  })

  it('round-trips through the packed form', async () => {
    const tree = await readDocketTree(FIXTURE_DOCKET)
    expect(parseDocketTree(JSON.stringify(tree))).toEqual(tree)
    expect(() => parseDocketTree('{"ontology": 1}')).toThrow(ImportRefused)
    expect(() => parseDocketTree('not json')).toThrow(ImportRefused)
  })
})
