<script lang="ts">
  import PanelLeft from '@lucide/svelte/icons/panel-left'
  import X from '@lucide/svelte/icons/x'
  import Filters from '$lib/components/filters.svelte'
  import GraphView, { type GraphLink, type GraphNode } from '$lib/components/graph-view.svelte'
  import HistoryView from '$lib/components/browse/history-view.svelte'
  import TableView from '$lib/components/browse/table-view.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import { getTypeStyle } from '$lib/type-style.js'
  import { edgeKey, neighbourhood } from '$lib/model.js'
  import type { UiEdge, UiGraph } from '$lib/types.js'
  import { getWorkspace, type BrowseView } from '$lib/workspace.svelte.js'

  const workspace = getWorkspace()
  const style = getTypeStyle()
  // The layout renders routes only once the graph has loaded.
  const graph = $derived(workspace.graph as UiGraph)
  const selected = $derived(workspace.selected)

  const views: { id: BrowseView; label: string }[] = [
    { id: 'graph', label: 'Graph' },
    { id: 'table', label: 'Table' },
    { id: 'history', label: 'History' }
  ]

  const scope = $derived(workspace.scoped ? workspace.scope : null)
  const scopeIds = $derived(new Set(scope?.ids ?? []))

  const typeOfSource = (edge: UiEdge): string => graph.entities.find((entity) => entity.id === edge.source)?.type ?? ''

  const nodes: GraphNode[] = $derived.by(() => {
    if (scope) {
      // Only what the scope holds, whatever the filters say: they are about browsing.
      const byId = new Map(graph.entities.map((entity) => [entity.id, entity]))
      return [...scopeIds].map((id) => {
        const entity = byId.get(id)
        return entity ? { id, title: entity.title, type: entity.type, ghost: false } : { id, title: id, type: '', ghost: true }
      })
    }
    const seen = new Set<string>()
    const visible: GraphNode[] = graph.entities
      .filter((entity) => !workspace.hiddenTypes.has(entity.type) && !seen.has(entity.id) && seen.add(entity.id))
      .map((entity) => ({ id: entity.id, title: entity.title, type: entity.type, ghost: false }))
    if (workspace.showUnresolved) {
      const ghosts = new Set(
        graph.edges
          .filter((edge) => edge.dangling && !workspace.hiddenRels.has(edge.rel) && !workspace.hiddenTypes.has(typeOfSource(edge)))
          .map((edge) => edge.target)
      )
      for (const id of [...ghosts].sort()) visible.push({ id, title: id, type: '', ghost: true })
    }
    return visible
  })

  const links: GraphLink[] = $derived.by(() => {
    const shown = new Set(nodes.map((node) => node.id))
    const seen = new Set<string>()
    // A scope draws only the relationships returned with it - never guessed ones between its exhibits.
    const candidates = scope ? scope.links : graph.edges.filter((edge) => !workspace.hiddenRels.has(edge.rel))
    return candidates
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => ({ key: edgeKey(edge), source: edge.source, target: edge.target, rel: edge.rel }))
      .filter((link) => !seen.has(link.key) && seen.add(link.key))
  })

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
</script>

<div class="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
  <div class="flex items-center gap-2 border-b px-3 py-1.5">
    {#if workspace.browseView === 'graph'}
      <Button
        variant="ghost"
        size="icon-sm"
        class="hidden lg:inline-flex"
        aria-label={workspace.showFilters ? 'Hide the index' : 'Show the index'}
        aria-pressed={workspace.showFilters}
        onclick={() => (workspace.showFilters = !workspace.showFilters)}
      >
        <PanelLeft />
      </Button>
    {/if}
    <div role="tablist" aria-label="Browse view" class="bg-muted inline-flex rounded-lg p-0.5">
      {#each views as view (view.id)}
        <button
          type="button"
          role="tab"
          aria-selected={workspace.browseView === view.id}
          class="rounded-md px-3 py-1 text-sm {workspace.browseView === view.id
            ? 'bg-background text-foreground font-medium shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (workspace.browseView = view.id)}
        >
          {view.label}
        </button>
      {/each}
    </div>
    <span class="text-muted-foreground ml-auto hidden text-xs md:inline">Read from the canonical files in <code class="font-mono">.docket/</code></span>
  </div>

  {#if workspace.browseView === 'graph'}
    <div class="relative grid min-h-0 grid-cols-1 lg:grid-cols-[auto_1fr]">
      {#if workspace.showFilters}
        <aside class="hidden min-h-0 w-64 border-r lg:block" aria-label="Index">
          <ScrollArea class="h-full">
            <Filters {graph} hiddenTypes={workspace.hiddenTypes} hiddenRels={workspace.hiddenRels} bind:showUnresolved={workspace.showUnresolved} />
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

      <main class="relative min-h-0 min-w-0 lg:col-start-2">
        <GraphView
          {nodes}
          {links}
          colourOf={style.colour}
          iconOf={style.icon}
          {selected}
          {emphasis}
          focus={workspace.focus}
          emptyHint={scope ? 'Nothing here to show.' : undefined}
          onselect={(id) => workspace.select(id)}
        />
        {#if scope}
          <div class="bg-popover absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">
            <span class="min-w-0 truncate">Showing {scopeSize === 1 ? 'the 1 exhibit' : `the ${scopeSize} exhibits`}: {workspace.scope?.label}</span>
            <Button variant="outline" size="xs" onclick={() => workspace.showEverything()}>Show all exhibits</Button>
          </div>
        {:else if workspace.pickedEdge}
          <div class="bg-popover absolute top-3 left-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">
            Relationship <code class="font-mono">{workspace.pickedEdge.rel}</code>
            <Button variant="ghost" size="icon-xs" aria-label="Clear" onclick={() => (workspace.pickedEdge = null)}><X /></Button>
          </div>
        {:else if workspace.scope}
          <div class="bg-popover absolute top-3 left-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">
            <Button variant="outline" size="xs" onclick={() => workspace.scope && workspace.showScope(workspace.scope)}>
              Show only {workspace.scope.label}
            </Button>
          </div>
        {/if}
      </main>
    </div>
  {:else if workspace.browseView === 'table'}
    <TableView {graph} onselect={(id) => workspace.select(id)} {selected} />
  {:else}
    <HistoryView {graph} onselect={(id) => workspace.select(id)} {selected} />
  {/if}
</div>
