import { existsSync } from 'node:fs'
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

  // macOS and Windows filesystems are case-insensitive by default, so one
  // checkout is reachable through several spellings of its path.
  const caseInsensitive = (dir: string): boolean => existsSync(dir.toUpperCase())

  it('gives every case variant of a checkout path the one scope, named in its on-disk case', async (context) => {
    const checkout = join(root, 'Repos', 'Platform')
    await mkdir(checkout, { recursive: true })
    if (!caseInsensitive(checkout)) context.skip()

    const scope = checkoutScope(checkout)
    expect(scope).toMatch(/^docket-Platform-[0-9a-f]{12}$/)
    for (const variant of [
      join(root, 'repos', 'platform'),
      join(root, 'REPOS', 'PLATFORM'),
      join(root, 'Repos', 'pLaTfOrM')
    ]) {
      expect(checkoutScope(variant), variant).toBe(scope)
    }
  })

  it('gives checkouts at different paths different scopes', async () => {
    const first = join(root, 'platform')
    const second = join(root, 'billing')
    await mkdir(first)
    await mkdir(second)

    expect(checkoutScope(first)).not.toBe(checkoutScope(second))
  })

  it('replaces whitespace in the directory name', () => {
    expect(checkoutScope('/repos/acme platform')).toMatch(/^docket-acme-platform-[0-9a-f]{12}$/)
  })
})
