import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkoutScope } from './scope.js'

describe('checkoutScope', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'docket-scope-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('gives two checkouts with the same directory name different scopes', async () => {
    const first = join(root, 'a', 'platform')
    const second = join(root, 'b', 'platform')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })

    expect(checkoutScope(first)).not.toBe(checkoutScope(second))
    expect(checkoutScope(first)).toMatch(/^docket-platform-[0-9a-f]{12}$/)
    expect(checkoutScope(second)).toMatch(/^docket-platform-[0-9a-f]{12}$/)
  })

  it('is stable for one checkout, however its path is spelled', async () => {
    const checkout = join(root, 'platform')
    await mkdir(checkout)
    const link = join(root, 'link')
    await symlink(checkout, link)

    expect(checkoutScope(checkout)).toBe(checkoutScope(checkout))
    expect(checkoutScope(`${checkout}/`)).toBe(checkoutScope(checkout))
    expect(checkoutScope(link)).toBe(checkoutScope(checkout))
  })

  it('gives the same path on two machines different scopes', async () => {
    const checkout = join(root, 'platform')
    await mkdir(checkout)

    expect(checkoutScope(checkout, 'laptop')).not.toBe(checkoutScope(checkout, 'codespace'))
    expect(checkoutScope(checkout, 'laptop')).toBe(checkoutScope(checkout, 'LAPTOP'))
  })

  it('replaces whitespace in the directory name', () => {
    expect(checkoutScope('/repos/acme platform')).toMatch(/^docket-acme-platform-[0-9a-f]{12}$/)
  })
})
