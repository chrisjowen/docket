// SPDX-License-Identifier: AGPL-3.0-only
import { cogneeCognifying } from '@docket/platform-projections'
import { tenantRouter } from '@docket/platform-tenancy'

import { releaseStuckLease } from './cognify-lease.js'
import { createPool } from './postgres.js'

/**
 * The operator's release of a stuck cognify lease (docs/cognee.md), only
 * while cognee cannot say whether its run is over. It connects like the
 * worker: the request role from `PG*`, cognee from `DOCKET_COGNEE_URL` and
 * `DOCKET_COGNEE_API_KEY`.
 *
 *   release-cognify-lease.js --by <operator>
 *
 * On the cluster:
 *   kubectl exec deploy/docket-cloud-worker -- /nodejs/bin/node worker/release-cognify-lease.js --by alice
 */

const USAGE = 'usage: release-cognify-lease.js --by <operator>'

async function main(argv: string[]): Promise<number> {
  const [flag, by] = argv
  if (argv.length !== 2 || flag !== '--by' || !by) {
    console.error(USAGE)
    return 2
  }
  const url = process.env.DOCKET_COGNEE_URL
  const apiKey = process.env.DOCKET_COGNEE_API_KEY
  if (!url || !apiKey) {
    console.error('refused: DOCKET_COGNEE_URL and DOCKET_COGNEE_API_KEY must be set, to ask cognee whether the stuck run is over')
    return 2
  }
  const pool = createPool(2, (message) => console.error(message))
  try {
    const router = tenantRouter(pool)
    const outcome = await releaseStuckLease(router, { by, cognifying: (orgId, workspaceId) => cogneeCognifying({ url, apiKey }, orgId, workspaceId) })
    if ('refused' in outcome) {
      console.error(`refused: ${outcome.refused}`)
      return 1
    }
    const { released } = outcome
    console.log(`released the cognify lease of org ${released.orgId} workspace ${released.workspaceId}, stuck since ${released.stuckAt?.toISOString()}`)
    console.log("warning: cognee could not be reached to say whether that run is over; if it is still running, its remaining model calls count to the next workspace's cognee limit")
    return 0
  } finally {
    await pool.end()
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`release failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    process.exitCode = 1
  },
)
