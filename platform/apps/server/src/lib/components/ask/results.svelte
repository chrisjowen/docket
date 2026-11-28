<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowRight, FileText, Waypoints } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  import { countsOf, marked, RESULT_KINDS, snippet, termsOf, type ResultGroups, type ResultKind } from '$lib/ask/groups'
  import type { SearchHit } from '$lib/ask/model'
  import { typeCode, weightClass } from '$lib/docket'
  import { SHEET_KINDS } from '$lib/graph/browse'
  import { exhibitLabel } from '$lib/graph/sheet'

  /**
   * Direct search's results, by kind: notes, memory matches, records,
   * exhibits and docket entries, each with a count. All shows the first few
   * of each kind with a link into its tab; a tab lists every one. The query's
   * words are marked wherever they appear.
   */
  interface Props {
    query: string
    hits: SearchHit[]
    groups: ResultGroups
    org: string
    /** Each docket's number, by slug. */
    docketNos: ReadonlyMap<string, string>
    /** Several dockets were searched: each result names its own. */
    many: boolean
    /** A record type's colour in a docket. */
    colourOf: (workspace: string, type: string) => string
    /** Above the tabs: what narrows the records, and how they are shown. */
    filters?: Snippet
    /** The records drawn some other way than the list, like on a map. */
    recordsBody?: Snippet
  }

  let { query, hits, groups, org, docketNos, many, colourOf, filters, recordsBody }: Props = $props()

  /** Results of each kind All shows. */
  const FIRST = 2

  let tab = $state<'all' | ResultKind>('all')
  // A new search opens on All.
  $effect(() => {
    void query
    tab = 'all'
  })

  const terms = $derived(termsOf(query))
  const counts = $derived(countsOf(hits.length, groups))
  const label = (kind: ResultKind) => RESULT_KINDS.find(([key]) => key === kind)?.[1] ?? kind
  const focus = (id: string) => `focus=${encodeURIComponent(id)}`
  const percent = (value: number) => `${Math.round(value * 100)}%`
  const filed = (day: string) => {
    const [year, mm, dd] = day.split('-')
    return year && mm && dd ? `${mm}/${dd}/${year}` : day
  }
  const kinds = $derived(tab === 'all' ? RESULT_KINDS.map(([kind]) => kind) : [tab])
  const shown = <T,>(items: readonly T[]) => (tab === 'all' ? items.slice(0, FIRST) : items)
</script>

{#snippet mark(text: string)}{#each marked(text, terms) as part, index (index)}{#if part.mark}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}{/snippet}

{#snippet weight(value: number | null)}
  {#if value !== null}
    <span class="weight {weightClass(value)}" title="Weight of evidence"><span class="bar"><i style="width: {percent(value)}"></i></span>{percent(value)}</span>
  {:else}
    <span></span>
  {/if}
{/snippet}

{#snippet docket(slug: string, name: string)}
  {#if many}<span class="ws" title="The docket this came from">{name}{#if docketNos.get(slug)}<span class="mono"> · {docketNos.get(slug)}</span>{/if}</span>{/if}
{/snippet}

{#snippet more(kind: ResultKind, count: number)}
  {#if tab === 'all' && count > FIRST}
    <button type="button" class="more" onclick={() => (tab = kind)}>All {count} {label(kind).toLowerCase()} <ArrowRight size={14} aria-hidden="true" /></button>
  {/if}
{/snippet}

<article class="card results" data-testid="search-results">
  <div class="seg rtabs" role="tablist" aria-label="Result types">
    <button type="button" role="tab" aria-selected={tab === 'all'} onclick={() => (tab = 'all')}>All <span class="count">{counts.all}</span></button>
    {#each RESULT_KINDS as [kind, name] (kind)}
      <button type="button" role="tab" aria-selected={tab === kind} disabled={counts[kind] === 0} onclick={() => (tab = kind)} data-testid="tab-{kind}">
        {name} <span class="count">{counts[kind]}</span>
      </button>
    {/each}
  </div>
  {#if filters}<div class="filters">{@render filters()}</div>{/if}

  <div class="rbody" role="tabpanel" aria-label={tab === 'all' ? 'All results' : label(tab)}>
    {#if counts.all === 0}
      <p class="muted none">Nothing on the record matches. Try fewer or different words, or more dockets.</p>
    {/if}
    {#each kinds as kind (kind)}
      {#if kind === 'notes' && groups.notes.length}
        <section class="rgroup" data-testid="group-notes">
          <div class="label">Notes · {groups.notes.length}</div>
          {#each shown(groups.notes) as note (`${note.workspace.slug}/${note.no}`)}
            <a class="hit" href="{resolve('/a/[acct]/d/[docket]/graph', { acct: org, docket: note.workspace.slug })}?view=facts&open={note.no}" data-testid="note-hit">
              <span class="hk"><FileText size={14} aria-hidden="true" /> Note</span>
              <span class="body">
                <span class="docket-no">{note.no}</span> <b>{@render mark(note.title)}</b>
                {@render docket(note.workspace.slug, note.workspace.name)}
                <span class="snip">{@render mark(snippet(note.text, terms))}</span>
              </span>
              {@render weight(note.weight)}
            </a>
          {/each}
          {@render more('notes', groups.notes.length)}
        </section>
      {:else if kind === 'memory' && groups.memory.length}
        <section class="rgroup" data-testid="group-memory">
          <div class="label">Memory · {groups.memory.length}</div>
          {#each shown(groups.memory) as memory (`${memory.workspace.slug}/${memory.id}`)}
            <a class="hit" href="{resolve('/a/[acct]/d/[docket]/graph', { acct: org, docket: memory.workspace.slug })}?{focus(memory.id)}" data-testid="memory-hit">
              <span class="hk"><Waypoints size={14} aria-hidden="true" /> Memory</span>
              <span class="body">
                <span class="mono muted">{memory.id} · mem0</span>
                {@render docket(memory.workspace.slug, memory.workspace.name)}
                <span class="snip ink">{@render mark(snippet(memory.text, terms))}</span>
                <span class="snip">Re {memory.title}</span>
              </span>
              {#if memory.score !== null}<span class="sim">{percent(memory.score)} match</span>{:else}<span></span>{/if}
            </a>
          {/each}
          {@render more('memory', groups.memory.length)}
        </section>
      {:else if kind === 'records' && hits.length}
        <section class="rgroup" data-testid="group-records">
          <div class="label">Records · {hits.length}</div>
          {#if tab === 'records' && recordsBody}
            {@render recordsBody()}
          {:else}
            {#each shown(hits) as hit (`${hit.workspace.slug}/${hit.id}`)}
              <a class="hit" href="{resolve('/a/[acct]/d/[docket]/graph', { acct: org, docket: hit.workspace.slug })}?{focus(hit.id)}" data-testid="search-hit" data-workspace={hit.workspace.slug} data-id={hit.id}>
                <span class="hk"><span class="code" style="--c: {colourOf(hit.workspace.slug, hit.type)}">{typeCode(hit.type)}</span></span>
                <span class="body">
                  <span class="mono muted">{hit.id}</span> <b>{@render mark(hit.title)}</b>
                  {@render docket(hit.workspace.slug, hit.workspace.name)}
                  {#if hit.summary}<span class="snip">{@render mark(snippet(hit.summary, terms))}</span>{/if}
                  <span class="tags">
                    {#each hit.tags as tag (tag)}<span class="badge">{tag}</span>{/each}
                    <span class="via mono">via {hit.foundBy.join(' · ')}</span>
                  </span>
                </span>
                {@render weight(hit.weight)}
              </a>
            {/each}
            {@render more('records', hits.length)}
          {/if}
        </section>
      {:else if kind === 'exhibits' && groups.exhibits.length}
        <section class="rgroup" data-testid="group-exhibits">
          <div class="label">Exhibits · {groups.exhibits.length}</div>
          {#each shown(groups.exhibits) as exhibit (`${exhibit.workspace.slug}/${exhibit.no}`)}
            <div class="hit" data-testid="exhibit-hit">
              <span class="hk"><span class="ex">{exhibitLabel(docketNos.get(exhibit.workspace.slug) ?? '', exhibit.no)}</span></span>
              <span class="body">
                <b>{@render mark(exhibit.text)}</b>
                {@render docket(exhibit.workspace.slug, exhibit.workspace.name)}
                {#if exhibit.location || exhibit.source}<span class="snip mono">{[exhibit.source, exhibit.location].filter(Boolean).join(' · ')}</span>{/if}
                <a class="snip" href="{resolve('/a/[acct]/d/[docket]/graph', { acct: org, docket: exhibit.workspace.slug })}?view=evidence&doc={encodeURIComponent(exhibit.path)}">In {exhibit.path}</a>
              </span>
              <a class="rec" href="{resolve('/a/[acct]/d/[docket]/graph', { acct: org, docket: exhibit.workspace.slug })}?{focus(exhibit.entity)}">{exhibit.entityTitle}</a>
            </div>
          {/each}
          {@render more('exhibits', groups.exhibits.length)}
        </section>
      {:else if kind === 'entries' && groups.entries.length}
        <section class="rgroup" data-testid="group-entries">
          <div class="label">Docket entries · {groups.entries.length}</div>
          {#each shown(groups.entries) as entry (`${entry.workspace.slug}/${entry.no}`)}
            <a class="hit" href="{resolve('/a/[acct]/d/[docket]/graph', { acct: org, docket: entry.workspace.slug })}?view=timeline{entry.entity ? `&${focus(entry.entity)}` : ''}" data-testid="entry-hit">
              <span class="hk mono">#{String(entry.no).padStart(3, '0')}</span>
              <span class="body">
                <b class="kind {entry.kind}">{SHEET_KINDS[entry.kind].toUpperCase()}</b>
                <span class="mono muted">{filed(entry.day)}</span>
                {@render docket(entry.workspace.slug, entry.workspace.name)}
                <span class="snip ink">{@render mark(entry.text)}</span>
              </span>
              <span class="mono muted small">{entry.entityTitle ?? ''}</span>
            </a>
          {/each}
          {@render more('entries', groups.entries.length)}
        </section>
      {/if}
    {/each}
  </div>
</article>

<style>
  .results {
    padding: 0;
    min-width: 0;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    margin: 10px 12px 0;
    background: var(--sunk);
    border-radius: 9px;
    max-width: calc(100% - 24px);
    width: fit-content;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .seg::-webkit-scrollbar {
    display: none;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 11px;
    border: 0;
    background: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--mute);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s;
  }
  .seg button:hover:not(:disabled) {
    color: var(--ink);
  }
  .seg button[aria-selected='true'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.08),
      0 0 0 1px var(--rule);
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .seg .count {
    font: 500 10.5px var(--font-mono);
    color: var(--mute);
  }
  .filters {
    margin: 10px 12px 0;
  }
  .rbody {
    display: grid;
    gap: 18px;
    padding: 14px 12px 16px;
  }
  .none {
    margin: 0;
    padding: 0 4px;
  }
  .rgroup {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .rgroup > .label {
    margin-bottom: 2px;
  }
  .hit {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--rule);
    color: inherit;
    font-size: 14px;
    text-decoration: none;
    animation: rise 0.4s var(--ease-out) both;
    transition:
      box-shadow 0.15s,
      transform 0.2s var(--ease-out);
  }
  a.hit:hover {
    box-shadow: inset 0 0 0 1px var(--ink-2);
    transform: translateX(2px);
  }
  .hit .hk {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-top: 1px;
    font: 500 11.5px var(--font-mono);
    color: var(--mute);
  }
  .hit .body {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .snip {
    display: block;
    margin-top: 3px;
    font-size: 13px;
    color: var(--mute);
  }
  .snip.ink {
    color: var(--ink);
  }
  a.snip {
    width: fit-content;
  }
  .hit :global(mark) {
    padding: 0 1px;
    border-radius: 3px;
    background: var(--signal-soft);
    color: inherit;
  }
  .sim {
    font: 600 11.5px var(--font-mono);
    color: var(--ok);
    white-space: nowrap;
  }
  .ws {
    display: inline-block;
    margin-left: 6px;
    font-size: 12px;
    color: var(--signal);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin-top: 5px;
  }
  .via {
    font-size: 11px;
    color: var(--mute);
  }
  .ex {
    display: inline-flex;
    align-items: center;
    height: 19px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--ink);
    color: var(--bg);
    font: 600 10.5px/1 var(--font-mono);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .rec {
    font-size: 13px;
    font-weight: 600;
    text-align: right;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .kind {
    font: 600 10.5px var(--font-mono);
    letter-spacing: 0.06em;
  }
  .kind.decision {
    color: var(--t-decision);
  }
  .kind.event {
    color: var(--signal);
  }
  .kind.observed {
    color: var(--t-api);
  }
  .kind.change {
    color: var(--mute);
  }
  .small {
    font-size: 12px;
    text-align: right;
  }
  .more {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 6px;
    margin-top: 2px;
    padding: 0;
    border: 0;
    background: none;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
  }
  .more:hover {
    color: var(--signal);
  }
  .more :global(svg) {
    transition: transform 0.2s var(--ease-out);
  }
  .more:hover :global(svg) {
    transform: translateX(3px);
  }
  @media (max-width: 900px) {
    .hit {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .hit .hk {
      grid-column: 1 / -1;
    }
  }
</style>
