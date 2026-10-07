import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

import type { Chat } from './ollama-chat.js'

export interface ClaudeChatConfig {
  /** Passed as `--model` when set; else Claude Code's own default. */
  model?: string | undefined
  timeoutMs: number
}

/** `claude` could not be started at all - most likely Claude Code is not installed. */
export class ClaudeNotFoundError extends Error {
  constructor() {
    super('claude was not found on PATH')
  }
}

/**
 * Claude Code in print mode: one prompt in, one reply out, with no tools, no
 * MCP servers and no session kept. The question goes in on stdin and every
 * argument is passed as-is - no shell - so nothing in it is ever interpreted.
 * It runs from the temp directory so no project's CLAUDE.md is read into it.
 */
export const claudeChat =
  (config: ClaudeChatConfig): Chat =>
  (prompt) =>
    new Promise((done, fail) => {
      const args = [
        '-p',
        '--output-format',
        'text',
        '--system-prompt',
        prompt.system,
        '--tools',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        ...(config.model ? ['--model', config.model] : [])
      ]
      const child = spawn('claude', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })

      let stdout = ''
      let stderr = ''
      let settled = false
      const settle = (outcome: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        outcome()
      }
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      // Given up on at once: anything it started may hold its output open long after.
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        settle(() => fail(new Error(`claude did not answer within ${config.timeoutMs / 1000}s`)))
      }, config.timeoutMs)

      child.on('error', (cause: NodeJS.ErrnoException) =>
        settle(() => fail(cause.code === 'ENOENT' ? new ClaudeNotFoundError() : cause))
      )
      child.on('close', (code, signal) =>
        settle(() => {
          if (code !== 0) {
            const said = (stderr.trim() || stdout.trim()).slice(-500)
            fail(new Error(`claude exited with ${code ?? signal}${said ? `: ${said}` : ''}`))
          } else if (stdout.trim() === '') {
            fail(new Error(`claude returned no reply`))
          } else {
            done(stdout)
          }
        })
      )

      // A child that exits before reading its input closes the pipe; the exit says why.
      child.stdin.on('error', () => {})
      child.stdin.end(prompt.user)
    })
