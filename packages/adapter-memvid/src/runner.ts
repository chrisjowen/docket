import { spawn } from 'node:child_process'

export interface CommandResult {
  /** Exit code; null when a signal ended the process. */
  code: number | null
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Written to the process's stdin, which is then closed. */
  input?: string
  timeoutMs: number
  signal?: AbortSignal | undefined
}

/** Runs the memvid CLI with `args`. Swappable, so tests replay recorded output instead. */
export type CommandRunner = (args: readonly string[], options: RunOptions) => Promise<CommandResult>

/** The memvid CLI could not be run at all - missing, or not executable. */
export class MemvidUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MemvidUnavailableError'
  }
}

/**
 * Environment variables that would make the CLI reach the network: an
 * OpenAI key switches embeddings on, a Memvid key adds a quota call to every
 * search. A child never sees them.
 */
const WITHHELD = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'NVIDIA_API_KEY', 'MEMVID_API_KEY']

/** The child's environment: no telemetry, no model downloads, no hosted calls. */
export const memvidEnvironment = (base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const env = { ...base }
  for (const name of WITHHELD) delete env[name]
  return { ...env, MEMVID_TELEMETRY: '0', MEMVID_OFFLINE: '1' }
}

/**
 * Runs `command` directly - never through a shell - in `cwd`. The process
 * gets its own group, so a timeout or abort also stops the native binary the
 * npm launcher starts.
 */
export const spawnRunner =
  (command: string, cwd: string): CommandRunner =>
  (args, options) =>
    new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason ?? new Error('aborted'))
        return
      }
      const child = spawn(command, args, {
        cwd,
        env: memvidEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))

      const stop = (): void => {
        try {
          if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
          else child.kill('SIGTERM')
        } catch {
          // Already gone.
        }
      }
      const finish = (outcome: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        outcome()
      }
      const onAbort = (): void => {
        stop()
        finish(() => reject(options.signal?.reason ?? new Error('aborted')))
      }
      const timer = setTimeout(() => {
        stop()
        finish(() => reject(new Error(`memvid ${args[0] ?? ''} did not finish within ${options.timeoutMs} ms`)))
      }, options.timeoutMs)
      options.signal?.addEventListener('abort', onAbort, { once: true })

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(() =>
          reject(
            error.code === 'ENOENT' || error.code === 'EACCES'
              ? new MemvidUnavailableError(
                  `The memvid CLI "${command}" could not be run (${error.code}). Install it yourself - ` +
                    '`npm install -g memvid-cli@2.0.160` - or set `command` to its path; docket never installs it.',
                  { cause: error }
                )
              : error
          )
        )
      })
      child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })))
      child.stdin.on('error', () => {
        // The process exited before reading its input; its exit status says why.
      })
      child.stdin.end(options.input ?? '')
    })
