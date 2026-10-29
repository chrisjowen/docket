import { mount, unmount } from 'svelte'

import css from './embed.css?inline'
import EmbeddedCasebook from './embedded-casebook.svelte'
import type { PluginHost, SlotEntry } from './host.js'

/** The tag Wheelhouse draws docket's casebook with: its plugin id, a dash, and a name. */
export const TAG = 'docket-casebook'

/**
 * `<docket-casebook>`: docket open's casebook as a Wheelhouse plugin element.
 * Wheelhouse sets `host` (its plugin host API), `entry` (the slot) and `data`
 * (the provider's value), and sets `data` again when the value changes. It
 * draws in its own shadow root, so its styles and Wheelhouse's stay apart,
 * except Wheelhouse's CSS variables, and follows Wheelhouse's dark theme.
 */
export class DocketCasebookElement extends HTMLElement {
  // Raw: Wheelhouse's values are its own, and its host API is frozen.
  #host = $state.raw<PluginHost | null>(null)
  #data = $state.raw<unknown>(null)
  #dark = $state(false)
  #entry: SlotEntry | null = null
  #app: Record<string, unknown> | null = null
  #theme: MutationObserver | null = null

  get host(): PluginHost | null {
    return this.#host
  }

  set host(value: PluginHost | null) {
    this.#host = value
  }

  get entry(): SlotEntry | null {
    return this.#entry
  }

  set entry(value: SlotEntry | null) {
    this.#entry = value
  }

  get data(): unknown {
    return this.#data
  }

  set data(value: unknown) {
    this.#data = value
  }

  connectedCallback(): void {
    if (this.#app) return
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = css
    root.replaceChildren(style)
    // Wheelhouse marks its dark theme on <html>, as docket open does.
    const html = document.documentElement
    const follow = (): void => {
      this.#dark = html.classList.contains('dark')
    }
    follow()
    this.#theme = new MutationObserver(follow)
    this.#theme.observe(html, { attributes: true, attributeFilter: ['class'] })
    // Getters, so the casebook follows each new value Wheelhouse sets.
    const element = this
    this.#app = mount(EmbeddedCasebook, {
      target: root,
      props: {
        get host() {
          return element.#host
        },
        get data() {
          return element.#data
        },
        get dark() {
          return element.#dark
        },
        origin: location.origin
      }
    })
  }

  disconnectedCallback(): void {
    this.#theme?.disconnect()
    this.#theme = null
    if (this.#app) void unmount(this.#app)
    this.#app = null
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, DocketCasebookElement)
