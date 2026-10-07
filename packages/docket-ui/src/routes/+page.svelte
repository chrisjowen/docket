<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { pushState } from '$app/navigation'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import Moon from '@lucide/svelte/icons/moon'
  import PanelLeft from '@lucide/svelte/icons/panel-left'
  import PanelRight from '@lucide/svelte/icons/panel-right'
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Sun from '@lucide/svelte/icons/sun'
  import X from '@lucide/svelte/icons/x'
  import AskPanel from '$lib/components/ask-panel.svelte'
  import EntityPanel from '$lib/components/entity-panel.svelte'
  import Filters from '$lib/components/filters.svelte'
  import GraphView, { type FocusRequest, type GraphLink, type GraphNode } from '$lib/components/graph-view.svelte'
  import QuickSearch from '$lib/components/quick-search.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import { iconOf } from '$lib/icons.js'
  import { edgeKey, neighbourhood, slotColour, typeSlots } from '$lib/model.js'
  import { setTypeStyle } from '$lib/type-style.js'
  import type { UiAnswer, UiEdge, UiGraph } from '$lib/types.js'

  let graph = $state.raw<UiGraph | null>(null)
  let loadError = $state<string | null>(null)
  let loading = $state(false)

  let selected = $state<string | null>(null)
  let tab = $state<'details' | 'ask'>('details')
  let answer = $state.raw<UiAnswer | null>(null)
  /** The board shows only what the answer cites - nothing else, not even faded. */
  let scoped = $state(false)
  /** A relationship picked in quick search: its two ends stay emphasised. */
  let pickedEdge = $state.raw<UiEdge | null>(null)
  let focus = $state<FocusRequest | null>(null)
  let nonce = 0

  const hiddenTypes = new SvelteSet<string>()
  const hiddenRels = new SvelteSet<string>()
  let showUnresolved = $state(true)
  let showFilters = $state(true)
  let showProblems = $state(false)
  let dark = $state(false)

  // The case file: wide enough to read, resizable, and out of the way when collapsed.
  const PANEL_MIN = 360
  const PANEL_DEFAULT = 540
  let panelOpen = $state(true)
  let panelWidth = $state(PANEL_DEFAULT)
  const panelMax = (): number => Math.max(PANEL_MIN, Math.min(960, Math.round(window.innerWidth * 0.65)))

  function savePanel(): void {
    try {
      localStorage.setItem('docket-panel', JSON.stringify({ open: panelOpen, width: panelWidth }))
    } catch {
      // Private windows may refuse; the layout still works for this visit.
    }
  }

  function restorePanel(): void {
    try {
      const saved = JSON.parse(localStorage.getItem('docket-panel') ?? 'null') as { open?: unknown; width?: unknown } | null
      if (typeof saved?.open === 'boolean') panelOpen = saved.open
      if (typeof saved?.width === 'number') panelWidth = Math.min(panelMax(), Math.max(PANEL_MIN, saved.width))
    } catch {
      // Nothing saved, or storage is blocked: keep the defaults.
    }
  }

  function togglePanel(): void {
    panelOpen = !panelOpen
    savePanel()
  }

  /** Drag the case file's left edge to resize it. */
  function resizePanel(event: PointerEvent): void {
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => {
      panelWidth = Math.min(panelMax(), Math.max(PANEL_MIN, window.innerWidth - next.clientX))
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      savePanel()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  function nudgePanel(event: KeyboardEvent): void {
    const step = event.shiftKey ? 80 : 20
    if (event.key === 'ArrowLeft') panelWidth = Math.min(panelMax(), panelWidth + step)
    else if (event.key === 'ArrowRight') panelWidth = Math.max(PANEL_MIN, panelWidth - step)
    else return
    event.preventDefault()
    savePanel()
  }

  async function load(): Promise<void> {
    loading = true
    try {
      const response = await fetch('/api/graph')
      const body = (await response.json()) as UiGraph | { error: string }
      if (!response.ok || 'error' in body) throw new Error('error' in body ? body.error : response.statusText)
      graph = body
      loadError = null
    } catch (cause) {
      loadError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }

  // The selection lives in the URL hash, so it survives a reload and can be shared.
  const fromHash = (): string | null => {
    try {
      const hash = decodeURIComponent(location.hash.slice(1))
      return hash === '' ? null : hash
    } catch {
      return null
    }
  }

  onMount(() => {
    dark = document.documentElement.classList.contains('dark')
    restorePanel()
    selected = fromHash()
    void load().then(() => {
      if (selected) request([selected])
    })

    const onhash = () => {
      selected = fromHash()
      if (selected) request([selected])
    }
    // Coming back to the tab re-reads the files: they may have been edited meanwhile.
    let lastFocus = Date.now()
    const onfocus = () => {
      if (Date.now() - lastFocus > 2000) void load()
      lastFocus = Date.now()
    }
    window.addEventListener('hashchange', onhash)
    window.addEventListener('focus', onfocus)
    return () => {
      window.removeEventListener('hashchange', onhash)
      window.removeEventListener('focus', onfocus)
    }
  })

  const slots = $derived(typeSlots(graph?.entities ?? []))
  const colourOf = (type: string): string => slotColour(slots.get(type))
  const typeIcons = $derived(new Map(graph?.types.map((type) => [type.name, type.icon]) ?? []))
  const typeIcon = (type: string) => iconOf(type, typeIcons.get(type))
  setTypeStyle({ colour: colourOf, icon: typeIcon })

  const known = $derived(new Set(graph?.entities.map((entity) => entity.id) ?? []))
  const selectedEntity = $derived(graph?.entities.find((entity) => entity.id === selected) ?? null)

  /** Every entity the answer cites: what it found, and what joins them. */
  const answerIds = $derived(
    new Set(answer ? [...answer.documents.map((document) => document.id), ...answer.paths.flatMap((path) => path.nodes)] : [])
  )
  /** The links the answer walks between what it found. */
  const answerLinks = $derived.by(() => {
    const keys = new Set<string>()
    for (const path of answer?.paths ?? []) {
      path.steps.forEach((step, index) => {
        const [a, b] = [path.nodes[index] ?? '', path.nodes[index + 1] ?? '']
        keys.add(edgeKey(step.forward ? { source: a, rel: step.rel, target: b } : { source: b, rel: step.rel, target: a }))
      })
    }
    return keys
  })
  const showingAnswer = $derived(scoped && answer !== null)

  const nodes: GraphNode[] = $derived.by(() => {
    if (!graph) return []
    if (showingAnswer) {
      // Only what the answer cites, whatever the filters say: they are about browsing.
      const byId = new Map(graph.entities.map((entity) => [entity.id, entity]))
      return [...answerIds].map((id) => {
        const entity = byId.get(id)
        return entity
          ? { id, title: entity.title, type: entity.type, ghost: false }
          : { id, title: id, type: '', ghost: true }
      })
    }
    const seen = new Set<string>()
    const visible: GraphNode[] = graph.entities
      .filter((entity) => !hiddenTypes.has(entity.type) && !seen.has(entity.id) && seen.add(entity.id))
      .map((entity) => ({ id: entity.id, title: entity.title, type: entity.type, ghost: false }))
    if (showUnresolved) {
      const ghosts = new Set(
        graph.edges
          .filter((edge) => edge.dangling && !hiddenRels.has(edge.rel) && !hiddenTypes.has(typeOfSource(edge)))
          .map((edge) => edge.target)
      )
      for (const id of [...ghosts].sort()) visible.push({ id, title: id, type: '', ghost: true })
    }
    return visible
  })

  const typeOfSource = (edge: UiEdge): string => graph?.entities.find((entity) => entity.id === edge.source)?.type ?? ''

  const links: GraphLink[] = $derived.by(() => {
    const shown = new Set(nodes.map((node) => node.id))
    const seen = new Set<string>()
    return (graph?.edges ?? [])
      .filter(
        (edge) =>
          (showingAnswer ? answerLinks.has(edgeKey(edge)) : !hiddenRels.has(edge.rel)) &&
          shown.has(edge.source) &&
          shown.has(edge.target)
      )
      .map((edge) => ({ key: edgeKey(edge), source: edge.source, target: edge.target, rel: edge.rel }))
      .filter((link) => !seen.has(link.key) && seen.add(link.key))
  })

  /**
   * What stays at full strength: a picked relationship, or the selection's
   * neighbours. An answer needs none - the board already shows only it - so
   * there, only a selection inside it narrows the focus.
   */
  const emphasis = $derived.by((): { nodes: Set<string>; links: Set<string> } | null => {
    if (!graph) return null
    if (pickedEdge) return { nodes: new Set([pickedEdge.source, pickedEdge.target]), links: new Set([edgeKey(pickedEdge)]) }
    if (selected) {
      const keys = new Set(
        graph.edges.filter((edge) => edge.source === selected || edge.target === selected).map((edge) => edgeKey(edge))
      )
      return { nodes: neighbourhood(graph.edges, selected), links: keys }
    }
    return null
  })

  function request(ids: string[]): void {
    nonce += 1
    focus = { ids, nonce }
  }

  /** Make sure an entity is on the board before pointing at it. */
  function reveal(id: string): void {
    // Leaving an answer for something it does not cite shows the whole casebook again.
    if (showingAnswer) {
      if (answerIds.has(id)) return
      scoped = false
    }
    const entity = graph?.entities.find((item) => item.id === id)
    if (entity) hiddenTypes.delete(entity.type)
    else showUnresolved = true
  }

  function select(id: string | null, options: { focus?: boolean; tab?: 'details' } = {}): void {
    pickedEdge = null
    selected = id
    if (id) {
      reveal(id)
      if (options.tab) tab = options.tab
      if (options.focus) request([id])
    }
    const hash = id ? `#${encodeURIComponent(id)}` : ''
    if (location.hash !== hash) pushState(hash || location.pathname, {})
  }

  function pickEdge(edge: UiEdge): void {
    scoped = false
    select(edge.source, { tab: 'details' })
    pickedEdge = edge
    reveal(edge.target)
    hiddenRels.delete(edge.rel)
    request([edge.source, edge.target])
  }

  function onanswer(next: UiAnswer | null): void {
    answer = next
    pickedEdge = null
    scoped = next !== null
    if (next) showAnswer()
  }

  /** Put the answer's exhibits, and only those, on the board. */
  function showAnswer(): void {
    scoped = true
    if (answerIds.size > 0) request([...answerIds])
  }

  function showEverything(): void {
    scoped = false
    request(selected ? [selected] : nodes.map((node) => node.id))
  }

  function toggleTheme(): void {
    dark = !dark
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('docket-theme', dark ? 'dark' : 'light')
    } catch {
      // Private windows may refuse; the toggle still works for this visit.
    }
  }

  const problems = $derived(graph?.diagnostics ?? [])
  const errors = $derived(problems.filter((problem) => problem.severity === 'error').length)
</script>

<svelte:head>
  <title>{graph ? `${graph.project.name} · docket casebook` : 'docket casebook'}</title>
</svelte:head>

<div class="grid h-dvh grid-rows-[auto_1fr]">
  <header class="bg-spine text-spine-foreground flex items-center gap-3 border-b border-black/20 px-3 py-2">
    <Button
      variant="ghost"
      size="icon-sm"
      class="hover:text-spine-foreground hidden hover:bg-white/10 lg:inline-flex"
      aria-label={showFilters ? 'Hide the index' : 'Show the index'}
      aria-pressed={showFilters}
      onclick={() => (showFilters = !showFilters)}
    >
      <PanelLeft />
    </Button>
    <div class="flex min-w-0 shrink-0 items-baseline gap-2.5">
      <span class="text-gilt font-serif text-xl leading-none font-semibold tracking-wide">docket</span>
      <span class="text-spine-muted hidden font-serif text-sm italic sm:inline">casebook of evidence</span>
      {#if graph}
        <span class="text-spine-foreground hidden truncate text-sm md:inline" title={graph.project.root}>{graph.project.name}</span>
      {/if}
    </div>
    <div class="flex min-w-0 flex-1 justify-center text-foreground">
      {#if graph}
        <QuickSearch {graph} onentity={(id) => select(id, { focus: true, tab: 'details' })} onrelationship={pickEdge} />
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1">
      {#if graph}
        <span class="text-spine-muted hidden text-xs tabular-nums xl:inline">
          {graph.entities.length} {graph.entities.length === 1 ? 'exhibit' : 'exhibits'}, {graph.edges.length}
          {graph.edges.length === 1 ? 'relationship' : 'relationships'}
        </span>
        {#if problems.length > 0}
          <Button
            variant="ghost"
            size="sm"
            class="hover:text-spine-foreground hover:bg-white/10"
            onclick={() => (showProblems = !showProblems)}
            aria-expanded={showProblems}
            aria-label="Validation findings"
          >
            <CircleAlert class={errors > 0 ? 'text-red-300' : 'text-amber-300'} />
            {problems.length}
          </Button>
        {/if}
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        class="hover:text-spine-foreground hover:bg-white/10"
        aria-label="Reload from the files"
        onclick={() => load()}
        disabled={loading}
      >
        <RefreshCw class={loading ? 'animate-spin' : ''} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="hover:text-spine-foreground hover:bg-white/10"
        aria-label={dark ? 'Use the light theme' : 'Use the dark theme'}
        onclick={toggleTheme}
      >
        {#if dark}<Sun />{:else}<Moon />{/if}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="hover:text-spine-foreground hover:bg-white/10"
        aria-label={panelOpen ? 'Collapse the case file' : 'Open the case file'}
        aria-pressed={panelOpen}
        aria-controls="case-file"
        onclick={togglePanel}
      >
        {#if panelOpen}<PanelRightClose />{:else}<PanelRight />{/if}
      </Button>
    </div>
  </header>

  {#if loadError && !graph}
    <div class="grid place-items-center p-6">
      <div class="flex max-w-lg flex-col gap-3 rounded-lg border p-5">
        <div class="flex items-center gap-2 font-serif text-lg"><CircleAlert class="text-destructive size-4" /> Could not open the casebook</div>
        <p class="text-muted-foreground text-sm break-words">{loadError}</p>
        <Button variant="outline" onclick={() => load()}>Try again</Button>
      </div>
    </div>
  {:else if !graph}
    <div class="text-muted-foreground grid place-items-center font-serif italic">Opening the casebook…</div>
  {:else}
    <div class="relative grid min-h-0 grid-cols-1 lg:grid-cols-[auto_1fr_auto]">
      {#if showFilters}
        <aside class="hidden min-h-0 w-64 border-r lg:block" aria-label="Index">
          <ScrollArea class="h-full">
            <Filters {graph} {hiddenTypes} {hiddenRels} bind:showUnresolved />
            <div class="text-muted-foreground border-t px-4 py-3 text-xs">
              Search index:
              {#if !graph.index.synced}
                not synced - run <code class="font-mono">docket sync</code>
              {:else if graph.index.behind > 0}
                {graph.index.behind} {graph.index.behind === 1 ? 'file' : 'files'} behind - run <code class="font-mono">docket sync</code>
              {:else}
                up to date
              {/if}
            </div>
          </ScrollArea>
        </aside>
      {/if}

      <main class="relative min-h-0 min-w-0">
        <GraphView
          {nodes}
          {links}
          {colourOf}
          iconOf={typeIcon}
          {selected}
          {emphasis}
          {focus}
          emptyHint={showingAnswer ? 'The answer cites no exhibits.' : undefined}
          onselect={(id) => select(id, id ? { tab: 'details' } : {})}
        />
        {#if showingAnswer && answer}
          <div class="bg-popover absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">
            <span class="min-w-0 truncate">
              Showing the {answerIds.size} {answerIds.size === 1 ? 'exhibit' : 'exhibits'} cited for “{answer.query}”
            </span>
            <Button variant="outline" size="xs" onclick={showEverything}>Show all exhibits</Button>
          </div>
        {:else if answer && tab === 'ask'}
          <div class="bg-popover absolute top-3 left-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">
            <Button variant="outline" size="xs" onclick={showAnswer}>Show only the answer's exhibits</Button>
          </div>
        {:else if pickedEdge}
          <div class="bg-popover absolute top-3 left-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">
            Relationship <code class="font-mono">{pickedEdge.rel}</code>
            <Button variant="ghost" size="icon-xs" aria-label="Clear" onclick={() => (pickedEdge = null)}><X /></Button>
          </div>
        {/if}
        {#if showProblems && problems.length > 0}
          <div class="bg-popover absolute top-3 right-3 z-20 flex max-h-[60%] w-96 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border shadow-lg">
            <div class="flex items-center justify-between border-b px-3 py-2">
              <span class="section-title">Validation findings ({problems.length})</span>
              <Button variant="ghost" size="icon-xs" aria-label="Close" onclick={() => (showProblems = false)}><X /></Button>
            </div>
            <ul class="flex flex-col divide-y overflow-y-auto text-xs">
              {#each problems as problem, index (index)}
                <li class="flex flex-col gap-0.5 px-3 py-2">
                  <span class="flex items-center gap-1.5">
                    <span class="font-medium {problem.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}">
                      {problem.severity}
                    </span>
                    <code class="font-mono">{problem.code}</code>
                  </span>
                  <span>{problem.message}</span>
                  {#if problem.path}<span class="text-muted-foreground font-mono">{problem.path}</span>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </main>

      {#if panelOpen}
        <aside
          id="case-file"
          aria-label="Case file"
          class="bg-background absolute inset-x-0 bottom-0 flex max-h-[60%] min-h-0 flex-col border-t shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] lg:relative lg:max-h-none lg:w-(--panel) lg:max-w-[65vw] lg:border-t-0 lg:border-l lg:shadow-none"
          style="--panel: {panelWidth}px"
        >
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the case file"
            aria-valuenow={panelWidth}
            aria-valuemin={PANEL_MIN}
            tabindex="0"
            class="hover:bg-gilt/40 focus-visible:bg-gilt/60 absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize outline-none lg:block"
            onpointerdown={resizePanel}
            onkeydown={nudgePanel}
            ondblclick={() => {
              panelWidth = PANEL_DEFAULT
              savePanel()
            }}
          ></div>
          <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-0">
            <div class="flex items-center gap-2 border-b px-3 py-2">
              <Tabs.List class="flex-1">
                <Tabs.Trigger value="details">Exhibit</Tabs.Trigger>
                <Tabs.Trigger value="ask">Ask</Tabs.Trigger>
              </Tabs.List>
              <Button variant="ghost" size="icon-sm" aria-label="Collapse the case file" onclick={togglePanel}>
                <PanelRightClose />
              </Button>
            </div>
            <Tabs.Content value="details" class="min-h-0 flex-1">
              <ScrollArea class="h-full">
                {#if selectedEntity}
                  <EntityPanel {graph} entity={selectedEntity} onselect={(id) => select(id, { focus: true })} />
                {:else if selected && !known.has(selected)}
                  <div class="flex flex-col gap-2 p-4">
                    <code class="bg-muted self-start rounded px-1.5 py-0.5 font-mono text-xs">{selected}</code>
                    <p class="text-muted-foreground text-sm">
                      An exhibit cites this, but no file in <code class="font-mono">.docket/</code> defines it yet.
                    </p>
                  </div>
                {:else}
                  <div class="text-muted-foreground flex flex-col gap-2 p-5 text-sm">
                    <p class="text-foreground font-serif text-lg">No exhibit selected</p>
                    <p>Pick an exhibit on the board, or find one with search, to read its evidence.</p>
                    <p class="text-xs">
                      Try <code class="font-mono">type:service</code>, <code class="font-mono">rel:depends_on</code> or
                      <code class="font-mono">tag:core</code> to narrow it down.
                    </p>
                  </div>
                {/if}
              </ScrollArea>
            </Tabs.Content>
            <Tabs.Content value="ask" class="min-h-0 flex-1">
              <ScrollArea class="h-full">
                <AskPanel {graph} {answer} {onanswer} onselect={(id) => select(id, { focus: true, tab: 'details' })} />
              </ScrollArea>
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      {/if}
    </div>
  {/if}
</div>
