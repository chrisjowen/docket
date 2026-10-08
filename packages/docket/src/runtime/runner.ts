import { spawn } from 'node:child_process'

/** One external command, run without a shell: every argument is passed as-is. */
export interface CommandInvocation {
  command: string
  args: readonly string[]
  cwd: string
  /** Also copy its output to this process's own stdout and stderr as it arrives. */
  stream?: boolean | undefined
}

export interface CommandOutcome {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Runs the commands a runtime provider issues. Injectable, so tests assert the
 * exact invocations without Docker installed.
 */
export type CommandRunner = (invocation: CommandInvocation) => Promise<CommandOutcome>

/** The command could not be started at all - most likely it is not installed. */
export class CommandNotFoundError extends Error {
  constructor(readonly command: string) {
    super(`${command} was not found on PATH`)
  }
}

/** The real runner: `child_process.spawn`, inheriting this process's environment. */
export const spawnRunner: CommandRunner = (invocation) =>
  new Promise((done, fail) => {
    const child = spawn(invocation.command, [...invocation.args], {
      cwd: invocation.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (invocation.stream) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (invocation.stream) process.stderr.write(chunk)
    })
    child.on('error', (cause: NodeJS.ErrnoException) =>
      fail(cause.code === 'ENOENT' ? new CommandNotFoundError(invocation.command) : cause)
    )
    child.on('close', (code, signal) => done({ exitCode: code ?? (signal ? 128 : 1), stdout, stderr }))
  })
