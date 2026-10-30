/**
 * The parts of Wheelhouse's plugin contract (apiVersion 1) this plugin uses,
 * as Wheelhouse's SDK (`@chrisjowen/wheelhouse-plugin-sdk`, in
 * github.com/chrisjowen/wheelhouse, packages/plugin-sdk) defines them.
 */

export type Available<T> =
  | { available: true; value: T; source: string; observedAt: string | null }
  | { available: false; reason: string }

export interface Project {
  id: string
  name: string
  description: string | null
  /** The project's clone, when Firstmate recorded one. */
  path: string | null
}

export type Root = 'project' | 'task' | 'home'

export interface ExecRequest {
  argv: string[]
  cwd: Root
  project?: string
  timeoutMs: number
  maxBytes: number
}

export type ExecResult = { ok: true; stdout: string } | { ok: false; reason: string; stdout: string; stderr: string }

export interface ProviderContext {
  project: Project | null
  projects: Project[]
  exec(c: ExecRequest): Promise<ExecResult>
  readFile(rel: string, o: { root: Root; maxBytes: number; project?: string }): Promise<string | null>
  settings: Record<string, unknown>
  signal: AbortSignal
}

export interface ServiceContext extends ProviderContext {
  servicePort(preferred: number, avoid?: number[]): Promise<number>
}

export interface ServiceSpec {
  url: string
  health: string
  identity?: { url: string; path: string[]; value?: string }
  argv: string[]
  cwd: string
  env?: Record<string, string>
  binds: 'loopback' | 'all'
  readyTimeoutMs?: number
}

export type ServiceResolution =
  | { available: true; spec: ServiceSpec; hint?: string | null; note?: string | null }
  | { available: false; reason: string; hint?: string | null }

export interface Provider {
  id: string
  scope: 'fleet' | 'project' | 'task'
  ttlMs: number
  timeoutMs?: number
  fetch(ctx: ProviderContext): Promise<Available<unknown>>
}

export interface Contribution {
  slot: 'project.tab'
  id: string
  title: string
  provider: string
  when?: 'always' | 'provider-available'
  render: { element: string }
}

export interface PluginService {
  id: string
  title: string
  scope: 'fleet' | 'project'
  resolve(ctx: ServiceContext): Promise<ServiceResolution>
}

/** An MCP server whose apps the plugin draws: Streamable HTTP at `path` on the address of the plugin's companion `service`. */
export interface PluginMcpServer {
  id: string
  title: string
  service: string
  path: string
}

export interface WheelhousePlugin {
  providers: Provider[]
  contributions: Contribution[]
  services: PluginService[]
  mcpServers: PluginMcpServer[]
}
