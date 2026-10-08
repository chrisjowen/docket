import { getContext, setContext } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'

import { createAskClient, type AdaptersState, type AskClient } from './ask/client.js'
import { evidenceIndex, type AskOutcome, type EvidenceIndex } from './ask/outcome.js'
import type { ChatTurn } from './components/chat-panel.svelte'
import type { UiAnswer, UiEdge, UiGraph } from './types.js'

/*
 * State every route shares: the canonical graph, what the inspector shows, the
 * board's filters and scope, the Ask session and the chat. It lives above the
 * routes, so moving between Browse, Ask and Adapters loses none of it.
 */

/** What the inspector beside every route shows. */
export type InspectorTarget = { kind: 'exhibit'; id: string } | { kind: 'evidence'; evidenceId: string }

/** Ask the board to bring these entities into frame; a new nonce asks again. */
export interface FocusRequest {
  ids: string[]
  nonce: number
}

/** A set of exhibits, and only the relationships that were returned with them, for the board to show alone. */
export interface BoardScope {
  /** What it is, for the banner: "the answer to …". */
  label: string
  ids: string[]
  links: Pick<UiEdge, 'source' | 'rel' | 'target'>[]
}

export type BrowseView = 'graph' | 'table' | 'history'

/** Long enough for slow engines; short enough that a hung one never leaves Ask waiting forever. */
export const ASK_TIMEOUT_MS = 90_000

export class AskSession {
  question = $state('')
  /** Adapter ids to ask; null asks the configured defaults. */
  adapters = $state<string[] | null>(null)
  synthesis = $state(true)
  outcome = $state.raw<AskOutcome | null>(null)
  pending = $state<{ requestId: string; question: string; adapters: string[] | null } | null>(null)
  failure = $state<string | null>(null)

  #controller: AbortController | null = null
  #client: AskClient

  constructor(client: AskClient) {
    this.#client = client
  }

  /** Asks the question, cancelling any question still out: a late answer never replaces a newer one. */
  async ask(question: string): Promise<void> {
    this.cancel()
    const controller = new AbortController()
    this.#controller = controller
    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ask-${Date.now()}`
    const adapters = this.adapters
    this.pending = { requestId, question, adapters }
    this.failure = null
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), ASK_TIMEOUT_MS)
    try {
      const outcome = await this.#client.ask({
        question,
        requestId,
        synthesis: this.synthesis,
        signal: controller.signal,
        ...(adapters ? { adapters } : {})
      })
      if (this.pending?.requestId !== requestId) return
      this.outcome = outcome
    } catch (cause) {
      if (this.pending?.requestId !== requestId) return
      const reason = controller.signal.reason as unknown
      this.failure =
        reason instanceof DOMException && reason.name === 'TimeoutError'
          ? `No answer within ${ASK_TIMEOUT_MS / 1000} seconds, so the question was cancelled.`
          : controller.signal.aborted
            ? null
            : cause instanceof Error
              ? cause.message
              : String(cause)
    } finally {
      clearTimeout(timer)
      if (this.pending?.requestId === requestId) {
        this.pending = null
        this.#controller = null
      }
    }
  }

  cancel(): void {
    this.#controller?.abort()
    this.#controller = null
    this.pending = null
  }

  readonly evidence: EvidenceIndex = $derived(this.outcome ? evidenceIndex(this.outcome) : new Map())
}

export class Workspace {
  readonly client: AskClient

  graph = $state.raw<UiGraph | null>(null)
  loadError = $state<string | null>(null)
  loading = $state(false)

  inspector = $state.raw<InspectorTarget | null>(null)
  sideTab = $state<'inspector' | 'chat'>('inspector')
  panelOpen = $state(true)
  showFilters = $state(true)

  browseView = $state<BrowseView>('graph')
  readonly hiddenTypes = new SvelteSet<string>()
  readonly hiddenRels = new SvelteSet<string>()
  showUnresolved = $state(true)

  /** What the board shows alone, when `scoped`. */
  scope = $state.raw<BoardScope | null>(null)
  scoped = $state(false)
  /** A relationship picked in quick search: its two ends stay emphasised. */
  pickedEdge = $state.raw<UiEdge | null>(null)
  focus = $state.raw<FocusRequest | null>(null)
  #nonce = 0

  readonly ask: AskSession
  adapters = $state.raw<AdaptersState | null>(null)
  #adaptersLoading: Promise<void> | null = null
  turns = $state<ChatTurn[]>([])

  constructor(client: AskClient = createAskClient()) {
    this.client = client
    this.ask = new AskSession(client)
  }

  readonly selected = $derived(this.inspector?.kind === 'exhibit' ? this.inspector.id : null)

  async load(): Promise<void> {
    this.loading = true
    try {
      const response = await fetch('/api/graph')
      const body = (await response.json()) as UiGraph | { error: string }
      if (!response.ok || 'error' in body) throw new Error('error' in body ? body.error : response.statusText)
      this.graph = body
      this.loadError = null
    } catch (cause) {
      this.loadError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      this.loading = false
    }
  }

  /** Reads adapter status once; `refresh` reads it again. Viewing it never starts or pulls anything. */
  loadAdapters(refresh = false): Promise<void> {
    if (this.#adaptersLoading && !refresh) return this.#adaptersLoading
    this.#adaptersLoading = this.client.adapters().then((state) => {
      this.adapters = state
    })
    return this.#adaptersLoading
  }

  request(ids: string[]): void {
    this.#nonce += 1
    this.focus = { ids, nonce: this.#nonce }
  }

  /** Make sure an entity is on the board before pointing at it. */
  reveal(id: string): void {
    // Leaving a scope for something outside it shows the whole casebook again.
    if (this.scoped && this.scope) {
      if (this.scope.ids.includes(id)) return
      this.scoped = false
    }
    const entity = this.graph?.entities.find((item) => item.id === id)
    if (entity) this.hiddenTypes.delete(entity.type)
    else this.showUnresolved = true
  }

  /** Open an exhibit in the inspector. */
  select(id: string | null, options: { focus?: boolean } = {}): void {
    this.pickedEdge = null
    this.inspector = id ? { kind: 'exhibit', id } : null
    if (id) {
      this.sideTab = 'inspector'
      this.panelOpen = true
      this.reveal(id)
      if (options.focus) this.request([id])
    }
  }

  /** Open one piece of an answer's evidence in the inspector. */
  inspectEvidence(evidenceId: string): void {
    this.inspector = { kind: 'evidence', evidenceId }
    this.sideTab = 'inspector'
    this.panelOpen = true
  }

  pickEdge(edge: UiEdge): void {
    this.scoped = false
    this.select(edge.source)
    this.pickedEdge = edge
    this.reveal(edge.target)
    this.hiddenRels.delete(edge.rel)
    this.request([edge.source, edge.target])
  }

  /** Put these exhibits, and only these, on the board. */
  showScope(scope: BoardScope): void {
    this.scope = scope
    this.scoped = true
    this.pickedEdge = null
    this.browseView = 'graph'
    if (scope.ids.length > 0) this.request(scope.ids)
  }

  showEverything(): void {
    this.scoped = false
    this.request(this.selected ? [this.selected] : (this.graph?.entities.map((entity) => entity.id) ?? []))
  }
}

/** A legacy answer - a chat reply's - as a board scope: what it found and the canonical paths joining them. */
export const scopeOfAnswer = (answer: UiAnswer): BoardScope => ({
  label: `the exhibits cited for “${answer.query}”`,
  ids: [...new Set([...answer.documents.map((document) => document.id), ...answer.paths.flatMap((path) => path.nodes)])],
  links: answer.paths.flatMap((path) =>
    path.steps.map((step, index) => {
      const [a, b] = [path.nodes[index] ?? '', path.nodes[index + 1] ?? '']
      return step.forward ? { source: a, rel: step.rel, target: b } : { source: b, rel: step.rel, target: a }
    })
  )
})

const KEY = Symbol('workspace')

export const setWorkspace = (workspace: Workspace): Workspace => setContext(KEY, workspace)

export const getWorkspace = (): Workspace => getContext<Workspace>(KEY)
