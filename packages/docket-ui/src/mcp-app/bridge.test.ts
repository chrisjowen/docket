import { describe, expect, it, vi } from 'vitest'

import { APPS_PROTOCOL, AppBridge, applyHostContext, HOST_TOKENS } from './bridge.js'

/** A host page and the app's own window, enough of each for the bridge. */
const frame = () => {
  const sent: unknown[] = []
  const host = { postMessage: vi.fn((message: unknown) => sent.push(message)) } as unknown as Window
  const self = new EventTarget() as unknown as Window
  const deliver = (data: unknown, source: unknown = host): void => {
    self.dispatchEvent(Object.assign(new Event('message'), { data, source }))
  }
  return { host, self, sent, deliver, bridge: new AppBridge(host, self) }
}

describe('AppBridge', () => {
  it('initializes with the host, then says so, and hands back its context', async () => {
    const { bridge, sent, deliver } = frame()
    const connected = bridge.connect({ name: 'docket-search', version: '1.0.0' }, ['inline', 'fullscreen'])
    expect(sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'ui/initialize',
      params: {
        protocolVersion: APPS_PROTOCOL,
        appInfo: { name: 'docket-search', version: '1.0.0' },
        appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }
      }
    })
    deliver({ jsonrpc: '2.0', id: 1, result: { hostContext: { theme: 'dark' } } })
    await expect(connected).resolves.toEqual({ theme: 'dark' })
    expect(sent[1]).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })
  })

  it('settles each request by its id, with the host\'s error as a rejection', async () => {
    const { bridge, deliver } = frame()
    const first = bridge.request('tools/call', { name: 'docket_search', arguments: { query: 'orders' } })
    const second = bridge.request('ui/open-link', { url: 'http://127.0.0.1:4400/#a' })
    deliver({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Links are not opened here.' } })
    deliver({ jsonrpc: '2.0', id: 1, result: { content: [] } })
    await expect(first).resolves.toEqual({ content: [] })
    await expect(second).rejects.toThrow('Links are not opened here.')
  })

  it('hands notifications to their handlers', () => {
    const { bridge, deliver } = frame()
    const seen = vi.fn()
    bridge.on('ui/notifications/tool-result', seen)
    deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { schema: 'x' } } })
    expect(seen).toHaveBeenCalledWith({ structuredContent: { schema: 'x' } })
  })

  it('reads only what the host page sends', () => {
    const { bridge, deliver } = frame()
    const seen = vi.fn()
    bridge.on('ui/notifications/tool-result', seen)
    deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} }, {})
    deliver({ method: 'ui/notifications/tool-result', params: {} })
    expect(seen).not.toHaveBeenCalled()
  })

  it('answers teardown, and refuses any other request of the app', () => {
    const { deliver, sent } = frame()
    deliver({ jsonrpc: '2.0', id: 'a', method: 'ui/resource-teardown', params: {} })
    deliver({ jsonrpc: '2.0', id: 'b', method: 'tools/call', params: {} })
    expect(sent).toEqual([
      { jsonrpc: '2.0', id: 'a', result: {} },
      { jsonrpc: '2.0', id: 'b', error: { code: -32601, message: 'The app does not answer tools/call.' } }
    ])
  })
})

describe('applyHostContext', () => {
  const root = () => {
    const classes = new Set<string>()
    const properties = new Map<string, string>()
    return {
      classes,
      properties,
      element: {
        classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
        style: { colorScheme: '', setProperty: (name: string, value: string) => properties.set(name, value) }
      } as unknown as HTMLElement
    }
  }

  it('follows the host\'s theme', () => {
    const { element, classes } = root()
    applyHostContext({ theme: 'dark' }, element)
    expect(classes.has('dark')).toBe(true)
    expect(element.style.colorScheme).toBe('dark')
    applyHostContext({ theme: 'light' }, element)
    expect(classes.has('dark')).toBe(false)
  })

  it('draws docket\'s tokens in the host\'s colours where it gives them, and ignores the rest', () => {
    const { element, properties } = root()
    applyHostContext(
      { styles: { variables: { '--color-background-primary': '#16191f', '--color-text-primary': '#ebe5d6', '--color-ring-primary': '#f00', '--font-sans': '' } } },
      element
    )
    expect(properties.get('--background')).toBe('#16191f')
    for (const token of HOST_TOKENS['--color-text-primary'] ?? []) expect(properties.get(token)).toBe('#ebe5d6')
    expect([...properties.keys()].some((name) => name.includes('ring'))).toBe(false)
    expect(properties.has('--font-sans')).toBe(false)
  })
})
