<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import FolderSync from '@lucide/svelte/icons/folder-sync'
  import MessageSquareText from '@lucide/svelte/icons/message-square-text'
  import Moon from '@lucide/svelte/icons/moon'
  import Network from '@lucide/svelte/icons/network'
  import PanelRight from '@lucide/svelte/icons/panel-right'
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close'
  import Plug from '@lucide/svelte/icons/plug'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Sun from '@lucide/svelte/icons/sun'
  import X from '@lucide/svelte/icons/x'
  import ChatPanel from '$lib/components/chat-panel.svelte'
  import DocketMark from '$lib/components/docket-mark.svelte'
  import Inspector from '$lib/components/inspector.svelte'
  import QuickSearch from '$lib/components/quick-search.svelte'
  import SyncPanel from '$lib/components/sync-panel.svelte'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import { iconOf } from '$lib/icons.js'
  import { slotColour, typeSlots } from '$lib/model.js'
  import { ROUTES, type Navigator, type Route } from '$lib/nav.svelte.js'
  import { setTypeStyle } from '$lib/type-style.js'
  import { scopeOfAnswer, type Workspace } from '$lib/workspace.svelte.js'

  /**
   * The casebook, laid out as Docket Cloud lays out a docket: a sidebar with
   * the views, a breadcrumb bar, the view showing and the inspector beside it.
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

  const ROUTE_ICONS: Record<Route, typeof Network> = { browse: Network, ask: MessageSquareText, adapters: Plug }

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

{#snippet routeLinks(compact: boolean)}
  {#each ROUTES as route (route.id)}
    {@const href = nav.href(route.id)}
    {@const Icon = ROUTE_ICONS[route.id]}
    {@const current = nav.route === route.id}
    {#if href !== null}
      <a {href} class={compact ? 'tab' : 'route'} aria-current={current ? 'page' : undefined}>
        <Icon size={compact ? 15 : 17} aria-hidden="true" />{route.label}
      </a>
    {:else}
      <button type="button" class={compact ? 'tab' : 'route'} aria-current={current ? 'page' : undefined} onclick={() => nav.go(route.id)}>
        <Icon size={compact ? 15 : 17} aria-hidden="true" />{route.label}
      </button>
    {/if}
  {/each}
{/snippet}

<div class="casebook @container {className}">
  <div class="shell">
  <aside class="side" aria-label="docket">
    <div class="brand">
      <DocketMark size={30} />
      <span class="grid min-w-0 leading-tight">
        <b class="font-serif text-2xl font-normal tracking-[-0.01em]">Docket</b>
        <small class="text-mute truncate text-[11.5px]">{graph ? graph.project.name : 'casebook of evidence'}</small>
      </span>
    </div>
    <nav aria-label="Workspace" class="flex flex-col gap-px">
      {@render routeLinks(false)}
    </nav>
    {#if graph}
      <span class="label-mono px-2.5 pt-4">Open docket</span>
      <div class="docket">
        <span class="sdot" aria-hidden="true"></span>
        <span class="min-w-0 break-words">{graph.project.name}</span>
        <span class="text-mute col-start-2 truncate font-mono text-[11px]" title={graph.project.root}>{graph.project.root}</span>
        <span class="text-mute col-start-2 font-mono text-[11px] tabular-nums">
          {graph.entities.length} {graph.entities.length === 1 ? 'exhibit' : 'exhibits'} · {graph.edges.length}
          {graph.edges.length === 1 ? 'link' : 'links'}
        </span>
      </div>
    {/if}
    <div class="flex-1"></div>
    <div class="foot">
      <span class="text-mute flex-1 text-xs">docket open</span>
      {#if theme}
        <button type="button" class="icon-btn" aria-label={theme.dark ? 'Use the light theme' : 'Use the dark theme'} onclick={theme.toggle}>
          {#if theme.dark}<Sun size={16} />{:else}<Moon size={16} />{/if}
        </button>
      {/if}
    </div>
  </aside>

  <div class="grid min-h-0 min-w-0 grid-rows-[auto_1fr]">
  <header class="crumbs">
    <span class="compact-brand"><DocketMark size={24} /></span>
    <nav aria-label="Workspace" class="compact-nav">
      {@render routeLinks(true)}
    </nav>
    <ol class="trail" aria-label="Breadcrumb">
      {#if graph}<li class="truncate" title={graph.project.root}>{graph.project.name}</li><li class="sep" aria-hidden="true">/</li>{/if}
      <li><b aria-current="page">{ROUTES.find((route) => route.id === nav.route)?.label}</b></li>
    </ol>
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
      {#if graph && problems.length > 0}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => {
            showProblems = !showProblems
            if (showProblems) workspace.syncOpen = false
          }}
          aria-expanded={showProblems}
          aria-label="Validation findings"
        >
          <CircleAlert class={errors > 0 ? 'text-signal' : 'text-warn'} />
          {problems.length}
        </Button>
      {/if}
      <Button
        variant="outline"
        size="sm"
        class="relative"
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
          <span class="bg-warn absolute top-1 right-1 size-1.5 rounded-full" aria-hidden="true"></span>
        {/if}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Reload from the files" onclick={() => workspace.load()} disabled={workspace.loading}>
        <RefreshCw class={workspace.loading ? 'animate-spin' : ''} />
      </Button>
      {#if theme}
        <span class="compact-theme">
          <Button variant="ghost" size="icon-sm" aria-label={theme.dark ? 'Use the light theme' : 'Use the dark theme'} onclick={theme.toggle}>
            {#if theme.dark}<Sun />{:else}<Moon />{/if}
          </Button>
        </span>
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
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
      <div class="bg-paper shadow-paper flex max-w-lg flex-col gap-3 rounded-[10px] p-5">
        <div class="flex items-center gap-2 font-serif text-2xl"><CircleAlert class="text-destructive size-5" /> Could not open the casebook</div>
        <p class="text-muted-foreground text-sm break-words">{workspace.loadError}</p>
        <Button variant="outline" onclick={() => workspace.load()}>Try again</Button>
      </div>
    </div>
  {:else if !graph}
    <div class="text-muted-foreground grid place-items-center font-serif text-2xl italic">Opening the casebook…</div>
  {:else}
    <div class="relative grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div class="relative min-h-0 min-w-0 overflow-hidden">
        {@render children()}
        {#if workspace.syncOpen}
          <SyncPanel sync={workspace.sync} onclose={() => (workspace.syncOpen = false)} />
        {/if}
        {#if showProblems && problems.length > 0}
          <div class="bg-paper shadow-lift absolute top-3 right-3 z-20 flex max-h-[60%] w-96 max-w-[calc(100%-1.5rem)] flex-col rounded-[10px]">
            <div class="flex items-center justify-between border-b px-3 py-2">
              <span class="section-title">Validation findings ({problems.length})</span>
              <Button variant="ghost" size="icon-xs" aria-label="Close" onclick={() => (showProblems = false)}><X /></Button>
            </div>
            <ul class="flex flex-col divide-y overflow-y-auto text-xs">
              {#each problems as problem, index (index)}
                <li class="flex flex-col gap-0.5 px-3 py-2">
                  <span class="flex items-center gap-1.5">
                    <span class="font-medium {problem.severity === 'error' ? 'text-signal' : 'text-warn'}">
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
          class="bg-paper shadow-lift absolute inset-x-0 bottom-0 z-30 flex max-h-[62%] min-h-0 flex-col overflow-hidden rounded-t-[18px] lg:relative lg:z-auto lg:my-4 lg:mr-4 lg:max-h-none lg:w-[440px] lg:max-w-[42vw] lg:rounded-[14px]"
        >
          <Tabs.Root bind:value={workspace.sideTab} class="flex min-h-0 flex-1 flex-col gap-0">
            <div class="flex items-center gap-2 border-b px-3 py-2.5">
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
  </div>
</div>

<style>
  .casebook {
    background: var(--bg);
    color: var(--ink);
  }
  .shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  /* The sidebar, from a laptop's width up; narrower, its views sit in the breadcrumb bar. */
  .side {
    display: none;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 14px 12px;
    overflow-y: auto;
    background: var(--side);
    border-right: 1px solid var(--rule);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px 10px;
  }
  .route {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .route:hover {
    background: color-mix(in oklab, var(--sunk) 80%, transparent);
  }
  .route[aria-current='page'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-1);
  }
  .route[aria-current='page']::before {
    content: '';
    position: absolute;
    left: -12px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--signal);
  }
  .docket {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    gap: 1px 8px;
    padding: 6px 10px;
    font-size: 13.5px;
  }
  .sdot {
    align-self: center;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 0 0 6px;
    border-top: 1px solid var(--rule);
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--mute);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--paper);
    border-color: var(--rule);
    color: var(--ink);
  }

  /* The breadcrumb bar. */
  .crumbs {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 50px;
    padding: 6px 16px;
    background: color-mix(in oklab, var(--bg) 86%, transparent);
    border-bottom: 1px solid var(--rule);
    color: var(--mute);
    font-size: 13.5px;
  }
  .trail {
    display: none;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 18rem;
    margin: 0;
    padding: 0;
    list-style: none;
    white-space: nowrap;
  }
  .trail b {
    color: var(--ink);
    font-weight: 500;
  }
  .trail .sep {
    color: var(--rule-2);
  }
  .compact-brand {
    display: inline-flex;
  }
  .compact-nav {
    display: flex;
    gap: 2px;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--mute);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--ink);
  }
  .tab[aria-current='page'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-1);
  }
  .tab[aria-current='page'] :global(svg) {
    color: var(--signal);
  }
  @container (min-width: 64rem) {
    .shell {
      grid-template-columns: 232px minmax(0, 1fr);
    }
    .side {
      display: flex;
    }
    .compact-brand,
    .compact-nav,
    .compact-theme {
      display: none;
    }
    .trail {
      display: flex;
    }
    .crumbs {
      padding: 6px 24px;
    }
  }
</style>
