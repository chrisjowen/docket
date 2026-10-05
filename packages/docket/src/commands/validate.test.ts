import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { hasErrors } from '../model/index.js'
import { init } from './init.js'
import { validate } from './validate.js'

let root: string

const write = (name: string, contents: string): Promise<void> =>
  writeFile(join(root, '.docket', 'notes', name), contents, 'utf8')

const DANGLING = `---
id: service.orders
type: service
title: Orders
links:
  - rel: owned_by
    target: team.does-not-exist
---

Body.
`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-validate-'))
  await init({ cwd: root })
})

describe('validate', () => {
  it('counts documents and reports nothing for a clean tree', async () => {
    await write(
      'orders.md',
      '---\nid: service.orders\ntype: service\ntitle: Orders\n---\n\nBody.\n'
    )

    const result = await validate({ cwd: root })
    expect(result.documents).toHaveLength(1)
    expect(result.diagnostics).toEqual([])
    expect(hasErrors(result.diagnostics)).toBe(false)
  })

  // The CLI exits non-zero exactly when `hasErrors` is true (spec §40).
  it('fails on structural and schema problems', async () => {
    await write(
      'thing.md',
      '---\nid: thing.one\ntype: not-a-registered-type\ntitle: Thing\n---\n\nBody.\n'
    )

    const result = await validate({ cwd: root })
    expect(result.diagnostics.map((d) => d.code)).toContain('unknown-type')
    expect(hasErrors(result.diagnostics)).toBe(true)
  })

  it('does not fail on warnings alone', async () => {
    await write('orders.md', DANGLING)

    const result = await validate({ cwd: root })
    const dangling = result.diagnostics.filter(
      (d) => d.code === 'dangling-reference'
    )
    expect(dangling).toHaveLength(1)
    expect(dangling[0]?.severity).toBe('warning')
    expect(hasErrors(result.diagnostics)).toBe(false)
  })

  it('promotes dangling references to errors under --strict', async () => {
    await write('orders.md', DANGLING)

    const result = await validate({ cwd: root, strict: true })
    expect(
      result.diagnostics.find((d) => d.code === 'dangling-reference')?.severity
    ).toBe('error')
    expect(hasErrors(result.diagnostics)).toBe(true)
  })

  it('reports a missing ontology instead of throwing', async () => {
    await writeFile(join(root, '.docket', 'entities.yaml'), '', 'utf8')

    const result = await validate({ cwd: root })
    expect(result.ontology).toBeNull()
    expect(hasErrors(result.diagnostics)).toBe(true)
  })
})
