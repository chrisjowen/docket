<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { ExternalLink, Maximize2, Minimize2, Search, X } from '@lucide/svelte'

  import CardGraph from '$lib/components/graph/card-graph.svelte'
  import { typeCode, weightClass } from '$lib/docket'

  import { boardOf, hasSubgraph, searchOf, typeColours, weightOf, type SearchGraph, type SearchLink, type SearchNode } from './board'
  import type { AppBridge, ToolResult } from './bridge'

  /**
   * docket_search's app, as Docket Cloud returns it: the resources the search
   * found, the subgraphs the projections returned and the resources a link
   * away, as case cards on the Record's network, with the matches - or the
   * picked record's case file - beside it. It searches again through the same
   * tool, and opens a record in the cloud's graph when the host lets it open
   * links.
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

  const board = $derived(graph ? boardOf(graph) : null)
  const colourOf = $derived(graph ? typeColours(graph) : () => 'var(--graph-other)')
  const picked = $derived(graph?.nodes.find((node) => node.id === selected) ?? null)
  const pickedLinks = $derived(
    graph && picked
      ? { outgoing: graph.links.filter((link) => link.source === picked.id), incoming: graph.links.filter((link) => link.target === picked.id) }
      : null,
  )
  const nodeOf = (id: string): SearchNode | undefined => graph?.nodes.find((node) => node.id === id)
  const titleOf = (id: string): string => nodeOf(id)?.title ?? id
  const subgraph = $derived(graph ? hasSubgraph(graph) : false)
  const roleOf = (node: SearchNode): string =>
    node.match ? 'a match' : node.via === 'adapter' ? 'returned by a projection' : 'one link away, in the documents'
  const percent = (weight: number) => `${Math.round(weight * 100)}%`
  const fullscreen = $derived(displayMode() === 'fullscreen')

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
      const granted = (await bridge.request('ui/request-display-mode', { mode: fullscreen ? 'inline' : 'fullscreen' })) as { mode?: string } | null
      if (granted?.mode) ondisplaymode(granted.mode)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }
</script>

{#snippet code(type: string | undefined, ghost = false)}
  {#if type && !ghost}<span class="code" style="--c: {colourOf(type)}">{typeCode(type)}</span>{:else}<span class="code ref">REF</span>{/if}
{/snippet}

{#snippet weight(value: number | null)}
  {#if value !== null}
    <span class="weight {weightClass(value)}" title="Weight of evidence"><span class="bar"><i style="width: {value * 100}%"></i></span>{percent(value)}</span>
  {/if}
{/snippet}

{#snippet provenance(link: SearchLink)}
  {#if link.via === 'adapter'}
    <span class="by">{link.foundBy?.join(', ')}{link.confidence === undefined ? '' : ` · confidence ${percent(link.confidence)}`}</span>
    {#each link.why ?? [] as why, index (index)}<span class="why">{why}</span>{/each}
  {/if}
{/snippet}

{#snippet searchBox()}
  <label class="tool ask">
    <Search size={14} aria-hidden="true" />
    <span class="visually-hidden">Search the docket</span>
    <input type="search" placeholder="Search the docket" enterkeyhint="search" bind:value={query} onkeydown={search} disabled={searching} />
  </label>
{/snippet}

<div class="app" class:fullscreen>
  <header class="head">
    <div class="titles">
      <p class="caption">
        <span class="label">Docket Cloud · search</span>
        {#if graph}
          {#if graph.index.synced && graph.index.behind === 0}
            <span class="status"><i></i>Current</span>
          {:else}
            <span class="status warn"><i></i>Catching up{graph.index.behind ? ` · ${graph.index.behind}` : ''}</span>
          {/if}
        {/if}
      </p>
      <h1>
        {#if graph}{graph.matches.length} {graph.matches.length === 1 ? 'record' : 'records'} on <em>{graph.query}</em>{:else if searching || !result()}Searching the <em>docket</em>{:else}Docket <em>search</em>{/if}
      </h1>
    </div>
    {#if graph}<span class="where mono">{graph.project.name}</span>{/if}
    {#if displayModes().includes('fullscreen')}
      <button type="button" class="button small square" aria-label={fullscreen ? 'Show inline' : 'Show full screen'} onclick={toggleFullscreen}>
        {#if fullscreen}<Minimize2 size={15} aria-hidden="true" />{:else}<Maximize2 size={15} aria-hidden="true" />{/if}
      </button>
    {/if}
  </header>

  {#if error}<p class="alert" role="alert">{error}</p>{/if}

  {#if !result()}
    <div class="message"><p class="muted">Searching the docket…</p></div>
  {:else if problem !== null}
    <div class="message">
      <div class="problem">
        <p>{problem}</p>
        {@render searchBox()}
      </div>
    </div>
  {:else if graph && board}
    <div class="record">
      <div class="network">
        <!-- Each result is a board of its own, laid out and framed afresh. -->
        {#key graph}
          <CardGraph
            nodes={board.nodes}
            links={board.links}
            placed={board.placed}
            {selected}
            onselect={(id) => (selected = id)}
            emphasis={board.emphasis}
            find={false}
            fill
            toolbar={searchBox}
            emptyHint={graph.index.synced && graph.index.behind === 0
              ? 'Nothing in the docket matches. Try other words.'
              : 'Nothing matches yet, and the cloud is still projecting the latest writes.'}
          />
        {/key}
      </div>

      <aside class="case-file">
        {#if picked}
          <header class="file-head">
            <button type="button" class="close" onclick={() => (selected = null)} aria-label="Back to the matches"><X size={16} aria-hidden="true" /></button>
            <div class="meta-row">
              {@render code(picked.type, picked.ghost)}
              <span class="docket-no">{picked.id}</span>
            </div>
            <h2>{picked.ghost ? picked.id : picked.title}</h2>
            <div class="meta-row">
              {@render weight(weightOf(graph, picked.id))}
              {#if picked.ghost}
                <span class="stamp red">Not on record</span>
              {:else}
                <span class="tag">{picked.type.replaceAll('_', ' ')} · {roleOf(picked)}</span>
              {/if}
            </div>
            {#if picked.path}<p class="path mono">{picked.path}</p>{/if}
          </header>
          <div class="body">
            {#if picked.ghost}
              <p class="notice">Not on record: a relation names <code>{picked.id}</code>, but no document in the docket files it yet{picked.via === 'adapter' ? '; a projection returned it' : ''}.</p>
            {/if}
            {#if pickedLinks}
              <section>
                <h3 class="label"><span>Linked records</span><span>{pickedLinks.outgoing.length + pickedLinks.incoming.length}</span></h3>
                {#if pickedLinks.outgoing.length + pickedLinks.incoming.length === 0}
                  <p class="muted small">No relations on the board.</p>
                {:else}
                  <ul class="rel-list">
                    {#each pickedLinks.outgoing as link (`${link.rel}\u0000${link.target}`)}
                      {@const other = nodeOf(link.target)}
                      <li class:context={subgraph && link.via === 'canonical'}>
                        <span class="rel">{link.rel} →</span>
                        {@render code(other?.type, other?.ghost ?? true)}
                        <button type="button" class="linkish" onclick={() => (selected = link.target)}>{titleOf(link.target)}</button>
                        {@render provenance(link)}
                      </li>
                    {/each}
                    {#each pickedLinks.incoming as link (`${link.source}\u0000${link.rel}`)}
                      {@const other = nodeOf(link.source)}
                      <li class:context={subgraph && link.via === 'canonical'}>
                        {@render code(other?.type, other?.ghost ?? true)}
                        <button type="button" class="linkish" onclick={() => (selected = link.source)}>{titleOf(link.source)}</button>
                        <span class="rel">→ {link.rel}</span>
                        {@render provenance(link)}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </section>
            {/if}
            <div class="actions">
              {#if graph.viewer && !picked.ghost}
                <button type="button" class="button small primary" onclick={() => open(picked.id)}><ExternalLink size={14} aria-hidden="true" />Open in Docket Cloud</button>
              {/if}
              <button type="button" class="button small" onclick={() => (selected = null)}>All matches</button>
            </div>
          </div>
        {:else}
          <div class="body">
            <section>
              <h3 class="label"><span>Matches</span><span>{graph.matches.length}</span></h3>
              <ul class="matches">
                {#each graph.matches as match (match.id)}
                  <li>
                    <button type="button" class="match" onclick={() => (selected = match.id)}>
                      {@render code(match.type)}
                      <span class="match-text">
                        <b>{match.title}</b>
                        <span class="mono muted">{match.id}</span>
                      </span>
                      {@render weight(match.confidence ?? null)}
                    </button>
                  </li>
                {:else}
                  <li class="muted small">No matches.</li>
                {/each}
              </ul>
            </section>
            {#if graph.paths.length > 0}
              <section>
                <h3 class="label"><span>Paths returned</span><span>{graph.paths.length}</span></h3>
                <ol class="paths">
                  {#each graph.paths as path, index (index)}
                    <li>
                      {#each path.nodes as id, step (step)}
                        {#if step > 0}<span class="rel">→</span>{/if}
                        <button type="button" class="linkish" onclick={() => (selected = id)}>{titleOf(id)}</button>
                      {/each}
                      <span class="by">{path.foundBy.join(', ')}</span>
                      {#each path.why ?? [] as why, line (line)}<span class="why">{why}</span>{/each}
                    </li>
                  {/each}
                </ol>
              </section>
            {/if}
            {#if subgraph && graph.nodes.some((node) => node.via === 'canonical')}
              <p class="muted small">Faded: one link away in the documents, not returned by a projection.</p>
            {/if}
            {#if graph.omitted > 0}
              <p class="muted small">{graph.omitted} more linked records are left off the board.</p>
            {/if}
            {#each graph.sources.filter((source) => source.error) as source (source.name)}
              <p class="muted small">{source.name} could not search: {source.error}</p>
            {/each}
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 34rem;
    background: var(--bg);
    color: var(--ink);
  }
  .app.fullscreen {
    height: 100vh;
  }

  /* A page head in little: caption row and serif title, the key word in red italic. */
  .head {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--rule);
    background: var(--paper);
  }
  .titles {
    flex: 1 1 auto;
    min-width: 0;
  }
  .caption {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
  }
  h1 {
    margin: 0;
    overflow: hidden;
    font-size: 24px;
    line-height: 1.1;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  h1 em {
    animation: none;
  }
  .where {
    flex: none;
    max-width: 30%;
    overflow: hidden;
    margin-bottom: 3px;
    color: var(--mute);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .button.square {
    flex: none;
    width: 1.9rem;
    padding: 0;
  }
  .alert {
    margin: 0;
    border-radius: 0;
  }

  .message {
    display: grid;
    flex: 1;
    place-items: center;
    padding: 24px;
  }
  .problem {
    display: grid;
    justify-items: center;
    gap: 14px;
    max-width: 30rem;
    text-align: center;
  }
  .problem p {
    margin: 0;
    color: var(--ink-2);
    white-space: pre-line;
  }

  /* The record: the network, and the case file beside it (below it, in a narrow frame). */
  .record {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1fr) 300px;
    min-height: 0;
  }
  .network {
    min-width: 0;
    min-height: 0;
  }
  .case-file {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--rule);
    background: var(--paper);
  }

  /* The search box, in the canvas's top row where the cloud's find box sits. */
  .ask {
    cursor: text;
  }
  .ask input {
    width: 190px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: 12.5px;
  }
  .problem .ask {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--rule-2);
    border-radius: 7px;
    background: var(--paper);
    color: var(--mute);
  }

  .file-head {
    position: relative;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--rule);
  }
  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--mute);
    cursor: pointer;
  }
  .close:hover {
    border-color: var(--rule);
    background: var(--bg);
    color: var(--ink);
  }
  h2 {
    margin: 8px 28px 8px 0;
    font-size: 24px;
    line-height: 1.05;
    overflow-wrap: anywhere;
  }
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-right: 28px;
  }
  .docket-no {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    color: var(--mute);
    font-size: 12.5px;
  }
  .path {
    margin: 8px 0 0;
    color: var(--ink-2);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .body {
    display: grid;
    align-content: start;
    gap: 16px;
    min-height: 0;
    padding: 14px 16px 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .body > * {
    animation: rise 0.4s var(--ease-out) both;
  }
  section > .label {
    display: flex;
    justify-content: space-between;
    margin: 0 0 8px;
  }
  .small {
    margin: 0;
    font-size: 12.5px;
  }
  .notice {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--signal-soft);
    font-size: 13px;
  }

  .matches,
  .rel-list,
  .paths {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .match {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 3px 10px;
    width: 100%;
    padding: 9px 4px;
    border: 0;
    border-top: 1px solid var(--rule);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .matches li:first-child .match {
    border-top: 0;
  }
  .match:hover b {
    text-decoration: underline;
    text-decoration-color: var(--signal);
    text-underline-offset: 3px;
  }
  .match .code {
    margin-top: 2px;
  }
  .match-text {
    display: grid;
    min-width: 0;
  }
  .match-text b {
    font: 400 17px/1.2 var(--font-serif);
    overflow-wrap: anywhere;
  }
  .match-text .mono {
    overflow: hidden;
    font-size: 11px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .match .weight {
    grid-column: 2;
  }
  .weight .bar {
    width: 40px;
  }
  .weight .bar i {
    animation: none;
  }

  .rel-list li,
  .paths li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-height: 32px;
    padding: 4px 0;
    font-size: 13px;
  }
  .rel-list li.context {
    opacity: 0.6;
  }
  .rel {
    color: var(--mute);
    font: 500 11.5px var(--font-mono);
  }
  .by {
    color: var(--mute);
    font-size: 11.5px;
  }
  .why {
    flex-basis: 100%;
    padding-left: 10px;
    border-left: 2px solid var(--rule);
    color: var(--ink-2);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .code.ref {
    background: var(--mute);
  }
  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .linkish:hover {
    text-decoration-color: var(--signal);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  @media (max-width: 640px) {
    .app {
      height: 40rem;
    }
    .where {
      display: none;
    }
    .record {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) 14rem;
    }
    .case-file {
      border-top: 1px solid var(--rule);
      border-left: 0;
    }
    .ask input {
      width: 130px;
    }
  }
</style>
