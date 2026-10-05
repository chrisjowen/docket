<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { pushState } from '$app/navigation'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import Moon from '@lucide/svelte/icons/moon'
  import PanelLeft from '@lucide/svelte/icons/panel-left'
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
  import { edgeKey, neighbourhood, slotColour, typeSlots } from '$lib/model.js'
  import type { UiAnswer, UiEdge, UiGraph } from '$lib/types.js'

  let graph = $state.raw<UiGraph | null>(null)
  let loadError = $state<string | null>(null)
  let loading = $state(false)

  let selected = $state<string | null>(null)
  let tab = $state<'details' | 'ask'>('details')
  let answer = $state.raw<UiAnswer | null>(null)
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
    const hash = decodeURIComponent(location.hash.slice(1))
    return hash === '' ? null : hash
  }

  onMount(() => {
    dark = document.documentElement.classList.contains('dark')
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

  const known = $derived(new Set(graph?.entities.map((entity) => entity.id) ?? []))
  const selectedEntity = $derived(graph?.entities.find((entity) => entity.id === selected) ?? null)

  const nodes: GraphNode[] = $derived.by(() => {
    if (!graph) return []
    const visible: GraphNode[] = graph.entities
      .filter((entity) => !hiddenTypes.has(entity.type))
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
    return (graph?.edges ?? [])
      .filter((edge) => !hiddenRels.has(edge.rel) && shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => ({ key: edgeKey(edge), source: edge.source, target: edge.target, rel: edge.rel }))
  })

  /** What stays at full strength: an answer, a picked relationship, or the selection's neighbours. */
  const emphasis = $derived.by((): { nodes: Set<string>; links: Set<string> } | null => {
    if (!graph) return null
    if (tab === 'ask' && answer) {
      const ids = new Set(answer.documents.map((document) => document.id))
      const keys = new Set<string>()
      for (const path of answer.paths) {
        path.nodes.forEach((id) => ids.add(id))
        path.steps.forEach((step, index) => {
          const [a, b] = [path.nodes[index] ?? '', path.nodes[index + 1] ?? '']
          keys.add(edgeKey(step.forward ? { source: a, rel: step.rel, target: b } : { source: b, rel: step.rel, target: a }))
        })
      }
      return { nodes: ids, links: keys }
    }
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

  /** Make sure an entity is on the graph before pointing at it. */
  function reveal(id: string): void {
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
    select(edge.source, { tab: 'details' })
    pickedEdge = edge
    reveal(edge.target)
    hiddenRels.delete(edge.rel)
    request([edge.source, edge.target])
  }

  function onanswer(next: UiAnswer | null): void {
    answer = next
    if (!next) return
    const ids = [...new Set([...next.documents.map((d) => d.id), ...next.paths.flatMap((p) => p.nodes)])]
    ids.forEach(reveal)
    if (ids.length > 0) request(ids)
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
  <title>{graph ? `${graph.project.name} · docket` : 'docket'}</title>
</svelte:head>

<div class="grid h-dvh grid-rows-[auto_1fr]">
  <header class="flex items-center gap-3 border-b px-3 py-2">
    <Button
      variant="ghost"
      size="icon-sm"
      class="hidden lg:inline-flex"
      aria-label={showFilters ? 'Hide filters' : 'Show filters'}
      aria-pressed={showFilters}
      onclick={() => (showFilters = !showFilters)}
    >
      <PanelLeft />
    </Button>
    <div class="flex min-w-0 shrink-0 items-baseline gap-2">
      <span class="font-semibold tracking-tight">docket</span>
      {#if graph}
        <span class="text-muted-foreground hidden truncate text-sm sm:inline" title={graph.project.root}>{graph.project.name}</span>
      {/if}
    </div>
    <div class="flex min-w-0 flex-1 justify-center">
      {#if graph}
        <QuickSearch {graph} {colourOf} onentity={(id) => select(id, { focus: true, tab: 'details' })} onrelationship={pickEdge} />
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1">
      {#if graph}
        <span class="text-muted-foreground hidden text-xs tabular-nums md:inline">
          {graph.entities.length} entities · {graph.edges.length} relationships
        </span>
        {#if problems.length > 0}
          <Button variant="ghost" size="sm" onclick={() => (showProblems = !showProblems)} aria-expanded={showProblems}>
            <CircleAlert class={errors > 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'} />
            {problems.length}
          </Button>
        {/if}
      {/if}
      <Button variant="ghost" size="icon-sm" aria-label="Reload from the files" onclick={() => load()} disabled={loading}>
        <RefreshCw class={loading ? 'animate-spin' : ''} />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={dark ? 'Use the light theme' : 'Use the dark theme'} onclick={toggleTheme}>
        {#if dark}<Sun />{:else}<Moon />{/if}
      </Button>
    </div>
  </header>

  {#if loadError && !graph}
    <div class="grid place-items-center p-6">
      <div class="flex max-w-lg flex-col gap-3 rounded-lg border p-5">
        <div class="flex items-center gap-2 font-medium"><CircleAlert class="text-destructive size-4" /> Could not read the repository</div>
        <p class="text-muted-foreground text-sm break-words">{loadError}</p>
        <Button variant="outline" onclick={() => load()}>Try again</Button>
      </div>
    </div>
  {:else if !graph}
    <div class="text-muted-foreground grid place-items-center text-sm">Reading .docket/…</div>
  {:else}
    <div class="relative grid min-h-0 grid-cols-1 lg:grid-cols-[auto_1fr_auto]">
      {#if showFilters}
        <aside class="hidden min-h-0 w-60 border-r lg:block">
          <ScrollArea class="h-full">
            <Filters {graph} {colourOf} {hiddenTypes} {hiddenRels} bind:showUnresolved />
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
        <GraphView {nodes} {links} {colourOf} {selected} {emphasis} {focus} onselect={(id) => select(id, id ? { tab: 'details' } : {})} />
        {#if pickedEdge}
          <div class="bg-popover absolute top-3 left-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">
            Relationship <code class="font-mono">{pickedEdge.rel}</code>
            <Button variant="ghost" size="icon-xs" aria-label="Clear" onclick={() => (pickedEdge = null)}><X /></Button>
          </div>
        {/if}
        {#if showProblems && problems.length > 0}
          <div class="bg-popover absolute top-3 right-3 z-20 flex max-h-[60%] w-96 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border shadow-lg">
            <div class="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
              Validation ({problems.length})
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

      <aside
        class="bg-background absolute inset-x-0 bottom-0 flex max-h-[55%] min-h-0 flex-col border-t lg:static lg:max-h-none lg:w-[400px] lg:border-t-0 lg:border-l"
      >
        <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-0">
          <div class="border-b px-3 py-2">
            <Tabs.List class="w-full">
              <Tabs.Trigger value="details">Details</Tabs.Trigger>
              <Tabs.Trigger value="ask">Ask</Tabs.Trigger>
            </Tabs.List>
          </div>
          <Tabs.Content value="details" class="min-h-0 flex-1">
            <ScrollArea class="h-full">
              {#if selectedEntity}
                <EntityPanel {graph} entity={selectedEntity} {colourOf} onselect={(id) => select(id, { focus: true })} />
              {:else if selected && !known.has(selected)}
                <div class="flex flex-col gap-2 p-4">
                  <code class="bg-muted self-start rounded px-1.5 py-0.5 font-mono text-xs">{selected}</code>
                  <p class="text-muted-foreground text-sm">
                    Something links here, but no file in <code class="font-mono">.docket/</code> defines it yet.
                  </p>
                </div>
              {:else}
                <div class="text-muted-foreground flex flex-col gap-2 p-4 text-sm">
                  <p>Select an entity on the graph, or find one with quick search.</p>
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
              <AskPanel {graph} {colourOf} {answer} {onanswer} onselect={(id) => select(id, { focus: true, tab: 'details' })} />
            </ScrollArea>
          </Tabs.Content>
        </Tabs.Root>
      </aside>
    </div>
  {/if}
</div>
