<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { FileText, Search } from '@lucide/svelte'

  import { ACTION_LABELS, CHANNEL_LABELS, ORIGIN_LABELS } from '$lib/activity'
  import { typeCode } from '$lib/docket'
  import { evidenceTrails, filterTrails, type ActivityEntry, type DocumentOrigin, type TrailFilter } from '$lib/graph/browse'
  import type { UiGraph } from '$lib/graph/model'
  import { standingOf } from '$lib/graph/standing'

  /**
   * The Exhibits: each document with the numbered exhibits it holds - what
   * each says, where it was seen, who filed it and when - the relations it
   * asserts, and the amendments the activity log recorded against it.
   */
  interface Props {
    graph: UiGraph
    documents: DocumentOrigin[]
    activity: ActivityEntry[]
    filter: TrailFilter
    doc: string | null
    ws: { org: string; ws: string }
    colourOf: (type: string) => string
    /** An exhibit's label by its key. */
    exhibitLabel: (key: string) => string | undefined
    onfilter: (change: Partial<TrailFilter>) => void
    onopen: (path: string | null) => void
    onselect: (id: string) => void
  }

  let { graph, documents, activity, filter, doc, ws, colourOf, exhibitLabel, onfilter, onopen, onselect }: Props = $props()

  const all = $derived(evidenceTrails(graph, documents, activity))
  const trails = $derived(filterTrails(all, filter))
  const open = $derived(doc ? all.find((trail) => trail.path === doc) : undefined)
  const sources = $derived([...new Set(all.flatMap((trail) => trail.sources))].sort())
  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))
  const totals = $derived({
    held: all.filter((trail) => trail.items.length > 0).length,
    items: all.reduce((sum, trail) => sum + trail.items.length, 0),
    bySource: sources.map((source) => [source, all.reduce((sum, trail) => sum + trail.items.filter((item) => item.source === source).length, 0)] as const),
  })
  /** The relations the open document's records assert, with how many exhibits stand behind each. */
  const asserted = $derived(open ? open.entities.flatMap((entity) => entity.links.map((link) => ({ entity, link }))) : [])

  const name = (path: string) => path.split('/').at(-1) ?? path
  const folder = (path: string) => path.split('/').slice(0, -1).join('/')
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const day = (at: unknown) => {
    if (typeof at !== 'string') return null
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : at)
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  /** Who filed an exhibit, from what, and when: "code · filed 2 Oct 2026 by alice". */
  const byline = (source: string | undefined, evidence: Record<string, unknown>) => {
    const filed = day(evidence.observedAt)
    return `${source ?? 'source not given'}${filed ? ` · filed ${filed}` : ''}${typeof evidence.observedBy === 'string' ? ` by ${evidence.observedBy}` : ''}`
  }
  const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`
</script>

{#snippet code(type: string | undefined)}
  {#if type}<span class="code" style="--c: {colourOf(type)}">{typeCode(type)}</span>{:else}<span class="code ref">REF</span>{/if}
{/snippet}

<div class="ex-grid" data-testid="evidence">
  <aside class="list" aria-label="Documents">
    <div class="filters">
      <label class="search">
        <Search size={14} aria-hidden="true" />
        <span class="visually-hidden">Contains</span>
        <input type="search" placeholder="Path, record or location" value={filter.q} oninput={(event) => onfilter({ q: event.currentTarget.value })} />
      </label>
      <div class="row">
        <select value={filter.source} onchange={(event) => onfilter({ source: event.currentTarget.value })} aria-label="Source">
          <option value="">Every source</option>
          {#each sources as source (source)}<option value={source}>{source}</option>{/each}
        </select>
        <label class="check">
          <input type="checkbox" checked={filter.bare} onchange={(event) => onfilter({ bare: event.currentTarget.checked })} />
          No evidence
        </label>
      </div>
      <p class="label" aria-live="polite">{trails.length} of {all.length} documents</p>
    </div>
    <ul class="doc-list reveal">
      {#each trails as trail, index (trail.path)}
        {@const first = trail.entities[0]}
        <li style="--i: {Math.min(index, 20)}">
          <button type="button" class="doc" aria-current={trail.path === doc ? 'true' : undefined} onclick={() => onopen(trail.path)} data-testid="trail">
            {@render code(first?.type)}
            <span class="path">
              <span class="name">{name(trail.path)}</span>
              <span class="folder">{folder(trail.path)}</span>
              <span class="meta">{trail.items.length ? `${plural(trail.items.length, 'exhibit')} · ${trail.sources.join(', ') || 'no source'}` : 'no exhibits'}</span>
            </span>
            <span class="cnt" class:none={trail.items.length === 0}>{trail.items.length} EX.</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if trails.length === 0}<p class="muted empty">{all.length === 0 ? 'No documents yet.' : 'Nothing matches these filters.'}</p>{/if}
  </aside>

  <section class="card detail reveal" aria-label="Exhibit trail" data-testid="trail-detail">
    {#if open}
      {#key open.path}
        <p class="label caption" style="--i: 0">
          <FileText size={13} aria-hidden="true" />
          {open.document ? `Document · ${ORIGIN_LABELS[open.document.origin] ?? open.document.origin} · revision ${open.document.revision}` : 'Document'}
        </p>
        <h2 class="doc-path" style="--i: 1">{open.path}</h2>
        {#if open.document}
          <p class="muted small origin" style="--i: 1">
            {#if open.document.originRef}<span class="mono">{open.document.originRef}</span> ·{/if}
            first written by {open.document.createdBy} on {when(open.document.createdAt)} ·
            <a href={resolve('/o/[org]/w/[ws]/documents/[...path]', { ...ws, path: open.path })}>open the document</a>
          </p>
        {/if}
        {#if open.entities.length}
          <p class="files" style="--i: 2">
            <span class="muted small">Files</span>
            {#each open.entities as entity (entity.id)}
              {@const standing = standingOf(entity)}
              <span class="filed">
                {@render code(entity.type)}
                <button type="button" class="linkish" onclick={() => onselect(entity.id)}>{entity.title}</button>
                <span class="docket-no">{entity.id}</span>
                <span class="stamp {standing.tone}">{standing.label}</span>
              </span>
            {/each}
          </p>
        {/if}

        <div style="--i: 3">
          <h3 class="label">Exhibits · {open.items.length}</h3>
          {#each open.items as item (item.key)}
            {@const note = typeof item.evidence.note === 'string' && item.evidence.note ? item.evidence.note : null}
            <div class="exhibit">
              <span class="ex">{exhibitLabel(item.key) ?? 'Ex.'}</span>
              <div class="quote">
                <p class:said={note !== null}>{note ?? item.location ?? 'Evidence on file'}</p>
                {#if item.link}
                  <p class="on small">on {item.entity.title} <span class="mono">{item.link.rel}</span> → {byId.get(item.link.target)?.title ?? item.link.target}</p>
                {:else if open.entities.length > 1}
                  <p class="on small">on {item.entity.title}</p>
                {/if}
                {#if note && item.location}<p class="loc">{item.location}</p>{/if}
                <p class="by">{byline(item.source, item.evidence)}</p>
              </div>
            </div>
          {:else}
            <p class="muted small">
              Nothing in this document is backed by evidence: its records and relations stand on the schema's default weight. File evidence from the
              Record's Capture form or an MCP client.
            </p>
          {/each}
        </div>

        {#if asserted.length}
          <div style="--i: 4">
            <h3 class="label">Relations it asserts · {asserted.length}</h3>
            <ul class="asserts">
              {#each asserted as { entity, link }, index (index)}
                <li>
                  {entity.title}
                  <span class="mono muted">{link.rel} →</span>
                  <button type="button" class="linkish" onclick={() => onselect(link.target)}>{byId.get(link.target)?.title ?? link.target}</button>
                  <span class="muted">· {plural(link.evidence?.length ?? 0, 'exhibit')}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div style="--i: 5">
          <h3 class="label">Amendments · {open.changes.length}</h3>
          {#if open.changes.length === 0}
            <p class="muted small">No amendments in the activity log's recent changes; a document import is not logged there.</p>
          {:else}
            <ol class="changes">
              {#each open.changes as change (change.id)}
                {@const touched = change.documents.find((document) => document.path === open.path)}
                <li>
                  <time class="mono muted" datetime={change.at}>{when(change.at)}</time>
                  <span>
                    <strong>{change.actorLabel}</strong>
                    {ACTION_LABELS[change.action] ?? change.action}
                    <span class="muted">via {CHANNEL_LABELS[change.channel] ?? change.channel}</span>
                    {#if touched}<span class="muted">· {touched.change}{#if touched.revision !== undefined}, revision {touched.revision}{/if}</span>{/if}
                    {#if change.evidenceCount}<span class="muted">· {plural(change.evidenceCount, 'exhibit')}</span>{/if}
                    {#if change.outcome !== 'ok'}<span class="stamp red">{change.outcome}</span>{/if}
                  </span>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      {/key}
    {:else}
      <div class="overview">
        <h2>Where the <em>exhibits</em> come from</h2>
        <p class="muted">
          {totals.held} of {all.length} documents hold evidence, {totals.items} pieces in all. Pick a document to read its exhibit trail: each exhibit
          with its source and location, and every amendment written to it.
        </p>
        {#if totals.bySource.length}
          <ul class="sources">
            {#each totals.bySource as [source, count] (source)}
              <li>
                <button type="button" class="badge" onclick={() => onfilter({ source })}>{source}</button>
                <span class="muted small">{plural(count, 'exhibit')}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .ex-grid {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    align-items: start;
    gap: 14px;
  }
  .list {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .filters {
    display: grid;
    gap: 8px;
  }
  .search {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 11px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--mute);
    font-weight: 400;
  }
  .search input {
    flex: 1;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: 13.5px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .row select {
    flex: 1;
    min-height: 36px;
    font-size: 13px;
  }
  .check {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    white-space: nowrap;
  }
  .filters .label {
    margin: 2px 0 0;
  }
  .doc-list {
    max-height: 72vh;
    margin: 0;
    padding: 5px;
    overflow-y: auto;
    list-style: none;
    border-radius: 12px;
    background: var(--paper);
    box-shadow: var(--shadow-1);
  }
  .doc {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 44px;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }
  .doc:hover {
    background: var(--sunk);
  }
  .doc[aria-current='true'] {
    background: var(--ink);
    color: var(--bg);
  }
  .path {
    display: grid;
    min-width: 0;
  }
  .name {
    font: 500 12.5px var(--font-mono);
    overflow-wrap: anywhere;
  }
  .folder,
  .meta {
    color: var(--mute);
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
  .folder {
    font-family: var(--font-mono);
  }
  .doc[aria-current='true'] .folder,
  .doc[aria-current='true'] .meta {
    color: inherit;
    opacity: 0.75;
  }
  .cnt {
    font: 500 10.5px var(--font-mono);
    color: var(--mute);
  }
  .doc[aria-current='true'] .cnt {
    color: inherit;
  }
  .cnt.none {
    color: var(--signal);
  }
  .code.ref {
    background: var(--mute);
  }
  .empty {
    margin: 0;
    padding: 4px 6px;
    font-size: 13px;
  }
  .detail {
    display: grid;
    gap: 16px;
    min-width: 0;
    padding: 20px 22px 24px;
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }
  .doc-path {
    margin: -8px 0 0;
    font: 500 18px/1.3 var(--font-mono);
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  .origin {
    margin: -10px 0 0;
  }
  .files {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 0;
  }
  .filed {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
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
  h3.label {
    margin: 0 0 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }
  .exhibit {
    display: grid;
    grid-template-columns: 4.6rem minmax(0, 1fr);
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid var(--rule);
  }
  h3 + .exhibit {
    border-top: 0;
  }
  .ex {
    align-self: start;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border-radius: 4px;
    background: var(--ink);
    color: var(--bg);
    font: 600 10.5px/1 var(--font-mono);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .quote {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding-left: 14px;
    border-left: 2px solid var(--rule-2);
  }
  .quote p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .quote p:first-child {
    font: 500 12.5px/1.5 var(--font-mono);
  }
  .quote p.said {
    font: italic 400 19px/1.35 var(--font-serif);
  }
  .on {
    color: var(--ink-2);
  }
  .loc {
    color: var(--ink-2);
    font: 11.5px/1.45 var(--font-mono);
  }
  .by {
    color: var(--mute);
    font-size: 12px;
  }
  .small {
    font-size: 12.5px;
  }
  p.small {
    margin: 0;
  }
  .asserts,
  .changes {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
  }
  .asserts li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .changes li {
    display: grid;
    grid-template-columns: 11rem minmax(0, 1fr);
    gap: 10px;
  }
  .changes time {
    font-size: 11.5px;
  }
  .overview h2 {
    margin: 0 0 8px;
  }
  .overview p {
    max-width: 60ch;
    margin: 0;
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }
  .sources li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sources .badge {
    cursor: pointer;
  }
  @media (max-width: 900px) {
    .ex-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .doc-list {
      max-height: 260px;
    }
    .detail {
      padding: 16px;
    }
    .changes li {
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
    }
  }
</style>
