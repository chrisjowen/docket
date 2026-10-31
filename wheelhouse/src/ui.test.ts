// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/*
 * The built casebook element (ui/index.js), as Wheelhouse mounts it: it sets
 * `host`, `entry` and `data`, then appends it. The viewer's API is a stub.
 */

const VIEWER = 'http://127.0.0.1:4400'

interface View {
  state: 'running' | 'stopped' | 'starting' | 'failed' | 'occupied' | 'unavailable'
  url: string | null
  reason: string | null
  launchable: boolean
  hint: string | null
}

const stopped: View = { state: 'stopped', url: VIEWER, reason: null, launchable: true, hint: 'cd /work/shop && docket open --port 4400' }
const running: View = { ...stopped, state: 'running' }

const data = (over: Record<string, unknown> = {}) => ({
  schema: 'wheelhouse-docket-casebook.v1',
  state: 'docket',
  root: '/work/shop',
  configuredRoot: false,
  origins: [location.origin],
  problem: null,
  docket: { source: 'plugin', version: '0.6.0', command: '/usr/bin/node /p/docket/dist/cli.js' },
  ...over
})

const GRAPH = {
  project: { name: 'shop', root: '/work/shop' },
  entities: [
    {
      id: 'service.orders',
      type: 'service',
      title: 'Orders API',
      path: '.docket/resources/services/orders.md',
      paths: ['.docket/resources/services/orders.md'],
      tags: [],
      attributes: {},
      links: [{ rel: 'owned_by', target: 'team.payments' }],
      mentions: [],
      content: 'Takes orders.',
      evidence: [],
      frontmatter: {}
    },
    {
      id: 'team.payments',
      type: 'team',
      title: 'Payments',
      path: '.docket/resources/teams/payments.md',
      paths: ['.docket/resources/teams/payments.md'],
      tags: [],
      attributes: {},
      links: [],
      mentions: [],
      content: 'Owns checkout.',
      evidence: [],
      frontmatter: {}
    }
  ],
  edges: [{ source: 'service.orders', rel: 'owned_by', target: 'team.payments', dangling: false }],
  types: [
    { name: 'service', icon: 'server' },
    { name: 'team', icon: 'users' }
  ],
  relationships: [{ name: 'owned_by' }],
  diagnostics: [],
  index: { synced: true, behind: 0 }
}

/** docket open's API as the element reads it: health, the graph, sync status and adapters. */
const api = () =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === `${VIEWER}/api/health`) return json({ service: 'docket-open', root: '/work/shop', allowOrigins: [location.origin] })
    if (url === `${VIEWER}/api/graph`) return json(GRAPH)
    if (url === `${VIEWER}/api/sync`) return json({ run: null, adapters: [], outOfDate: false })
    if (url === `${VIEWER}/api/adapters`) return json({ adapters: [], query: { defaultAdapters: [], synthesis: true }, diagnostics: [] })
    return new Response(JSON.stringify({ error: `No API at ${url}` }), { status: 404 })
  })

type Element = HTMLElement & { host: unknown; entry: unknown; data: unknown }

const mount = (host: { service: (s: string) => Promise<View | null>; launch: (s: string) => Promise<View | null> }, value: unknown): Element => {
  const element = document.createElement('docket-casebook') as Element
  element.host = Object.freeze({ pluginId: 'docket', ...host })
  element.entry = { key: 'project:shop/docket/casebook', slot: 'project.tab', pluginId: 'docket', contributionId: 'casebook', title: 'Docket', projectId: 'shop' }
  element.data = value
  document.body.append(element)
  return element
}

/** What the element's shadow root shows: its text, without its stylesheets. */
const textOf = (element: Element): string =>
  [...(element.shadowRoot?.childNodes ?? [])]
    .filter((node) => node.nodeName !== 'STYLE')
    .map((node) => node.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')

/** Waits until the element's shadow root shows `text`. */
const shows = async (element: Element, text: string): Promise<string> => {
  await vi.waitFor(
    () => {
      const content = textOf(element)
      if (!content.includes(text)) throw new Error(`still showing: ${content.slice(0, 600)}`)
    },
    { timeout: 3_000, interval: 20 }
  )
  return textOf(element)
}

const button = (element: Element, label: string): HTMLButtonElement => {
  const found = [...(element.shadowRoot?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label)
  if (!found) throw new Error(`no ${label} button`)
  return found
}

beforeAll(async () => {
  // @ts-expect-error The built bundle has no type declarations.
  await import('../ui/index.js')
})

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark')
  vi.unstubAllGlobals()
})

describe('<docket-casebook>', () => {
  it('is defined by the bundle, and draws in its own shadow root with its styles', async () => {
    expect(customElements.get('docket-casebook')).toBeDefined()
    const element = mount({ service: async () => stopped, launch: async () => running }, data())
    await shows(element, 'docket’s viewer is not running')
    expect(element.shadowRoot?.querySelector('style')?.textContent).toContain('--spine')
  })

  it('offers Launch while the viewer is stopped, starts it through the host on a click, then opens the casebook', async () => {
    vi.stubGlobal('fetch', api())
    let view = stopped
    const launch = vi.fn(async () => {
      view = running
      return running
    })
    const element = mount({ service: async () => view, launch }, data())
    const text = await shows(element, 'docket’s viewer is not running')
    expect(text).toContain('cd /work/shop && docket open --port 4400')
    expect(text).toContain('Runs docket 0.6.0, shipped with this plugin.')
    button(element, 'Launch').click()
    await shows(element, '2 exhibits, 1 relationship')
    expect(launch).toHaveBeenCalledWith('viewer')
  })

  it('draws the whole casebook from a running viewer: views, search, sync and the inspector', async () => {
    const fetch = api()
    vi.stubGlobal('fetch', fetch)
    const element = mount({ service: async () => running, launch: async () => running }, data())
    const text = await shows(element, '2 exhibits, 1 relationship')
    for (const label of ['Browse', 'Ask', 'Adapters', 'Graph', 'Table', 'History', 'Inspector', 'Chat']) expect(text).toContain(label)
    expect(element.shadowRoot?.querySelector('input[name="quick-search"]')).not.toBeNull()
    expect(element.shadowRoot?.querySelector('[aria-label="Sync the projections"]')).not.toBeNull()
    // Every request goes to the viewer, never to Wheelhouse's own origin.
    expect(fetch.mock.calls.map(([url]) => String(url)).every((url) => url.startsWith(`${VIEWER}/api/`))).toBe(true)

    button(element, 'Adapters').click()
    await shows(element, 'No adapters configured')
    button(element, 'Ask').click()
    await shows(element, 'Ask the adapters')
  })

  it('follows Wheelhouse’s dark theme', async () => {
    vi.stubGlobal('fetch', api())
    const element = mount({ service: async () => running, launch: async () => running }, data())
    await shows(element, '2 exhibits')
    const root = () => element.shadowRoot?.querySelector('div.flex-col.text-foreground')
    expect(root()?.classList.contains('dark')).toBe(false)
    document.documentElement.classList.add('dark')
    await vi.waitFor(() => expect(root()?.classList.contains('dark')).toBe(true))
  })

  it('says when this Wheelhouse is not a page the viewer allows', async () => {
    const element = mount({ service: async () => running, launch: async () => running }, data({ origins: ['http://127.0.0.1:9999'] }))
    const text = await shows(element, 'This Wheelhouse is not one docket’s viewer allows')
    expect(text).toContain(`Add "${location.origin}" to "origins"`)
  })

  it('says when a viewer runs but does not answer this page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const element = mount({ service: async () => running, launch: async () => running }, data())
    const text = await shows(element, 'docket’s viewer does not answer this page')
    expect(text).toContain('started by hand')
    expect(() => button(element, 'Launch')).toThrow()
  })

  it('says why docket cannot be shown, and when there is no docket', async () => {
    const old = mount(
      { service: async () => null, launch: async () => null },
      data({
        problem: 'The docket CLI the docket plugin’s settings name (/opt/docket) is too old to be shown in Wheelhouse.',
        docket: { source: 'settings', version: null, command: '/opt/docket' }
      })
    )
    const text = await shows(old, 'too old to be shown in Wheelhouse')
    expect(text).toContain('Runs a docket that does not say its version at /opt/docket, set by "bin" in the plugin’s settings.')
    const none = mount({ service: async () => null, launch: async () => null }, data({ state: 'none' }))
    await shows(none, 'No docket here')
  })
})
