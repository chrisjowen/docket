<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowDown } from '@lucide/svelte'

  import { CHANNEL_LABELS } from '$lib/activity'
  import { typeCode } from '$lib/docket'
  import { SHEET_KINDS, docketSheet, supersessions, timelineOf, type ActivityEntry, type TimelineKind } from '$lib/graph/browse'
  import { evidenceLocation, type UiGraph } from '$lib/graph/model'
  import { docketText } from '$lib/graph/sheet'

  /**
   * The docket sheet: everything dated, as a numbered court-style table,
   * newest first with a divider for each month. Rulings and events are the
   * dates documents record, exhibits filed are when evidence was seen, and
   * amendments are writes the activity log recorded. Beside it, what
   * overrules what.
   */
  interface Props {
    graph: UiGraph
    activity: ActivityEntry[]
    show: 'all' | TimelineKind
    selected: string | null
    org: string
    colourOf: (type: string) => string
    /** An exhibit's label by its key. */
    exhibitLabel: (key: string) => string | undefined
    onshow: (show: 'all' | TimelineKind) => void
    onselect: (id: string) => void
  }

  let { graph, activity, show, selected, org, colourOf, exhibitLabel, onshow, onselect }: Props = $props()

  /** Entries drawn at once. */
  const ROWS = 400

  const KINDS = [
    ['all', 'All entries'],
    ['decision', 'Rulings'],
    ['event', 'Events'],
    ['observed', 'Exhibits filed'],
    ['change', 'Amendments'],
  ] as const

  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))
  const all = $derived(docketSheet(timelineOf(graph, activity)))
  const counts = $derived(
    Object.fromEntries(KINDS.map(([kind]) => [kind, kind === 'all' ? all.length : all.filter((entry) => entry.kind === kind).length])) as Record<
      (typeof KINDS)[number][0],
      number
    >,
  )
  const rows = $derived(all.filter((entry) => show === 'all' || entry.kind === show))
  const chains = $derived(supersessions(graph.edges))

  const parse = (at: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : at)
  const month = (day: string) => parse(day).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()
  /** The court's date, 11/13/2026. */
  const filed = (day: string) => {
    const [year, mm, dd] = day.split('-')
    return year && mm && dd ? `${mm}/${dd}/${year}` : day
  }
  /** A time of day, when the value carries one. */
  const timeOf = (at: string): string | null => {
    if (!/T\d{2}:\d{2}/.test(at) || /T00:00:00(\.0+)?Z$/.test(at)) return null
    const date = new Date(at)
    return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  /** The exhibit an entry files: its key without the date field. */
  const exhibitOf = (key: string) => exhibitLabel(key.replace(/:(observedAt|eventAt)$/, ''))
</script>

{#snippet record(id: string)}
  {@const entity = byId.get(id)}
  {#if entity}<span class="code" style="--c: {colourOf(entity.type)}">{typeCode(entity.type)}</span>{:else}<span class="code ref">REF</span>{/if}
  <button type="button" class="linkish" class:picked={id === selected} onclick={() => onselect(id)}>{entity?.title ?? id}</button>
{/snippet}

<div class="docket-sheet" data-testid="timeline">
  <div class="toolbar">
    <div class="seg" role="radiogroup" aria-label="Show">
      {#each KINDS as [kind, label] (kind)}
        <button type="button" role="radio" aria-checked={show === kind} onclick={() => onshow(kind)} data-testid={`show-${kind}`}>
          {label} <span class="count">{counts[kind]}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="sheet-grid">
    <div class="table-card">
      <table class="sheet">
        <thead>
          <tr><th class="label" scope="col">No.</th><th class="label" scope="col">Filed</th><th class="label" scope="col">Docket text</th></tr>
        </thead>
        <tbody>
          {#each rows.slice(0, ROWS) as entry, index (entry.key)}
            {@const time = timeOf(entry.at)}
            {@const label = entry.kind === 'observed' ? exhibitOf(entry.key) : undefined}
            {#if index === 0 || month(rows[index - 1]?.day ?? '') !== month(entry.day)}
              <tr class="month"><td colspan="3">{month(entry.day)}</td></tr>
            {/if}
            <tr data-kind={entry.kind} data-testid="timeline-entry" style="--i: {Math.min(index, 20)}">
              <td class="n">#{String(entry.no).padStart(3, '0')}</td>
              <td class="d"><time datetime={entry.day}>{filed(entry.day)}</time>{#if time}<br /><span class="muted">{time}</span>{/if}</td>
              <td class="entry">
                <b class="kind {entry.kind}">{SHEET_KINDS[entry.kind].toUpperCase()}</b> —
                {#if label}<span class="ex">{label}</span>{/if}
                {docketText(entry)}
                {#if entry.entity}
                  Re {@render record(entry.entity.id)} <span class="mono muted">{entry.entity.id}</span>
                {:else if entry.change?.resourceId}
                  Re <span class="mono">{entry.change.resourceId}</span>
                {/if}
                {#if entry.link}
                  <span class="muted on">on <span class="mono">{entry.link.rel}</span> → {@render record(entry.link.target)}</span>
                {/if}
                {#if entry.evidence && typeof entry.evidence.note === 'string' && evidenceLocation(entry.evidence)}
                  <span class="loc">{evidenceLocation(entry.evidence)}</span>
                {/if}
                <span class="by">
                  {#if entry.change}
                    Entered by {entry.change.actorLabel} via {CHANNEL_LABELS[entry.change.channel] ?? entry.change.channel}
                    {#if entry.change.outcome !== 'ok'}· <span class="stamp red">{entry.change.outcome}</span>{/if}
                    · <a href="{resolve('/o/[org]/audit', { org })}?request={encodeURIComponent(entry.change.requestId)}">audit event</a>
                  {:else if entry.evidence}
                    Entered{typeof entry.evidence.observedBy === 'string' ? ` by ${entry.evidence.observedBy}` : ''}{typeof entry.evidence.source === 'string' ? ` via ${entry.evidence.source}` : ''}
                  {:else}
                    Dated by the document's <span class="mono">{entry.field}</span>
                  {/if}
                </span>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="3" class="none muted">
                {#if all.length === 0}
                  Nothing is dated yet. Dated attributes, evidence with <code class="mono">eventAt</code> or <code class="mono">observedAt</code>, and writes from MCP
                  clients, the capture forms, the CLI and repo syncs are entered here.
                {:else}
                  No entries of this kind.
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if rows.length > ROWS}<p class="muted more">Showing the latest {ROWS} entries of {rows.length}.</p>{/if}
    </div>

    <div class="side reveal">
      <section class="card" style="--i: 1" aria-labelledby="overruled-title">
        <h2 id="overruled-title">Overruled</h2>
        {#if chains.length === 0}
          <p class="muted small">Nothing on the record overrules anything else yet.</p>
        {:else}
          <ol class="chains">
            {#each chains as chain (chain.join('>'))}
              <li class="chain" data-testid="supersession">
                {#each chain as id, index (id)}
                  {#if index > 0}<span class="label down"><ArrowDown size={12} aria-hidden="true" /> overrules</span>{/if}
                  <span class="link-row" class:old={index > 0}>
                    {@render record(id)}
                    {#if index === 0}<span class="stamp ok">In force</span>{:else}<span class="stamp red">Overruled</span>{/if}
                  </span>
                {/each}
              </li>
            {/each}
          </ol>
        {/if}
      </section>
      <section class="card" style="--i: 2">
        <h3>How entries are dated</h3>
        <p class="muted small">
          Dates come from the documents themselves and their evidence (<code class="mono">eventAt</code>, <code class="mono">observedAt</code>);
          amendments come from the activity log. Nothing is dated by when a file was written.
        </p>
      </section>
    </div>
  </div>
</div>

<style>
  .toolbar {
    margin-bottom: 14px;
  }
  .seg {
    display: inline-flex;
    gap: 2px;
    max-width: 100%;
    padding: 3px;
    overflow-x: auto;
    border-radius: 9px;
    background: var(--sunk);
    scrollbar-width: none;
  }
  .seg button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 11px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--mute);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s;
  }
  .seg button:hover {
    color: var(--ink);
  }
  .seg button[aria-checked='true'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.08),
      0 0 0 1px var(--rule);
  }
  .count {
    color: var(--mute);
    font: 500 10.5px var(--font-mono);
  }
  .sheet-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 290px;
    align-items: start;
    gap: 14px;
  }
  .table-card {
    overflow: hidden;
    border-radius: 12px;
    background: var(--paper);
    box-shadow: var(--shadow-1);
  }
  .sheet {
    width: 100%;
    border-collapse: collapse;
  }
  .sheet th {
    padding: 10px 14px;
    border-bottom: 1px solid var(--rule);
    background: var(--sunk);
    text-align: left;
  }
  .sheet td {
    padding: 13px 14px;
    border-bottom: 1px solid var(--rule);
    font-size: 14px;
    vertical-align: top;
  }
  .sheet tbody tr {
    animation: rise 0.45s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 35ms);
  }
  .sheet tr:last-child td {
    border-bottom: 0;
  }
  .n {
    width: 52px;
    color: var(--mute);
    font: 500 12px var(--font-mono);
  }
  .d {
    width: 112px;
    font: 12px/1.5 var(--font-mono);
    white-space: nowrap;
  }
  .entry {
    overflow-wrap: anywhere;
  }
  .kind {
    font: 600 11px var(--font-mono);
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
  .ex {
    display: inline-flex;
    align-items: center;
    height: 19px;
    margin: 0 2px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--ink);
    color: var(--bg);
    font: 600 10.5px/1 var(--font-mono);
    letter-spacing: 0.04em;
    vertical-align: 1px;
    white-space: nowrap;
  }
  .code {
    vertical-align: 1px;
  }
  .code.ref {
    background: var(--mute);
  }
  .linkish {
    display: inline;
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
  .linkish:hover,
  .linkish.picked {
    text-decoration-color: var(--signal);
  }
  .on,
  .loc,
  .by {
    display: block;
    margin-top: 3px;
    font-size: 12px;
  }
  .loc {
    color: var(--ink-2);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .by {
    color: var(--mute);
  }
  .month td {
    position: sticky;
    top: 50px;
    z-index: 2;
    padding: 7px 14px;
    background: color-mix(in oklab, var(--paper) 92%, transparent);
    backdrop-filter: blur(6px);
    color: var(--mute);
    font: 600 10.5px var(--font-mono);
    letter-spacing: 0.1em;
  }
  .none {
    padding: 22px 14px;
  }
  .more {
    margin: 0;
    padding: 10px 14px;
    border-top: 1px solid var(--rule);
    font-size: 12.5px;
  }
  .side {
    display: grid;
    gap: 14px;
  }
  .side .card {
    padding: 18px 20px;
  }
  .side h2 {
    margin: 0 0 12px;
    font-size: 26px;
  }
  .side h3 {
    margin: 0 0 8px;
    font: 600 14px/1.3 var(--font-sans);
  }
  .small {
    margin: 0;
    font-size: 12.5px;
  }
  .chains {
    display: grid;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chain {
    display: grid;
    gap: 8px;
  }
  .link-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .old .linkish {
    color: var(--mute);
    text-decoration: line-through;
    text-decoration-color: var(--signal);
  }
  .down {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  @media (max-width: 1100px) {
    .sheet-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 900px) {
    .sheet thead {
      display: none;
    }
    .sheet tr:not(.month) {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 2px 12px;
      padding: 11px 14px;
      border-bottom: 1px solid var(--rule);
    }
    .sheet td {
      width: auto;
      padding: 0;
      border: 0;
    }
    .sheet .entry,
    .sheet .none {
      grid-column: 1 / -1;
    }
    /* Every entry carries its date: no dividers on a phone. */
    .sheet tr.month {
      display: none;
    }
  }
</style>
