import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

/** The MCP protocol version docket asks for; MemPalace 3.10.0 supports it. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** A JSON-RPC error the server answered with. MemPalace uses -32001 for a palace another process is writing. */
export class McpError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'McpError'
  }
}

/** The server process could not be started, or is gone. */
export class McpUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'McpUnavailableError'
  }
}

export interface CallOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

/** What the adapter needs of a palace: tool calls, answered with the tool's own JSON. */
export interface ToolClient {
  /** The tool's JSON result. Rejects with an `McpError` when the server reports one. */
  call(tool: string, args: Record<string, unknown>, options?: CallOptions): Promise<unknown>
  close(): Promise<void>
}

export interface McpServerOptions {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  cwd: string
  /** Bounds starting the server and its `initialize` handshake. */
  startupTimeoutMs: number
  /** Bounds each call that sets no timeout of its own. */
  timeoutMs: number
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

const STDERR_LINES = 20

/**
 * The text of a `tools/call` result: one text block of JSON. A front end may
 * put a plain-text notice before it, so the last block that parses wins.
 */
export const toolResultJson = (result: unknown): unknown => {
  const content = (result as { content?: { type?: string; text?: string }[] } | null)?.content ?? []
  for (const block of [...content].reverse()) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try {
      return JSON.parse(block.text) as unknown
    } catch {
      // A notice, not the result.
    }
  }
  throw new McpError('the tool result held no JSON', -32603)
}

/**
 * A minimal MCP client over a child process's stdio: newline-delimited
 * JSON-RPC 2.0, `initialize` then `tools/call`. One server per client; the
 * server exits when the client closes its stdin.
 */
export class McpStdioClient implements ToolClient {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly stderr: string[] = []
  private exited: Error | undefined
  serverInfo: { name?: string; version?: string } = {}

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly options: McpServerOptions
  ) {
    createInterface({ input: child.stdout }).on('line', (line) => this.receive(line))
    createInterface({ input: child.stderr }).on('line', (line) => {
      this.stderr.push(line)
      if (this.stderr.length > STDERR_LINES) this.stderr.shift()
    })
    child.on('exit', (code, signal) => {
      this.exited = new McpUnavailableError(
        `the MemPalace server exited (${signal ?? `code ${String(code)}`})${this.stderrTail()}`
      )
      for (const waiter of this.pending.values()) waiter.reject(this.exited)
      this.pending.clear()
    })
    child.stdin.on('error', () => {
      // The exit handler reports why the server went away.
    })
  }

  /** Starts the server and completes the MCP handshake, or fails saying why. */
  static async start(options: McpServerOptions): Promise<McpStdioClient> {
    const child = spawn(options.command, [...options.args], { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
    const client = new McpStdioClient(child, options)
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('error', (error: NodeJS.ErrnoException) =>
        reject(
          new McpUnavailableError(
            `The MemPalace MCP server "${options.command}" could not be run (${error.code ?? error.message}).`,
            { cause: error }
          )
        )
      )
    })
    try {
      await spawned
      const initialized = (await client.request(
        'initialize',
        { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'docket', version: '1' } },
        { timeoutMs: options.startupTimeoutMs }
      )) as { serverInfo?: { name?: string; version?: string } }
      client.serverInfo = initialized.serverInfo ?? {}
      client.notify('notifications/initialized')
      return client
    } catch (error) {
      await client.close()
      throw error
    }
  }

  async call(tool: string, args: Record<string, unknown>, options: CallOptions = {}): Promise<unknown> {
    return toolResultJson(await this.request('tools/call', { name: tool, arguments: args }, options))
  }

  /** Closes stdin, which ends the server; kills it if it lingers. */
  async close(): Promise<void> {
    // Never started, or already gone.
    if (this.child.pid === undefined || this.child.exitCode !== null || this.child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()))
    this.child.stdin.end()
    const timer = setTimeout(() => this.child.kill('SIGTERM'), 5_000)
    await exited
    clearTimeout(timer)
  }

  private request(method: string, params: unknown, options: CallOptions = {}): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exited)
    if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new Error('aborted'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? this.options.timeoutMs
      const settle = (): void => {
        this.pending.delete(id)
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
      // MemPalace cannot stop a call it has started: a late answer is dropped.
      const abandon = (error: Error): void => {
        settle()
        this.notify('notifications/cancelled', { requestId: id })
        reject(error)
      }
      const onAbort = (): void => abandon(options.signal?.reason instanceof Error ? options.signal.reason : new Error('aborted'))
      const timer = setTimeout(() => abandon(new Error(`MemPalace ${method} did not answer within ${timeoutMs} ms`)), timeoutMs)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (value) => {
          settle()
          resolve(value)
        },
        reject: (error) => {
          settle()
          reject(error)
        }
      })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  private notify(method: string, params?: unknown): void {
    if (this.exited) return
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`)
  }

  private receive(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: { code?: number; message?: string; data?: unknown } }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const waiter = this.pending.get(message.id)
    if (!waiter) return
    if (message.error) {
      waiter.reject(new McpError(message.error.message ?? 'MemPalace error', message.error.code ?? -32603, message.error.data))
    } else waiter.resolve(message.result)
  }

  private stderrTail(): string {
    const tail = this.stderr.slice(-5).join('\n').trim()
    return tail ? `:\n${tail}` : ''
  }
}
