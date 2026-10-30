/*
 * The app's side of the MCP Apps bridge (the `io.modelcontextprotocol/ui`
 * extension, stable spec 2026-01-26): JSON-RPC 2.0 over postMessage with the
 * host page that frames it. Only messages from that page are read.
 */

/** What the host says about where the app is drawn: its theme, colours and display modes. */
export interface HostContext {
  theme?: 'light' | 'dark'
  styles?: { variables?: Record<string, string> }
  displayMode?: string
  availableDisplayModes?: string[]
}

/** A tool's result, as the host hands it to the app: MCP's CallToolResult. */
export interface ToolResult {
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }

/** The MCP Apps protocol version the app asks for. */
export const APPS_PROTOCOL = '2026-01-26'

export class AppBridge {
  #next = 1
  #pending = new Map<number | string, { resolve: (value: unknown) => void; reject: (cause: Error) => void }>()
  #handlers = new Map<string, (params: unknown) => void>()

  constructor(
    private readonly host: Window,
    self: Window
  ) {
    self.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== this.host) return
      this.#receive(event.data as Message)
    })
  }

  /** Ask the host something; resolves with its result, rejects with its error. */
  request(method: string, params: unknown = {}): Promise<unknown> {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.host.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
    })
  }

  notify(method: string, params: unknown = {}): void {
    this.host.postMessage({ jsonrpc: '2.0', method, params }, '*')
  }

  /** Handle the host's notification `method`. */
  on(method: string, handler: (params: unknown) => void): void {
    this.#handlers.set(method, handler)
  }

  /** `ui/initialize`, then `ui/notifications/initialized`: the host's context once it has answered. */
  async connect(appInfo: { name: string; version: string }, displayModes: string[]): Promise<HostContext> {
    const result = (await this.request('ui/initialize', {
      protocolVersion: APPS_PROTOCOL,
      appInfo,
      appCapabilities: { availableDisplayModes: displayModes }
    })) as { hostContext?: HostContext } | null
    this.notify('ui/notifications/initialized')
    return result?.hostContext ?? {}
  }

  #receive(message: Message): void {
    if (!message || message.jsonrpc !== '2.0') return
    if (message.method === undefined) {
      if (message.id === undefined) return
      const waiting = this.#pending.get(message.id)
      if (!waiting) return
      this.#pending.delete(message.id)
      if (message.error) waiting.reject(new Error(message.error.message ?? 'The host refused.'))
      else waiting.resolve(message.result)
      return
    }
    if (message.id !== undefined) {
      // The host's one request of an app: let go before it is torn down. The app holds nothing to release.
      const result = message.method === 'ui/resource-teardown' ? { result: {} } : { error: { code: -32601, message: `The app does not answer ${message.method}.` } }
      this.host.postMessage({ jsonrpc: '2.0', id: message.id, ...result }, '*')
      return
    }
    this.#handlers.get(message.method)?.(message.params)
  }
}

/**
 * Which of docket's tokens each of the host's style variables sets, so the app
 * draws in the host's colours where it gives them, and docket's own where not.
 */
export const HOST_TOKENS: Record<string, string[]> = {
  '--color-background-primary': ['--background'],
  '--color-background-secondary': ['--card', '--popover', '--secondary'],
  '--color-text-primary': ['--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground'],
  '--color-text-secondary': ['--muted-foreground'],
  '--color-border-primary': ['--border', '--input'],
  '--border-radius-md': ['--radius'],
  '--font-sans': ['--font-sans']
}

/** Apply a host context's theme and colours to the document. */
export const applyHostContext = (context: HostContext, root: HTMLElement): void => {
  if (context.theme) {
    root.classList.toggle('dark', context.theme === 'dark')
    root.style.colorScheme = context.theme
  }
  for (const [name, value] of Object.entries(context.styles?.variables ?? {})) {
    if (typeof value !== 'string' || value === '') continue
    for (const token of HOST_TOKENS[name] ?? []) root.style.setProperty(token, value)
  }
}
