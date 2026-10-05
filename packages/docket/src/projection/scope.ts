import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'

/** Resolves symlinks when the path exists, so one checkout never has two scopes. */
const canonicalPath = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * The default remote scope for one checkout: `docket-<directory>-<hash>`, the
 * hash taken over the checkout's absolute path. Two checkouts that share a
 * directory name - two clones, two worktrees - therefore never share a scope,
 * so one's `rebuild`, which deletes its whole scope, cannot wipe the other's
 * projection. Moving a checkout gives it a new scope; set `scope:` in the
 * projection config to pin one.
 */
export const checkoutScope = (projectRoot: string): string => {
  const path = canonicalPath(projectRoot)
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 12)
  return `docket-${basename(path).replace(/\s+/g, '-')}-${hash}`
}
