import { mount } from 'svelte'

import css from './app.css?inline'
import App from './app.svelte'
import { AppBridge, applyHostContext, type HostContext, type ToolResult } from './bridge.js'

/*
 * docket_search's MCP app (`ui://docket/search.html`): one HTML page with
 * this script and its styles inlined, which an MCP Apps host frames and talks
 * to over postMessage. It needs no network.
 */

const style = document.createElement('style')
style.textContent = css
document.head.append(style)

const root = document.documentElement
// Until the host says which theme it draws in.
if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) root.classList.add('dark')

const view = $state({
  result: null as ToolResult | null,
  input: null as Record<string, unknown> | null,
  displayMode: 'inline',
  displayModes: ['inline'] as string[]
})

const follow = (context: HostContext): void => {
  applyHostContext(context, root)
  if (context.displayMode) view.displayMode = context.displayMode
  if (context.availableDisplayModes) view.displayModes = context.availableDisplayModes
}

const bridge = new AppBridge(window.parent, window)
bridge.on('ui/notifications/tool-input', (params) => {
  const args = (params as { arguments?: unknown } | null)?.arguments
  view.input = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : null
})
bridge.on('ui/notifications/tool-result', (params) => {
  view.result = (params ?? {}) as ToolResult
})
bridge.on('ui/notifications/tool-cancelled', (params) => {
  const reason = (params as { reason?: unknown } | null)?.reason
  view.result = { content: [{ type: 'text', text: `The search was cancelled${typeof reason === 'string' ? `: ${reason}` : '.'}` }], isError: true }
})
bridge.on('ui/notifications/host-context-changed', (params) => follow((params ?? {}) as HostContext))

mount(App, {
  target: document.body,
  props: {
    bridge,
    displayModes: () => view.displayModes,
    displayMode: () => view.displayMode,
    result: () => view.result,
    input: () => view.input,
    onresult: (result) => (view.result = result),
    ondisplaymode: (mode) => (view.displayMode = mode)
  }
})

void bridge.connect({ name: 'docket-search', version: '1.0.0' }, ['inline', 'fullscreen']).then((context) => {
  follow(context)
  // The page's own height, so the host can shrink the frame as well as grow it.
  const size = (): void => {
    const box = document.body.getBoundingClientRect()
    bridge.notify('ui/notifications/size-changed', { width: Math.ceil(box.width), height: Math.ceil(box.height) })
  }
  new ResizeObserver(size).observe(document.body)
  size()
})
