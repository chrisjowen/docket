<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import FolderSync from '@lucide/svelte/icons/folder-sync'
  import Moon from '@lucide/svelte/icons/moon'
  import PanelRight from '@lucide/svelte/icons/panel-right'
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Sun from '@lucide/svelte/icons/sun'
  import X from '@lucide/svelte/icons/x'
  import ChatPanel from '$lib/components/chat-panel.svelte'
  import Inspector from '$lib/components/inspector.svelte'
  import QuickSearch from '$lib/components/quick-search.svelte'
  import SyncPanel from '$lib/components/sync-panel.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import { iconOf } from '$lib/icons.js'
  import { slotColour, typeSlots } from '$lib/model.js'
  import { ROUTES, type Navigator } from '$lib/nav.svelte.js'
  import { setTypeStyle } from '$lib/type-style.js'
  import { scopeOfAnswer, type Workspace } from '$lib/workspace.svelte.js'

  /**
   * The casebook: its header, the view showing and the inspector beside it.
   * docket open's page draws it with routes for views and the URL hash for the
   * selection; Wheelhouse's draws it inside its own page, with views kept in
   * memory and Wheelhouse's theme. Whoever draws it sets the workspace and
   * navigator contexts and passes the same ones here.
   */
  interface Props {
    workspace: Workspace
    nav: Navigator
    /** The view showing. */
    children: Snippet
    /** Select this exhibit once the casebook has loaded. */
    initial?: string | null
    /** The light and dark switch; null leaves the theme to the page around it. */
    theme?: { dark: boolean; toggle: () => void } | null
    /** Its height: the window's, or the box it is drawn in. */
    class?: string
  }

  let { workspace, nav, children, initial = null, theme = null, class: className = 'h-dvh' }: Props = $props()

  let showProblems = $state(false)

  const graph = $derived(workspace.graph)

  onMount(() => {
    void workspace.load().then(() => {
      if (initial) workspace.select(initial, { focus: true })
    })
    void workspace.sync.refresh()

    // Coming back to the tab re-reads the files: they may have been edited meanwhile.
    let lastFocus = Date.now()
    const onfocus = () => {
      if (Date.now() - lastFocus > 2000) {
        void workspace.load()
        if (!workspace.sync.running) void workspace.sync.refresh()
      }
      lastFocus = Date.now()
    }
    window.addEventListener('focus', onfocus)
    return () => {
      window.removeEventListener('focus', onfocus)
      workspace.sync.stop()
    }
  })

  const slots = $derived(typeSlots(graph?.entities ?? []))
  const colourOf = (type: string): string => slotColour(slots.get(type))
  const typeIcons = $derived(new Map(graph?.types.map((type) => [type.name, type.icon]) ?? []))
  const typeIcon = (type: string) => iconOf(type, typeIcons.get(type))
  setTypeStyle({ colour: colourOf, icon: typeIcon })

  /** Quick search finds exhibits on the board: go there to show them. */
  async function toBoard(): Promise<void> {
    if (nav.route !== 'browse') await nav.go('browse')
    workspace.browseView = 'graph'
  }

  const syncing = $derived(workspace.sync.running)
  const outOfDate = $derived(workspace.sync.status?.outOfDate ?? false)

  const problems = $derived(graph?.diagnostics ?? [])
  const errors = $derived(problems.filter((problem) => problem.severity === 'error').length)
</script>

<div class="grid {className} grid-rows-[auto_1fr]">
  <header class="bg-spine text-spine-foreground flex items-center gap-3 border-b border-black/20 px-3 py-2">
    <div class="flex min-w-0 shrink-0 items-baseline gap-2.5">
      <span class="text-gilt font-serif text-xl leading-none font-semibold tracking-wide">docket</span>
      <span class="text-spine-muted hidden font-serif text-sm italic xl:inline">casebook of evidence</span>
      {#if graph}
        <span class="text-spine-foreground hidden max-w-40 truncate text-sm 2xl:inline" title={graph.project.root}>{graph.project.name}</span>
      {/if}
    </div>
    <nav aria-label="Workspace" class="flex shrink-0 items-center gap-0.5">
      {#each ROUTES as route (route.id)}
        {@const href = nav.href(route.id)}
        {@const look = `rounded-md px-2.5 py-1 text-sm transition-colors ${
          nav.route === route.id ? 'bg-white/15 text-spine-foreground font-medium' : 'text-spine-muted hover:text-spine-foreground hover:bg-white/10'
        }`}
        {#if href !== null}
          <a {href} class={look} aria-current={nav.route === route.id ? 'page' : undefined}>{route.label}</a>
        {:else}
          <button type="button" class={look} aria-current={nav.route === route.id ? 'page' : undefined} onclick={() => nav.go(route.id)}>
            {route.label}
          </button>
        {/if}
      {/each}
    </nav>
    <div class="flex min-w-0 flex-1 justify-center text-foreground">
      {#if graph}
        <QuickSearch
          {graph}
          onentity={(id) => {
            void toBoard().then(() => workspace.select(id, { focus: true }))
          }}
          onrelationship={(edge) => {
            void toBoard().then(() => workspace.pickEdge(edge))
          }}
        />
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1">
      {#if graph}
        <span class="text-spine-muted hidden text-xs tabular-nums 2xl:inline">
          {graph.entities.length} {graph.entities.length === 1 ? 'exhibit' : 'exhibits'}, {graph.edges.length}
          {graph.edges.length === 1 ? 'relationship' : 'relationships'}
        </span>
        {#if problems.length > 0}
          <Button
            variant="ghost"
            size="sm"
            class="hover:text-spine-foreground hover:bg-white/10"
            onclick={() => {
              showProblems = !showProblems
              if (showProblems) workspace.syncOpen = false
            }}
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
        size="sm"
        class="hover:text-spine-foreground relative hover:bg-white/10"
        aria-label={syncing ? 'Syncing the projections' : outOfDate ? 'Sync the projections - out of date' : 'Sync the projections'}
        aria-expanded={workspace.syncOpen}
        title={outOfDate ? 'Projections out of date with the files' : 'Run docket sync'}
        onclick={() => {
          workspace.syncOpen = !workspace.syncOpen
          if (workspace.syncOpen) showProblems = false
        }}
      >
        <FolderSync class={syncing ? 'animate-pulse' : ''} />
        <span class="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync'}</span>
        {#if outOfDate && !syncing}
          <span class="absolute top-1 right-1 size-1.5 rounded-full bg-amber-300" aria-hidden="true"></span>
        {/if}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="hover:text-spine-foreground hover:bg-white/10"
        aria-label="Reload from the files"
        onclick={() => workspace.load()}
        disabled={workspace.loading}
      >
        <RefreshCw class={workspace.loading ? 'animate-spin' : ''} />
      </Button>
      {#if theme}
        <Button
          variant="ghost"
          size="icon-sm"
          class="hover:text-spine-foreground hover:bg-white/10"
          aria-label={theme.dark ? 'Use the light theme' : 'Use the dark theme'}
          onclick={theme.toggle}
        >
          {#if theme.dark}<Sun />{:else}<Moon />{/if}
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        class="hover:text-spine-foreground hover:bg-white/10"
        aria-label={workspace.panelOpen ? 'Collapse the inspector' : 'Open the inspector'}
        aria-pressed={workspace.panelOpen}
        aria-controls="case-file"
        onclick={() => (workspace.panelOpen = !workspace.panelOpen)}
      >
        {#if workspace.panelOpen}<PanelRightClose />{:else}<PanelRight />{/if}
      </Button>
    </div>
  </header>

  {#if workspace.loadError && !graph}
    <div class="grid place-items-center p-6">
      <div class="flex max-w-lg flex-col gap-3 rounded-lg border p-5">
        <div class="flex items-center gap-2 font-serif text-lg"><CircleAlert class="text-destructive size-4" /> Could not open the casebook</div>
        <p class="text-muted-foreground text-sm break-words">{workspace.loadError}</p>
        <Button variant="outline" onclick={() => workspace.load()}>Try again</Button>
      </div>
    </div>
  {:else if !graph}
    <div class="text-muted-foreground grid place-items-center font-serif italic">Opening the casebook…</div>
  {:else}
    <div class="relative grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div class="relative min-h-0 min-w-0 overflow-hidden">
        {@render children()}
        {#if workspace.syncOpen}
          <SyncPanel sync={workspace.sync} onclose={() => (workspace.syncOpen = false)} />
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
      </div>

      {#if workspace.panelOpen}
        <aside
          id="case-file"
          aria-label="Inspector"
          class="bg-background absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] min-h-0 flex-col border-t shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] lg:relative lg:z-auto lg:max-h-none lg:w-[480px] lg:max-w-[45vw] lg:border-t-0 lg:border-l lg:shadow-none"
        >
          <Tabs.Root bind:value={workspace.sideTab} class="flex min-h-0 flex-1 flex-col gap-0">
            <div class="flex items-center gap-2 border-b px-3 py-2">
              <Tabs.List class="flex-1">
                <Tabs.Trigger value="inspector">Inspector</Tabs.Trigger>
                <Tabs.Trigger value="chat">Chat</Tabs.Trigger>
              </Tabs.List>
              <Button variant="ghost" size="icon-sm" aria-label="Collapse the inspector" onclick={() => (workspace.panelOpen = false)}>
                <PanelRightClose />
              </Button>
            </div>
            <Tabs.Content value="inspector" class="min-h-0 flex-1">
              <Inspector {graph} />
            </Tabs.Content>
            <Tabs.Content value="chat" class="min-h-0 flex-1">
              <ChatPanel
                {graph}
                bind:turns={workspace.turns}
                onshow={(answer, options) => {
                  // A reply scopes the board; only asking to see it leaves the current route.
                  if (options?.reveal) void toBoard().then(() => workspace.showScope(scopeOfAnswer(answer)))
                  else workspace.showScope(scopeOfAnswer(answer))
                }}
                onselect={(id) => workspace.select(id, { focus: true })}
              />
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      {/if}
    </div>
  {/if}
</div>
