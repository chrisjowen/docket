// SPDX-License-Identifier: AGPL-3.0-only
import { redactConsole } from '@docket/platform-audit'

import { startWorker } from './run.js'

/**
 * The worker's process: `startWorker` (run.ts) with its settings from the
 * environment and its probe port, stopped on SIGTERM or SIGINT. `docket serve`
 * and `docket open` run the same worker inside the API's process instead.
 */

// No credential reaches the logs, whichever line prints it (§19).
redactConsole()

const log = (message: string) => console.error(`${new Date().toISOString()} ${message}`)

try {
  const worker = await startWorker()
  const shutdown = (signal: string) => {
    console.log(`${new Date().toISOString()} ${signal}: finishing the workspace in hand`)
    void worker.stop().then(() => process.exit(0))
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
} catch (error: unknown) {
  log(`worker failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  process.exit(1)
}
