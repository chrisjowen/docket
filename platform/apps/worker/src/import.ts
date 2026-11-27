// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from 'node:path'
import { text } from 'node:stream/consumers'

import { keyring } from '@docket/platform-canonical-store'
import { platformKeyService, readKekFile } from '@docket/platform-keys'
import { tenantRouter } from '@docket/platform-tenancy'

import { ImportRefused, importDocketTree, parseDocketTree, readDocketTree, type ImportResult } from './import-docket.js'
import { createPool } from './postgres.js'

/**
 * The operator's import of a docket tree into an existing workspace (§6.1),
 * until repo sync and the CLI exist. It connects like the worker: the request
 * role from `PG*`, the KEK from `DOCKET_KEK_FILE`.
 *
 *   import.js <org> <workspace> <path to .docket> [--dry-run]
 *   import.js <org> <workspace> - [--dry-run]     the tree packed as JSON on stdin
 *   import.js --pack <path to .docket>            print the tree packed as JSON, for `-`
 *
 * The image has no shell or tar, so on the cluster the tree goes in packed:
 *   import.js --pack ../wheelhouse/.docket | kubectl exec -i deploy/docket-cloud-worker -- /nodejs/bin/node worker/import.js acme platform -
 */

const USAGE = `usage: import.js <org> <workspace> <path to .docket | -> [--dry-run]
       import.js --pack <path to .docket>`

/** Paths as the operator typed them: `pnpm --filter` runs this in apps/worker, and says where it was run from in INIT_CWD. */
const fromOperator = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path)

function report(result: ImportResult): string {
  const lines = [
    `${result.dryRun ? 'dry run, nothing written: ' : ''}${result.org}/${result.workspace}`,
    result.ontologyPublished === null
      ? `ontology: unchanged (v${result.ontologyHead} already matches the tree's)`
      : `ontology: the tree's differed from the workspace's; published it as v${result.ontologyPublished}`,
    `documents: ${result.written.length} written, ${result.unchanged} unchanged; ${result.documents} live in the workspace`,
    ...result.written.map((id) => `  + ${id}`),
    ...(result.warnings.length ? [`warnings: ${result.warnings.length}`, ...result.warnings.map((d) => `  ${d.path}: ${d.message}`)] : []),
  ]
  return lines.join('\n')
}

async function main(argv: string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const args = argv.filter((arg) => arg !== '--dry-run')
  if (args[0] === '--pack' && args.length === 2) {
    process.stdout.write(JSON.stringify(await readDocketTree(fromOperator(args[1] as string))))
    return 0
  }
  const [orgSlug, workspaceSlug, from] = args
  if (args.length !== 3 || !orgSlug || !workspaceSlug || !from) {
    console.error(USAGE)
    return 2
  }
  const tree = from === '-' ? parseDocketTree(await text(process.stdin)) : await readDocketTree(fromOperator(from))

  const kek = await readKekFile(process.env.DOCKET_KEK_FILE ?? '/etc/docket/kek/kek')
  const pool = createPool(2, (message) => console.error(message))
  try {
    const router = tenantRouter(pool)
    const keys = await platformKeyService({ kek, kekId: process.env.DOCKET_KEK_ID ?? 'platform-v1' })
    const result = await importDocketTree({ router, keyring: keyring({ keys, platform: (fn) => router.withPlatform(fn) }) }, { orgSlug, workspaceSlug, tree, dryRun })
    console.log(report(result))
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
    console.error(error instanceof ImportRefused ? `refused: ${error.message}` : `import failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    process.exitCode = 1
  },
)
