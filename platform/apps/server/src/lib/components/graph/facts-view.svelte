<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { ArrowRight, ChevronDown, Search } from '@lucide/svelte'
  import { tick, untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  import { typeCode, weightClass } from '$lib/docket'
  import { bandsOf, type Exhibit, type FactFilter } from '$lib/graph/browse'
  import { basisLabel, type UiGraph } from '$lib/graph/model'
  import { bandPercent } from '$lib/trust/bands'
  import { filterNotes, railOf, sortNotes, type FactNote, type NoteSort } from '$lib/graph/notes'

  /**
   * The docket's findings of fact: every record and every relation written up
   * as a short note - a headline, what the document says, what its exhibits
   * say with each one cited inline - with its weight, standing and who filed
   * it. A note opens to quote its exhibits; an exhibit's chip opens it in
   * brief; "Case file" opens the record. The filters spot the strong facts,
   * those that need corroboration, and the single-source ones.
   */
  interface Props {
    graph: UiGraph
    /** Every fact in the docket written as a note, in docket order. */
    notes: FactNote[]
    filter: FactFilter
    /** Every exhibit in the docket by its key, with its label. */
    exhibits: ReadonlyMap<string, Exhibit & { label: string }>
    colourOf: (type: string) => string
    /** The note to open and bring into view. */
    open: string | null
    selected: string | null
    onfilter: (change: Partial<FactFilter>) => void
    onopen: (no: string | null) => void
    onselect: (id: string) => void
    /** Opens the Exhibits view on an exhibit's document. */
    onexhibit: (exhibit: Exhibit) => void
  }

  let { graph, notes: all, filter, exhibits, colourOf, open, selected, onfilter, onopen, onselect, onexhibit }: Props = $props()
  const bands = $derived(bandsOf(graph))

  const FLAGS = [
    ['all', 'All', 'Every record and every relation'],
    ['strong', 'Strong', "85% weight or more, from evidence rather than the ontology's default"],
    ['weak', 'Needs corroboration', "Under 50% weight, or nothing but the ontology's default behind it"],
  ] as const
  const SORTS: [NoteSort, string][] = [
    ['docket', 'Docket order'],
    ['strong', 'Strongest first'],
    ['weak', 'Weakest first'],
    ['exhibits', 'Most exhibits'],
    ['latest', 'Latest filed'],
  ]

  /** Notes drawn at first, and how many more each "Show more" adds. */
  const PAGE = 60

  let sort = $state<NoteSort>('docket')
  let limit = $state(PAGE)

  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))
  const types = $derived([...new Set(graph.entities.map((entity) => entity.type))].sort())
  const sources = $derived([...new Set(all.flatMap((note) => note.row.sources))].sort())
  // The spotting counts follow every other filter, so they say what the toggle would show.
  const unflagged = $derived(filterNotes(all, { ...filter, flag: 'all' }))
  const counts = $derived({
    all: unflagged.length,
    strong: unflagged.filter((note) => note.row.strong).length,
    weak: unflagged.filter((note) => note.row.weak).length,
  })
  const singles = $derived(filterNotes(all, { ...filter, single: true }).length)
  const notes = $derived(sortNotes(filterNotes(all, filter), sort))
  const narrowed = $derived(Boolean(filter.q || filter.type || filter.source || filter.kind !== 'all' || filter.confidence !== 'any' || filter.flag !== 'all' || filter.single || filter.about))
  const clear = () => onfilter({ q: '', type: '', source: '', kind: 'all', confidence: 'any', flag: 'all', single: false, about: '' })

  /** Notes read open: the one the address names, and any opened here. */
  const opened = new SvelteSet<string>()
  const isOpen = (no: string) => no === open || opened.has(no)
  /** The note last opened here, which is already in view. */
  let toggled: string | null = null
  const toggle = (no: string) => {
    if (isOpen(no)) {
      opened.delete(no)
      toggled = null
      if (open === no) onopen(null)
    } else {
      opened.add(no)
      toggled = no
      onopen(no)
    }
  }

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  // A note a link names is drawn, opened and brought into view, once.
  $effect(() => {
    const no = open
    if (!no) return
    if (no === toggled) {
      toggled = null
      return
    }
    untrack(() => {
      const at = notes.findIndex((note) => note.no === no)
      if (at < 0) return
      if (at >= limit) limit = at + 1
      void tick().then(() => document.getElementById(`note-${no}`)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }))
    })
  })

  const titleOf = (id: string) => byId.get(id)?.title ?? id
  const percent = (value: number) => `${Math.round(value * 100)}%`
  const day = (at: string | undefined, year = true) => {
    const date = at ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : at) : null
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
      : null
  }
  const noteOf = (exhibit: Exhibit) => (typeof exhibit.evidence.note === 'string' && exhibit.evidence.note.trim() ? exhibit.evidence.note.trim() : null)
  const byline = (exhibit: Exhibit) =>
    [exhibit.source ?? 'source not given', day(exhibit.at), typeof exhibit.evidence.observedBy === 'string' ? `by ${exhibit.evidence.observedBy}` : null]
      .filter(Boolean)
      .join(' · ')

  /** The exhibit an inline chip opened, in brief, beside the chip. */
  let brief = $state<HTMLElement>()
  let shown = $state<(Exhibit & { label: string }) | null>(null)
  let anchor: HTMLElement | null = null
  let place = $state({ top: 0, left: 0 })
  const showExhibit = async (key: string, event: MouseEvent) => {
    const exhibit = exhibits.get(key)
    if (!exhibit || !brief || !(event.currentTarget instanceof HTMLElement)) return
    anchor = event.currentTarget
    shown = exhibit
    await tick()
    brief.showPopover()
    stay()
    brief.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }
  /** Below the chip, or above it when the window has no room below; it follows the chip as the page scrolls. */
  const stay = () => {
    if (!brief || !anchor || !brief.matches(':popover-open')) return
    const rect = anchor.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = brief
    const below = rect.bottom + 8 + height <= window.innerHeight - 12
    place = {
      top: below ? rect.bottom + 8 : Math.max(12, rect.top - 8 - height),
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
    }
  }
  $effect(() => {
    // Any scroll moves the chip: the page's, or a panel's it sits in.
    document.addEventListener('scroll', stay, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', stay, { capture: true })
  })
  const hideExhibit = () => {
    if (brief?.matches(':popover-open')) brief.hidePopover()
  }
  const onBriefKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    // Escape closes the brief, not the case file behind it.
    event.preventDefault()
    hideExhibit()
    anchor?.focus({ preventScroll: true })
  }
  const fromBrief = (act: () => void) => {
    hideExhibit()
    act()
  }
</script>

{#snippet code(type: string | undefined)}
  {#if type}<span class="code" style="--c: {colourOf(type)}">{typeCode(type)}</span>{:else}<span class="code ref">REF</span>{/if}
{/snippet}

{#snippet chip(key: string)}
  {@const exhibit = exhibits.get(key)}
  {#if exhibit}
    <button type="button" class="ex" aria-haspopup="dialog" title="Exhibit {exhibit.label} in brief" onclick={(event) => showExhibit(key, event)}>{exhibit.label}</button>
  {/if}
{/snippet}

{#snippet prose(note: FactNote)}
  {#each note.paragraphs as paragraph, index (index)}
    <p class="prose">
      {#each paragraph as part, at (at)}{#if 'exhibit' in part}{@render chip(part.exhibit)}{:else if 'record' in part}<button
            type="button"
            class="linkish"
            class:missing={!byId.has(part.record)}
            onclick={() => onselect(part.record)}>{part.text}</button
          >{:else}{part.text}{/if}{/each}
    </p>
  {/each}
{/snippet}

<div class="facts" data-testid="facts">
  <div class="toolbar">
    <div class="seg" role="radiogroup" aria-label="Spot">
      {#each FLAGS as [flag, label, hint] (flag)}
        <button type="button" role="radio" aria-checked={filter.flag === flag} title={hint} onclick={() => onfilter({ flag })} data-testid={`flag-${flag}`}>
          {label} <span class="count">{counts[flag]}</span>
        </button>
      {/each}
    </div>
    <label class="search">
      <Search size={14} aria-hidden="true" />
      <span class="visually-hidden">Find in the notes</span>
      <input type="search" placeholder="Find in the notes…" value={filter.q} oninput={(event) => onfilter({ q: event.currentTarget.value })} />
    </label>
    <div class="fields">
      <button
        type="button"
        class="button small"
        aria-pressed={filter.single}
        title="One kind of source stands behind it, so nothing corroborates it"
        onclick={() => onfilter({ single: !filter.single })}
        data-testid="flag-single">Single-source <span class="count">{singles}</span></button
      >
      <select value={filter.kind} onchange={(event) => onfilter({ kind: event.currentTarget.value as FactFilter['kind'] })} aria-label="Kind">
        <option value="all">Records and relations</option>
        <option value="exhibit">Records</option>
        <option value="link">Relations</option>
      </select>
      <select value={filter.type} onchange={(event) => onfilter({ type: event.currentTarget.value })} aria-label="Type">
        <option value="">Every type</option>
        {#each types as name (name)}<option value={name}>{name.replaceAll('_', ' ')}</option>{/each}
      </select>
      <select value={filter.source} onchange={(event) => onfilter({ source: event.currentTarget.value })} aria-label="Source">
        <option value="">Every source</option>
        {#each sources as name (name)}<option value={name}>{name}</option>{/each}
      </select>
      <select value={filter.confidence} onchange={(event) => onfilter({ confidence: event.currentTarget.value as FactFilter['confidence'] })} aria-label="Weight">
        <option value="any">Any weight</option>
        <option value="high">High ({bandPercent('established', bands)})</option>
        <option value="medium">Medium ({bandPercent('probable', bands)})</option>
        <option value="low">Low ({bandPercent('unverified', bands)})</option>
        <option value="unevidenced">Unevidenced</option>
      </select>
      <select bind:value={sort} aria-label="Order">
        {#each SORTS as [key, label] (key)}<option value={key}>{label}</option>{/each}
      </select>
      {#if narrowed}<button type="button" class="button small" onclick={clear}>Clear</button>{/if}
    </div>
  </div>

  <p class="summary label" aria-live="polite" data-testid="facts-count">
    {notes.length} of {all.length} facts
    {#if filter.about}<span class="why"
        >· about <button type="button" class="linkish" onclick={() => onselect(filter.about)}>{titleOf(filter.about)}</button>
        <button type="button" class="linkish" onclick={() => onfilter({ about: '' })} data-testid="facts-about-clear">Show every record's</button></span
      >{/if}
    {#if filter.flag === 'strong'}<span class="why">· strong: 85% weight or more, from evidence</span>{/if}
    {#if filter.flag === 'weak'}<span class="why">· needs corroboration: under 50% weight, or nothing but the ontology's default behind it</span>{/if}
    {#if filter.single}<span class="why">· single-source: one kind of source stands behind it, so nothing corroborates it</span>{/if}
  </p>

  {#if notes.length === 0}
    <p class="empty muted card">{all.length === 0 ? 'No facts yet: import documents to see them here.' : 'No findings match these filters.'}</p>
  {:else}
    <div class="notes">
      {#each notes.slice(0, limit) as note, index (note.row.key)}
        {@const row = note.row}
        {@const target = row.link ? byId.get(row.link.target) : undefined}
        {@const expanded = isOpen(note.no)}
        <article
          class="card note {railOf(row)}"
          class:open={expanded}
          class:picked={row.entity.id === selected}
          id="note-{note.no}"
          style="--i: {Math.min(index, 12)}"
          aria-labelledby="note-{note.no}-title"
          data-testid="fact"
          data-kind={row.kind}
        >
          <div class="gut">
            <span class="docket-no">{note.no}</span>
            {#if row.lastObserved}<time class="fdate" datetime={row.lastObserved}>{day(row.lastObserved, false)}</time>{/if}
            {#if row.confidence !== undefined}
              <span class="weight {row.basis === 'unevidenced' ? 'low' : weightClass(row.confidence, bands)}" title="Weight of evidence, {row.basis ? basisLabel(row.basis) : 'assessed'}">
                <span class="bar"><i style="width: {row.confidence * 100}%"></i></span>{percent(row.confidence)}
              </span>
            {:else}
              <span class="fdate">not weighed</span>
            {/if}
          </div>
          <div class="body">
            <h3 id="note-{note.no}-title">{note.headline}</h3>
            {@render prose(note)}
            {#if note.exhibits.length}
              <div class="expand" id="note-{note.no}-exhibits" inert={!expanded}>
                <div>
                  <div class="quoted">
                    {#each note.exhibits as key (key)}
                      {@const exhibit = exhibits.get(key)}
                      {#if exhibit}
                        <div class="quote">
                          {@render chip(key)}
                          {#if noteOf(exhibit)}<q>{noteOf(exhibit)}</q>{:else}<span class="where mono">{exhibit.location || 'Evidence on file'}</span>{/if}
                          <span class="loc">{[noteOf(exhibit) ? exhibit.location : '', byline(exhibit)].filter(Boolean).join(' · ')}</span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                </div>
              </div>
            {/if}
            <div class="foot">
              <span class="stamp {note.standing.tone}">{note.standing.label}</span>
              <span class="re">
                Re {@render code(row.entity.type)}
                <button type="button" class="linkish" onclick={() => onselect(row.entity.id)}>{row.entity.title}</button>
                {#if row.link}
                  <ArrowRight size={12} aria-hidden="true" />
                  {@render code(target?.type)}
                  <button type="button" class="linkish" onclick={() => row.link && onselect(row.link.target)}>{titleOf(row.link.target)}</button>
                {/if}
                {#if !row.link}<span class="mono muted id">{row.entity.id}</span>{/if}
              </span>
              {#if note.filedBy}<span class="by">filed by {note.filedBy}</span>{/if}
              <span class="grow"></span>
              <span class="tools">
                {#if note.exhibits.length}
                  <button type="button" class="button small ghost" aria-expanded={expanded} aria-controls="note-{note.no}-exhibits" onclick={() => toggle(note.no)}>
                    {expanded ? 'Hide' : 'Read'}
                    {note.exhibits.length}
                    {note.exhibits.length === 1 ? 'exhibit' : 'exhibits'}
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                {/if}
                <button type="button" class="button small ghost" onclick={() => onselect(row.entity.id)}>Case file</button>
              </span>
            </div>
          </div>
        </article>
      {/each}
    </div>
    {#if notes.length > limit}
      <button type="button" class="button more" onclick={() => (limit += PAGE)}>Show {Math.min(PAGE, notes.length - limit)} more of {notes.length - limit}</button>
    {/if}
  {/if}
</div>

<svelte:window onresize={stay} />

<div
  class="brief"
  popover="auto"
  role="dialog"
  tabindex="-1"
  aria-label={shown ? `Exhibit ${shown.label}` : 'Exhibit'}
  bind:this={brief}
  style="top: {place.top}px; left: {place.left}px"
  onkeydown={onBriefKey}
  data-testid="exhibit-brief"
>
  {#if shown}
    {@const exhibit = shown}
    <div class="meta-row"><span class="ex static">{exhibit.label}</span><span class="label">{byline(exhibit)}</span></div>
    {#if noteOf(exhibit)}<q>{noteOf(exhibit)}</q>{/if}
    {#if exhibit.location}<div class="mono muted small where">{exhibit.location}</div>{/if}
    {#if exhibit.link}<div class="muted small">On {exhibit.link.rel} → {titleOf(exhibit.link.target)}</div>{/if}
    <div class="actions">
      <button type="button" class="button small" onclick={() => fromBrief(() => onselect(exhibit.entity.id))}>
        {@render code(exhibit.entity.type)}
        {exhibit.entity.title}
      </button>
      <button type="button" class="button small ghost" onclick={() => fromBrief(() => onexhibit(exhibit))}>Open exhibit <ArrowRight size={14} aria-hidden="true" /></button>
    </div>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    margin-bottom: 10px;
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
  .search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 14rem;
    max-width: 22rem;
    color: var(--mute);
  }
  .search :global(svg) {
    position: absolute;
    left: 10px;
  }
  .search input {
    width: 100%;
    height: 38px;
    padding-left: 32px;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .fields select {
    max-width: 13rem;
    height: 38px;
    font-size: 13px;
  }
  .summary {
    margin: 0 0 12px;
  }
  .summary .why {
    text-transform: none;
    letter-spacing: 0;
  }
  .empty {
    padding: 22px 24px;
  }

  /* A finding of fact: a gutter with its number, date and weight, then the note, on a rail coloured by its weight. */
  .notes {
    display: grid;
    gap: 14px;
  }
  .note {
    position: relative;
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 0 22px;
    padding: 22px 24px 18px;
    animation: rise 0.5s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 45ms);
    transition:
      box-shadow 0.25s,
      transform 0.25s var(--ease-out);
  }
  .note:hover {
    box-shadow: var(--shadow-2);
  }
  .note::before {
    content: '';
    position: absolute;
    top: 18px;
    bottom: 18px;
    left: 0;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--rule-2);
    transition: background 0.3s;
  }
  .note.low::before {
    background: var(--signal);
  }
  .note.mid::before {
    background: var(--warn);
  }
  .note.high::before {
    background: var(--ok);
  }
  .note.picked {
    box-shadow:
      var(--shadow-1),
      0 0 0 2px color-mix(in oklab, var(--signal) 35%, transparent);
  }
  .gut {
    display: grid;
    align-content: start;
    gap: 6px;
  }
  .fdate {
    color: var(--mute);
    font: 11.5px var(--font-mono);
  }
  .gut .weight .bar {
    width: 48px;
  }
  .body {
    min-width: 0;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 26px;
    line-height: 1.12;
    overflow-wrap: anywhere;
  }
  .prose {
    max-width: 72ch;
    margin: 0;
    color: var(--ink-2);
    font-size: 15.5px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  .prose + .prose {
    margin-top: 8px;
  }
  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
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
  .linkish.missing {
    color: var(--mute);
    text-decoration-style: dashed;
  }
  .ex {
    display: inline-flex;
    align-items: center;
    height: 19px;
    margin: 0 1px;
    padding: 0 6px;
    border: 0;
    border-radius: 4px;
    background: var(--ink);
    color: var(--bg);
    font: 600 10.5px/1 var(--font-mono);
    letter-spacing: 0.04em;
    vertical-align: 1px;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s,
      box-shadow 0.15s;
  }
  button.ex:hover {
    background: var(--signal);
    color: var(--signal-ink);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--signal) 22%, transparent);
  }
  .ex.static {
    cursor: default;
  }

  /* "Read N exhibits" opens the quoted exhibits in place. */
  .expand {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.4s var(--ease-io);
  }
  .note.open .expand {
    grid-template-rows: 1fr;
  }
  .expand > div {
    overflow: hidden;
  }
  .quoted {
    display: grid;
    gap: 8px;
    margin-top: 14px;
  }
  .quote {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--rule);
  }
  .quote .ex {
    align-self: start;
    margin-top: 2px;
  }
  q {
    font: italic 400 17px/1.4 var(--font-serif);
    quotes: '\201C' '\201D';
  }
  .where {
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }
  .loc {
    grid-column: 2;
    color: var(--mute);
    font: 11.5px var(--font-mono);
    overflow-wrap: anywhere;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed var(--rule);
    color: var(--mute);
    font-size: 12.5px;
  }
  .re {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .re .id {
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .grow {
    flex: 1;
  }
  .tools {
    display: flex;
    gap: 8px;
  }
  .ghost {
    background: transparent;
  }
  .tools :global(svg) {
    transition: transform 0.3s var(--ease-io);
  }
  .tools [aria-expanded='true'] :global(svg) {
    transform: rotate(180deg);
  }
  .more {
    justify-self: center;
    margin: 16px auto 0;
    display: flex;
  }
  .code.ref {
    background: var(--mute);
  }

  /* An exhibit in brief, beside the chip that opened it. */
  .brief {
    position: fixed;
    inset: auto;
    width: min(360px, calc(100vw - 24px));
    margin: 0;
    padding: 14px 16px;
    border: 0;
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-2);
  }
  .brief:popover-open {
    animation: rise 0.25s var(--ease-out);
  }
  .brief .meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .brief q {
    display: block;
    font-size: 18px;
  }
  .brief .where {
    margin: 8px 0 0;
  }
  .brief .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .small {
    font-size: 12.5px;
  }

  @media (max-width: 900px) {
    .note {
      grid-template-columns: minmax(0, 1fr);
      padding: 18px 18px 14px;
    }
    .gut {
      grid-auto-flow: column;
      justify-content: start;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    h3 {
      font-size: 23px;
    }
    .search {
      max-width: none;
    }
    .fields select {
      flex: 1 1 9rem;
      max-width: none;
    }
  }
</style>
