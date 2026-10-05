import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { hostname } from 'node:os'
import { basename, resolve } from 'node:path'

/**
 * Resolves symlinks and the on-disk letter case when the path exists, so one
 * checkout never has two scopes.
 */
const canonicalPath = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

/**
 * The default remote scope for one checkout on one machine:
 * `docket-<directory>-<hash>`, the hash taken over the machine's hostname and
 * the checkout's absolute path. Two checkouts that share a directory name - two
 * clones, two worktrees, or the same path on two machines - therefore never
 * share a scope, so one's `rebuild`, which deletes its whole scope, cannot wipe
 * the other's projection. Renaming the machine or moving the checkout gives it
 * a new scope; set `scope:` in the projection config to pin one.
 */
export const checkoutScope = (projectRoot: string, host: string = hostname()): string => {
  const path = canonicalPath(projectRoot)
  const hash = createHash('sha256').update(`${host.toLowerCase()}\0${path}`).digest('hex').slice(0, 12)
  return `docket-${basename(path).replace(/\s+/g, '-')}-${hash}`
}
