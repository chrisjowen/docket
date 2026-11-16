<script lang="ts">
  import Hourglass from '@lucide/svelte/icons/hourglass'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import X from '@lucide/svelte/icons/x'
  import CardGraph, { type CardLink, type CardNode } from '$lib/components/card-graph.svelte'
  import Filters from '$lib/components/filters.svelte'
  import HistoryView from '$lib/components/browse/history-view.svelte'
  import TableView from '$lib/components/browse/table-view.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { layoutCards } from '$lib/cards.js'
  import { getTypeStyle } from '$lib/type-style.js'
  import { countBy, edgeKey, neighbourhood, typeCode } from '$lib/model.js'
  import type { UiAssessment, UiEdge, UiEntity, UiGraph } from '$lib/types.js'
  import { getWorkspace, type BrowseView } from '$lib/workspace.svelte.js'

  const workspace = getWorkspace()
  const style = getTypeStyle()
  // The layout renders routes only once the graph has loaded.
  const graph = $derived(workspace.graph as UiGraph)
  const selected = $derived(workspace.selected)

  type View = { id: BrowseView; label: string; title: [string, string] }
  const NETWORK: View = { id: 'graph', label: 'Network', title: ['Evidence', 'network'] }
  const VIEWS: View[] = [NETWORK, { id: 'table', label: 'Exhibits', title: ['Exhibits', ''] }, { id: 'history', label: 'History', title: ['Docket', 'history'] }]
  const view = $derived(VIEWS.find((each) => each.id === workspace.browseView) ?? NETWORK)

  const scope = $derived(workspace.scoped ? workspace.scope : null)
  const scopeIds = $derived(new Set(scope?.ids ?? []))
  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))

  const typeOfSource = (edge: UiEdge): string => byId.get(edge.source)?.type ?? ''

  /** Weakly supported: evidence was weighed, and it came to under a half. */
  const weak = (assessment: UiAssessment | undefined): boolean => assessment?.basis === 'evidence' && assessment.confidence < 0.5

  const card = (entity: UiEntity): CardNode => {
    const observations = entity.assessment?.evidenceCount ?? entity.evidence.length
    return {
      id: entity.id,
      title: entity.title,
      type: entity.type,
      ghost: false,
      code: typeCode(entity.type),
      colour: style.colour(entity.type),
      weight: entity.assessment?.confidence ?? null,
      note: `${observations} obs.`,
      weak: weak(entity.assessment)
    }
  }
  const ghost = (id: string): CardNode => ({ id, title: id, type: '', ghost: true, code: '', colour: 'var(--graph-other)', weight: null, note: null, weak: false })

  const nodes: CardNode[] = $derived.by(() => {
    if (scope) {
      // Only what the scope holds, whatever the filters say: they are about browsing.
      return [...scopeIds].map((id) => {
        const entity = byId.get(id)
        return entity ? card(entity) : ghost(id)
      })
    }
    const seen = new Set<string>()
    const visible: CardNode[] = graph.entities
      .filter((entity) => !workspace.hiddenTypes.has(entity.type) && !seen.has(entity.id) && seen.add(entity.id))
      .map(card)
    if (workspace.showUnresolved) {
      const ghosts = new Set(
        graph.edges
          .filter((edge) => edge.dangling && !workspace.hiddenRels.has(edge.rel) && !workspace.hiddenTypes.has(typeOfSource(edge)))
          .map((edge) => edge.target)
      )
      for (const id of [...ghosts].sort()) visible.push(ghost(id))
    }
    return visible
  })

  const links: CardLink[] = $derived.by(() => {
    const shown = new Set(nodes.map((node) => node.id))
    const seen = new Set<string>()
    // A scope draws only the relationships returned with it - never guessed ones between its exhibits.
    const candidates: Pick<UiEdge, 'source' | 'rel' | 'target' | 'assessment'>[] = scope
      ? scope.links
      : graph.edges.filter((edge) => !workspace.hiddenRels.has(edge.rel))
    return candidates
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => ({ key: edgeKey(edge), source: edge.source, target: edge.target, rel: edge.rel, weak: weak(edge.assessment) }))
      .filter((link) => !seen.has(link.key) && seen.add(link.key))
  })

  /**
   * Every card laid out once for the whole casebook, so a filter never moves
   * one; a scope is laid out on its own, close together.
   */
  const everywhere = $derived.by(() => {
    const ghosts = [...new Set(graph.edges.filter((edge) => edge.dangling).map((edge) => edge.target))]
    return layoutCards(
      [...graph.entities.map(({ id, type }) => ({ id, type })), ...ghosts.map((id) => ({ id, type: '' }))],
      graph.edges.map(({ source, target }) => ({ source, target }))
    )
  })
  const placed = $derived(scope ? layoutCards(nodes, links) : everywhere)

  /**
   * What stays at full strength: a picked relationship, or the selection's
   * neighbours. A scope needs none - the board already shows only it.
   */
  const emphasis = $derived.by((): { nodes: Set<string>; links: Set<string> } | null => {
    const picked = workspace.pickedEdge
    if (picked) return { nodes: new Set([picked.source, picked.target]), links: new Set([edgeKey(picked)]) }
    if (selected) {
      const edges = scope ? links : graph.edges
      const keys = new Set(edges.filter((edge) => edge.source === selected || edge.target === selected).map((edge) => edgeKey(edge)))
      return { nodes: neighbourhood(edges, selected), links: keys }
    }
    return null
  })

  const scopeSize = $derived(scopeIds.size)
  const types = $derived([...countBy(graph.entities, (entity) => entity.type)].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)))
  const counts: Record<BrowseView, number | null> = $derived({ graph: graph.entities.length, table: graph.entities.length, history: null })

  // The view's tab underline slides between tabs.
  let tabs = $state<HTMLElement>()
  let ink = $state<{ left: number; width: number } | null>(null)
  $effect(() => {
    void workspace.browseView
    const place = () => {
      const tab = tabs?.querySelector<HTMLElement>('[aria-selected="true"]')
      ink = tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null
    }
    place()
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => window.removeEventListener('resize', place)
  })
</script>

{#snippet toolbar()}
  {#if scope}
    <span class="tool scope">
      <span class="min-w-0 truncate">Showing {scopeSize === 1 ? 'the 1 exhibit' : `the ${scopeSize} exhibits`}: {workspace.scope?.label}</span>
      <button type="button" class="link" onclick={() => workspace.showEverything()}>Show all</button>
    </span>
  {:else}
    <span class="type-chips" role="group" aria-label="Exhibit types">
      {#each types as [type, count] (type)}
        <button
          type="button"
          class="tool type"
          aria-pressed={!workspace.hiddenTypes.has(type)}
          aria-label={type}
          title="{type} · {count}"
          onclick={() => (workspace.hiddenTypes.has(type) ? workspace.hiddenTypes.delete(type) : workspace.hiddenTypes.add(type))}
        >
          <i style="background: {style.colour(type)}" aria-hidden="true"></i>{typeCode(type)}
        </button>
      {/each}
    </span>
    <span class="relative">
      <button
        type="button"
        class="tool"
        aria-expanded={workspace.showFilters}
        aria-controls="board-filters"
        onclick={() => (workspace.showFilters = !workspace.showFilters)}
      >
        <SlidersHorizontal size={14} aria-hidden="true" /> Filters
      </button>
      {#if workspace.showFilters}
        <div class="filter-panel" id="board-filters">
          <Filters {graph} hiddenTypes={workspace.hiddenTypes} hiddenRels={workspace.hiddenRels} bind:showUnresolved={workspace.showUnresolved} />
        </div>
      {/if}
    </span>
    {#if workspace.pickedEdge}
      <span class="tool">
        Relationship <code class="font-mono">{workspace.pickedEdge.rel}</code>
        <button type="button" class="link" aria-label="Clear" onclick={() => (workspace.pickedEdge = null)}><X size={13} /></button>
      </span>
    {:else if workspace.scope}
      <button type="button" class="tool" onclick={() => workspace.scope && workspace.showScope(workspace.scope)}>Show only {workspace.scope.label}</button>
    {/if}
  {/if}
{/snippet}

<div class="browse flex h-full min-h-0 min-w-0 flex-col px-4 pt-5 pb-4 sm:px-7">
  <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
    <div class="min-w-0">
      <h1 class="serif-title text-4xl sm:text-[2.6rem]">
        {view.title[0]}{#if view.title[1]}&nbsp;<em>{view.title[1]}</em>{/if}
      </h1>
      <p class="text-mute mt-1.5 text-sm">
        {graph.entities.length}
        {graph.entities.length === 1 ? 'exhibit' : 'exhibits'} and {graph.edges.length}
        {graph.edges.length === 1 ? 'relationship' : 'relationships'}, read from {graph.project.name}'s canonical files in
        <code class="font-mono text-[0.92em]">.docket/</code>
      </p>
    </div>
    <p class="index m-0 inline-flex items-center gap-2 text-sm font-medium" role="status">
      {#if !graph.index.synced}
        <Hourglass size={15} aria-hidden="true" class="text-warn" />
        <span class="text-warn">Search index not synced</span>
        <Button variant="outline" size="xs" onclick={() => (workspace.syncOpen = true)}>Sync now</Button>
      {:else if graph.index.behind > 0}
        <span class="live-dot behind" aria-hidden="true"></span>
        <span class="text-warn">Index behind {graph.index.behind}</span>
        <Button variant="outline" size="xs" onclick={() => (workspace.syncOpen = true)}>Sync now</Button>
      {:else}
        <span class="live-dot" aria-hidden="true"></span>
        <span class="text-ok">Index up to date</span>
      {/if}
    </p>
  </div>

  <div class="views" role="tablist" aria-label="Browse view" bind:this={tabs}>
    {#each VIEWS as each (each.id)}
      <button type="button" role="tab" aria-selected={workspace.browseView === each.id} onclick={() => (workspace.browseView = each.id)}>
        {each.label}
        {#if counts[each.id] !== null}<span class="count">{counts[each.id]}</span>{/if}
      </button>
    {/each}
    {#if ink}<span class="ink" aria-hidden="true" style="left: {ink.left}px; width: {ink.width}px"></span>{/if}
  </div>

  <div class="relative min-h-0 flex-1" role="tabpanel" aria-label={view.label}>
    {#if workspace.browseView === 'graph'}
      <CardGraph
        {nodes}
        {links}
        {placed}
        {selected}
        {emphasis}
        focus={workspace.focus}
        {toolbar}
        emptyHint={scope ? 'Nothing here to show.' : undefined}
        onselect={(id) => workspace.select(id)}
      />
    {:else}
      <div class="sheet h-full overflow-hidden">
        {#if workspace.browseView === 'table'}
          <TableView {graph} onselect={(id) => workspace.select(id)} {selected} />
        {:else}
          <HistoryView {graph} onselect={(id) => workspace.select(id)} {selected} />
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .live-dot.behind {
    background: var(--warn);
  }
  .live-dot.behind::after {
    border-color: var(--warn);
    animation-duration: 1.4s;
  }

  /* The views: tabs with counts, and an underline that slides between them. */
  .views {
    position: relative;
    display: flex;
    flex: none;
    gap: 2px;
    margin: 1rem 0 14px;
    overflow-x: auto;
    border-bottom: 1px solid var(--rule);
    scrollbar-width: none;
  }
  .views::-webkit-scrollbar {
    display: none;
  }
  .views button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 7px;
    height: 40px;
    padding: 0 12px;
    border: 0;
    background: none;
    color: var(--mute);
    font: inherit;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }
  .views button:hover,
  .views button[aria-selected='true'] {
    color: var(--ink);
  }
  .views .count {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--sunk);
    color: var(--mute);
    font: 500 10.5px var(--mono);
  }
  .views .ink {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: var(--ink);
    transition:
      left 0.3s var(--ease-io),
      width 0.3s var(--ease-io);
  }

  /* The table and the history: a sheet of paper. */
  .sheet {
    border-radius: 14px;
    background: var(--paper);
    box-shadow: var(--shadow-1);
  }

  /* The board's own controls, in the canvas's top row. */
  .type-chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .type-chips :global(.tool.type) {
    padding: 0 8px;
    font: 600 11px var(--mono);
    letter-spacing: 0.04em;
  }
  .type-chips i {
    width: 7px;
    height: 7px;
    border-radius: 2px;
  }
  .type-chips [aria-pressed='false'] i {
    opacity: 0.35;
  }
  .filter-panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 5;
    width: 18rem;
    max-height: 26rem;
    overflow-y: auto;
    border-radius: var(--r-card);
    background: var(--paper);
    box-shadow: var(--shadow-2);
  }
  .scope {
    max-width: 100%;
    cursor: default;
  }
  .link {
    display: inline-flex;
    align-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  @media (max-width: 900px) {
    .type-chips {
      display: none;
    }
  }
</style>
