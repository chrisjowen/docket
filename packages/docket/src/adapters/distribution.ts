import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { V1_PROJECTION_MODULES } from '../config/config.js'
import { findPackageDir, type AdapterDistribution } from './resolve-module.js'

/** Where the build copies each distributed package: `dist/bundled/<name without scope>`. */
const BUNDLED_ROOT = fileURLToPath(new URL('../bundled/', import.meta.url))

/**
 * The adapter packages the standard `@chrisjowen/docket` distribution ships
 * with - the ones v1 `projections` entries name. Core never imports them: it
 * loads them like any other adapter module, so a minimal core deployment can
 * leave any of them out, and a project can install its own copy instead.
 *
 * Built, a copy is the one under `dist/bundled`; run from its sources in the
 * workspace, it is the package installed alongside docket itself.
 */
export const standardDistribution: AdapterDistribution = {
  packages: Object.values(V1_PROJECTION_MODULES),
  find(name) {
    if (!this.packages.includes(name)) return undefined
    const bundled = join(BUNDLED_ROOT, name.slice(name.indexOf('/') + 1))
    if (existsSync(join(bundled, 'package.json'))) return bundled
    return findPackageDir(name, fileURLToPath(new URL('.', import.meta.url)))
  }
}
