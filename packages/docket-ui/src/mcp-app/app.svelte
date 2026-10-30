<script lang="ts">
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Maximize2 from '@lucide/svelte/icons/maximize-2'
  import Minimize2 from '@lucide/svelte/icons/minimize-2'
  import Search from '@lucide/svelte/icons/search'
  import GraphView, { type FocusRequest } from '$lib/components/graph-view.svelte'
  import TypeMark from '$lib/components/type-mark.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { iconOf } from '$lib/icons.js'
  import { setTypeStyle } from '$lib/type-style.js'
  import type { AppBridge, ToolResult } from './bridge.js'
  import { boardOf, searchOf, typeColours, type SearchGraph } from './board.js'

  /**
   * docket_search's app: the resources the search found and the ones a link
   * away, on the casebook's evidence board, with the matches listed beside it.
   * It searches again through the same tool, and opens a resource in docket
   * open's casebook when the host lets it open links.
   */
  interface Props {
    bridge: AppBridge
    /** The display modes the host offers; fullscreen shows its button. */
    displayModes: () => string[]
    displayMode: () => string
    /** The tool's latest result, as the host handed it. */
    result: () => ToolResult | null
    /** The arguments the host called the tool with. */
    input: () => Record<string, unknown> | null
    onresult: (result: ToolResult) => void
    ondisplaymode: (mode: string) => void
  }

  let { bridge, displayModes, displayMode, result, input, onresult, ondisplaymode }: Props = $props()

  const graph: SearchGraph | null = $derived(searchOf(result()?.structuredContent))
  const problem = $derived.by(() => {
    const current = result()
    if (!current || graph) return null
    return current.content?.find((item) => item.type === 'text')?.text ?? 'The search did not return a docket graph.'
  })

  let selected = $state<string | null>(null)
  let focus = $state<FocusRequest | null>(null)
  let query = $state('')
  let searching = $state(false)
  let error = $state<string | null>(null)

  // A new result starts unpicked, with its query in the box.
  $effect(() => {
    const asked = input()?.query
    selected = null
    error = null
    query = graph?.query ?? (typeof asked === 'string' ? asked : '')
  })

  const colours = $derived(graph ? typeColours(graph) : () => 'var(--graph-other)')
  const icons = $derived(new Map(graph?.types.map((type) => [type.name, type.icon]) ?? []))
  setTypeStyle({ colour: (type) => colours(type), icon: (type) => iconOf(type, icons.get(type)) })

  const board = $derived(graph ? boardOf(graph, selected) : null)
  const picked = $derived(graph?.nodes.find((node) => node.id === selected) ?? null)
  const pickedLinks = $derived(
    graph && picked
      ? {
          outgoing: graph.links.filter((link) => link.source === picked.id),
          incoming: graph.links.filter((link) => link.target === picked.id)
        }
      : null
  )
  const titleOf = (id: string): string => graph?.nodes.find((node) => node.id === id)?.title ?? id

  let nonce = 0
  function pick(id: string | null): void {
    selected = id
    if (id !== null) focus = { ids: [id], nonce: ++nonce }
  }

  // Enter in the box, not a form: a host's sandbox and CSP refuse form submission.
  async function search(event: KeyboardEvent): Promise<void> {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    const asked = query.trim()
    if (asked === '' || searching) return
    searching = true
    error = null
    try {
      onresult((await bridge.request('tools/call', { name: 'docket_search', arguments: { query: asked } })) as ToolResult)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      searching = false
    }
  }

  async function open(id: string): Promise<void> {
    if (!graph?.viewer) return
    try {
      await bridge.request('ui/open-link', { url: `${graph.viewer}#${encodeURIComponent(id)}` })
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      const granted = (await bridge.request('ui/request-display-mode', { mode: displayMode() === 'fullscreen' ? 'inline' : 'fullscreen' })) as {
        mode?: string
      } | null
      if (granted?.mode) ondisplaymode(granted.mode)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const fullscreen = $derived(displayMode() === 'fullscreen')
</script>

<div class="bg-background text-foreground flex flex-col {fullscreen ? 'h-screen' : 'h-[30rem]'}">
  <header class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <Search class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <input
        class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        placeholder="Search the docket"
        aria-label="Search the docket"
        enterkeyhint="search"
        bind:value={query}
        onkeydown={search}
        disabled={searching}
      />
    </div>
    {#if graph}
      <span class="text-muted-foreground shrink-0 text-xs">
        {graph.matches.length}
        {graph.matches.length === 1 ? 'match' : 'matches'} in {graph.project.name}
      </span>
    {/if}
    {#if displayModes().includes('fullscreen')}
      <Button variant="ghost" size="icon-sm" aria-label={fullscreen ? 'Show inline' : 'Show full screen'} onclick={toggleFullscreen}>
        {#if fullscreen}<Minimize2 />{:else}<Maximize2 />{/if}
      </Button>
    {/if}
  </header>

  {#if error}
    <p class="text-destructive border-b px-3 py-1.5 text-xs">{error}</p>
  {/if}

  {#if !result()}
    <div class="text-muted-foreground grid flex-1 place-items-center text-sm">Searching the docket…</div>
  {:else if problem !== null}
    <div class="grid flex-1 place-items-center p-6">
      <p class="text-muted-foreground max-w-md text-sm whitespace-pre-line">{problem}</p>
    </div>
  {:else if graph && board}
    <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_15rem] sm:grid-rows-1">
      <div class="min-h-0 min-w-0">
        <!-- Each result is a board of its own, laid out and framed afresh. -->
        {#key graph}
        <GraphView
          nodes={board.nodes}
          links={board.links}
          colourOf={colours}
          iconOf={(type) => iconOf(type, icons.get(type))}
          {selected}
          emphasis={board.emphasis}
          {focus}
          onselect={pick}
          emptyHint={graph.index.synced && graph.index.behind === 0
            ? 'Nothing in the docket matches. Try other words.'
            : 'Nothing matches, and the search index is behind the files: run docket sync.'}
        />
        {/key}
      </div>
      <aside class="bg-card flex max-h-48 min-h-0 flex-col overflow-y-auto border-t text-sm sm:max-h-none sm:border-t-0 sm:border-l">
        {#if picked}
          <div class="flex flex-col gap-1.5 p-3">
            <div class="flex items-start gap-2">
              <TypeMark type={picked.ghost ? null : picked.type} size="sm" class="mt-0.5" />
              <div class="min-w-0">
                <p class="font-medium break-words">{picked.ghost ? picked.id : picked.title}</p>
                <p class="text-muted-foreground font-mono text-[11px] break-all">{picked.id}</p>
              </div>
            </div>
            {#if picked.ghost}
              <p class="text-muted-foreground text-xs">No file in the docket defines it yet.</p>
            {:else}
              <p class="text-muted-foreground text-xs">{picked.type}{picked.match ? ' · a match' : ' · one link away'}</p>
              {#if picked.path}<p class="text-muted-foreground font-mono text-[11px] break-all">{picked.path}</p>{/if}
            {/if}
            {#if pickedLinks}
              <ul class="mt-1 flex flex-col gap-0.5 text-xs">
                {#each pickedLinks.outgoing as link (`${link.rel}\u0000${link.target}`)}
                  <li><span class="text-muted-foreground">{link.rel} →</span> <button class="text-left hover:underline" onclick={() => pick(link.target)}>{titleOf(link.target)}</button></li>
                {/each}
                {#each pickedLinks.incoming as link (`${link.source}\u0000${link.rel}`)}
                  <li><button class="text-left hover:underline" onclick={() => pick(link.source)}>{titleOf(link.source)}</button> <span class="text-muted-foreground">{link.rel} →</span></li>
                {/each}
              </ul>
            {/if}
            <div class="mt-1 flex gap-1">
              {#if graph.viewer && !picked.ghost}
                <Button variant="outline" size="xs" onclick={() => open(picked.id)}><ExternalLink />Open in docket</Button>
              {/if}
              <Button variant="ghost" size="xs" onclick={() => pick(null)}>All matches</Button>
            </div>
          </div>
        {:else}
          <ul class="flex flex-col py-1">
            {#each graph.matches as match (match.id)}
              <li>
                <button class="hover:bg-accent flex w-full items-start gap-2 px-3 py-1.5 text-left" onclick={() => pick(match.id)}>
                  <TypeMark type={match.type} size="sm" class="mt-0.5" />
                  <span class="min-w-0">
                    <span class="block truncate">{match.title}</span>
                    <span class="text-muted-foreground block truncate font-mono text-[11px]">{match.id}</span>
                  </span>
                </button>
              </li>
            {:else}
              <li class="text-muted-foreground px-3 py-2 text-xs">No matches.</li>
            {/each}
          </ul>
          {#if graph.omitted > 0}
            <p class="text-muted-foreground px-3 pb-2 text-xs">{graph.omitted} more linked resources are left off the board.</p>
          {/if}
          {#each graph.sources.filter((source) => source.error) as source (source.name)}
            <p class="text-muted-foreground px-3 pb-2 text-xs">{source.name} could not search: {source.error}</p>
          {/each}
        {/if}
      </aside>
    </div>
  {/if}
</div>
