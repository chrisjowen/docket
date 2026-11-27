// SPDX-License-Identifier: AGPL-3.0-only
import { tenantRouter } from '@docket/platform-tenancy'

import { USAGE, masterKeyTool, parseMasterKeyCommand } from './master-key-tool.js'
import { createPool } from './postgres.js'

/**
 * The operator's org master keys (ops/runbooks/master-keys.md). It connects
 * like the worker: the request role from `PG*`.
 *
 *   master-keys.js mint <org> --by <operator> [--ttl-days <1-730>] [--database-limit <n>]
 *   master-keys.js list <org>
 *   master-keys.js revoke <org> (<key id> | --all) --by <operator>
 *
 * On the cluster, with the minted key piped straight into a secret store:
 *   kubectl exec deploy/docket-cloud-worker -- /nodejs/bin/node worker/master-keys.js mint acme --by alice | <your secret store>
 */

async function main(argv: string[]): Promise<number> {
  const command = parseMasterKeyCommand(argv)
  if (!command) {
    console.error(USAGE)
    return 2
  }
  const pool = createPool(2, (message) => console.error(message))
  try {
    return await masterKeyTool(command, { router: tenantRouter(pool), stdout: process.stdout, stderr: process.stderr })
  } finally {
    await pool.end()
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`master-keys failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    process.exitCode = 1
  },
)
