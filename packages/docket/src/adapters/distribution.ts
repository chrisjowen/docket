import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CLOUD_ADAPTER_MODULE } from '../cloud/project.js'
import { V1_PROJECTION_MODULES } from '../config/config.js'
import { findPackageDir, type AdapterDistribution } from './resolve-module.js'

/** The cognee adapter, which docket ships though no v1 projection names it. */
export const COGNEE_ADAPTER_MODULE = '@docket/adapter-cognee'

/** Where the build copies each distributed package: `dist/bundled/<name without scope>`. */
const BUNDLED_ROOT = fileURLToPath(new URL('../bundled/', import.meta.url))

/**
 * The adapter packages the standard `@chrisjowen/docket` distribution ships
 * with - the ones v1 `projections` entries name, the cognee adapter, and the
 * cloud adapter `docket cloud link` configures. Core never imports them: it
 * loads them like any other adapter module, so a minimal core deployment can
 * leave any of them out, and a project can install its own copy instead.
 *
 * Built, a copy is the one under `dist/bundled`; run from its sources in the
 * workspace, it is the package installed alongside docket itself.
 */
export const standardDistribution: AdapterDistribution = {
  packages: [...Object.values(V1_PROJECTION_MODULES), COGNEE_ADAPTER_MODULE, CLOUD_ADAPTER_MODULE],
  find(name) {
    if (!this.packages.includes(name)) return undefined
    const bundled = join(BUNDLED_ROOT, name.slice(name.indexOf('/') + 1))
    if (existsSync(join(bundled, 'package.json'))) return bundled
    return findPackageDir(name, fileURLToPath(new URL('.', import.meta.url)))
  }
}
