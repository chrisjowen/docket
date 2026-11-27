<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { Explained } from '@docket/platform-canonical-store'
  import { AlertCircle, GitPullRequestArrow, X } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  import Why from '$lib/components/trust/why.svelte'
  import { typeCode } from '$lib/docket'
  import type { Exhibit, SheetEntry } from '$lib/graph/browse'
  import { SHEET_KINDS } from '$lib/graph/browse'
  import { basisLabel, linksOf, summaryOf, supersededOf, supersedesOf, type UiEntity, type UiGraph } from '$lib/graph/model'
  import { railOf, type FactNote } from '$lib/graph/notes'
  import { docketText } from '$lib/graph/sheet'
  import { recordBand, sourcesOf, standingOf, weightOf } from '$lib/graph/standing'
  import { BAND_LABELS, BAND_STAMP, type Band } from '$lib/trust/bands'

  import Value from './value.svelte'

  /**
   * A record's case file, as the record drawer shows it: what it is, where it
   * stands, then its summary and notes, the findings about it, its facts,
   * the records it links to, its exhibits and the docket entries about it.
   */
  interface Props {
    graph: UiGraph
    /** The record; undefined for a reference no document files. */
    entity: UiEntity | undefined
    id: string
    colourOf: (type: string) => string
    /** Every exhibit in the docket by its key, with its label. */
    exhibits: ReadonlyMap<string, Exhibit & { label: string }>
    /** Docket entries about it, once the activity log has loaded. */
    entries: SheetEntry[] | null
    /** The findings about it: its own, its relations' and those pointing at it. */
    findings: FactNote[]
    /** Opens a finding's note on the Facts view. */
    onfinding: (no: string) => void
    /** Opens the Facts view on every finding about it. */
    onfindings: () => void
    onselect: (id: string) => void
    onclose: () => void
    /** Opens the Exhibits view on an exhibit's document. */
    onexhibit?: (exhibit: Exhibit) => void
    /** Controls under the header, like "Show in the network". */
    actions?: Snippet
    /** Whether the reader may open the schema editor, for the policy chips in "Why". */
    canEditSchema?: boolean
  }

  let { graph, entity, id, colourOf, exhibits, entries, findings, onfinding, onfindings, onselect, onclose, onexhibit, actions, canEditSchema = false }: Props = $props()

  /** What the cloud carries about a record's trust beside docket's own view: its pending proposals. */
  interface Pending {
    proposal: string
    by: string
    score: number
    threshold: number
    stale: boolean
  }
  type Trusted = { trust?: { band?: Band; pending?: Pending; proposes?: (Pending & { replaces: string })[] } }

  /** Findings listed here; the rest are a click away on the Facts view. */
  const FINDINGS_SHOWN = 6

  const byId = $derived(new Map(graph.entities.map((item) => [item.id, item])))
  const links = $derived(linksOf(graph, id))
  const standing = $derived(standingOf(entity))
  const weight = $derived(entity ? weightOf(entity) : null)
  const band = $derived(entity ? (recordBand(entity) as Band | undefined) : undefined)
  const trust = $derived((entity as (UiEntity & Trusted) | undefined)?.trust)
  const sources = $derived(entity ? sourcesOf(entity) : [])
  const ws = $derived({ org: page.params.org ?? '', ws: page.params.ws ?? '' })

  /** "Why 0.93": asked for when the record opens, and again when its evidence changes. */
  let why = $state<{ id: string; explained: Explained | null; failed: boolean } | null>(null)
  const evidenceKey = $derived(entity ? `${entity.id}:${weight}:${entity.evidence.length}` : null)
  $effect(() => {
    const key = evidenceKey
    const record = entity?.id
    if (!key || !record) return
    const controller = new AbortController()
    fetch(`${resolve('/o/[org]/w/[ws]/graph/explain', ws)}?id=${encodeURIComponent(record)}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as { explained: Explained }).explained : Promise.reject(new Error(String(response.status)))))
      .then((explained) => (why = { id: record, explained, failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) why = { id: record, explained: null, failed: true }
      })
    return () => controller.abort()
  })
  const explained = $derived(why && why.id === entity?.id ? why.explained : null)
  const summary = $derived(entity ? summaryOf(entity) : null)
  const superseded = $derived(entity ? supersededOf(entity) : null)
  const supersedes = $derived(entity ? supersedesOf(entity) : [])
  /** The document's body as paragraphs: a heading that repeats the title goes, and a paragraph's hard line breaks join up. */
  const notes = $derived(
    (entity?.content ?? '')
      .trim()
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
      .filter((paragraph, index) => paragraph && !(index === 0 && paragraph.replace(/^#+\s*/, '') === entity?.title)),
  )
  const attributes = $derived(entity ? Object.entries(entity.attributes) : [])
  const filed = $derived(
    entity
      ? [
          ...entity.evidence.map((_, index) => exhibits.get(`${entity.id}#${index}`)),
          ...entity.links.flatMap((link, linkIndex) => (link.evidence ?? []).map((_, index) => exhibits.get(`${entity.id}>${linkIndex}#${index}`))),
        ].filter((exhibit) => exhibit !== undefined)
      : [],
  )
  const titleOf = (other: string) => byId.get(other)?.title ?? other
  const percent = (value: number) => `${Math.round(value * 100)}%`
  const day = (at: string | undefined) => {
    const date = at ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : at) : null
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null
  }
  /** A link below the workspace's Probable band, as the graph scored it. */
  const linkWeak = (edge: object) => (edge as { band?: Band }).band === 'unverified'
</script>

{#snippet code(type: string | undefined)}
  {#if type}<span class="code" style="--c: {colourOf(type)}">{typeCode(type)}</span>{:else}<span class="code ref">REF</span>{/if}
{/snippet}

{#snippet record(other: string)}
  <button type="button" class="linkish" onclick={() => onselect(other)}>{titleOf(other)}</button>
{/snippet}

<article class="case-file" data-testid="inspector" aria-labelledby="case-file-title">
  <header>
    <button type="button" class="close" onclick={onclose} aria-label="Close the case file" aria-keyshortcuts="Escape" data-testid="case-file-close"><X size={18} aria-hidden="true" /></button>
    <div class="meta-row">
      {@render code(entity?.type)}
      <span class="docket-no">{id}</span>
      {#if entity}<span class="tag">{entity.type.replaceAll('_', ' ')} · <span class="mono">{entity.path}</span></span>{/if}
    </div>
    <h2 id="case-file-title">{entity?.title ?? id}</h2>
    <div class="meta-row">
      {#if weight !== null && band}
        <span class="score" title="Confidence{entity?.assessment ? `, ${basisLabel(entity.assessment.basis)}` : ''}" data-testid="confidence">{weight.toFixed(2)}</span>
        <span class="stamp {BAND_STAMP[band]}" data-testid="band">{BAND_LABELS[band]}</span>
      {/if}
      <span class="stamp {standing.tone}" data-testid="standing">{standing.label}</span>
      {#if trust?.pending}<span class="stamp pending" data-testid="pending">Pending</span>{/if}
    </div>
  </header>

  <div class="body">
    {#if !entity}
      <div class="notice" style="--i: 0">
        <AlertCircle size={16} aria-hidden="true" />
        <span>Not on record: a relation names <code>{id}</code>, but no document in the docket files it yet.</span>
      </div>
    {/if}
    {#if superseded}
      <div class="notice" style="--i: 1" data-testid="superseded">
        <AlertCircle size={16} aria-hidden="true" />
        <span>
          Overruled{superseded.until ? ` since ${superseded.until}` : ''} by {@render record(superseded.current)}{#if superseded.current !== superseded.by}<span class="muted"> (by way of {titleOf(superseded.by)})</span>{/if}.
          {#if superseded.reason}{superseded.reason}{/if}
          Its relations stay on the record for history; search answers with the current record.
        </span>
      </div>
    {:else if entity && standing.key === 'uncorroborated'}
      <div class="notice warn" style="--i: 1">
        <AlertCircle size={16} aria-hidden="true" />
        <span>Uncorroborated: {filed.length ? `${weight !== null ? `${percent(weight)} weight` : 'little weight'}, from ${sources.join(', ') || 'one source'}` : 'no exhibits on file'}. File evidence before relying on it.</span>
      </div>
    {/if}
    {#if trust?.pending}
      <div class="notice info" style="--i: 1" data-testid="pending-notice">
        <GitPullRequestArrow size={16} aria-hidden="true" />
        <span>
          {@render record(trust.pending.by)} proposes to replace it: its evidence scores <b class="mono">{trust.pending.score.toFixed(2)}</b> of the <b class="mono">{trust.pending.threshold.toFixed(2)}</b> it needs{trust.pending.stale ? ', and the record has changed since' : ''}. Until it is proven, this record stands.
          <a href={resolve('/o/[org]/w/[ws]/proposals/[id]', { ...ws, id: trust.pending.proposal })}>Review the proposal</a>
        </span>
      </div>
    {/if}
    {#each trust?.proposes ?? [] as proposes (proposes.proposal)}
      <div class="notice info" style="--i: 1" data-testid="proposes-notice">
        <GitPullRequestArrow size={16} aria-hidden="true" />
        <span>
          Proposes to replace {@render record(proposes.replaces)}: <b class="mono">{proposes.score.toFixed(2)}</b> of <b class="mono">{proposes.threshold.toFixed(2)}</b> so far.
          <a href={resolve('/o/[org]/w/[ws]/proposals/[id]', { ...ws, id: proposes.proposal })}>Review the proposal</a>
        </span>
      </div>
    {/each}
    {#if summary}<p class="summary" style="--i: 1" data-testid="summary">{summary}</p>{/if}
    {#if supersedes.length > 0}
      <p class="replaces" style="--i: 1" data-testid="supersedes">
        Overrules {#each supersedes as older, index (older)}{index > 0 ? ', ' : ''}{@render record(older)}{/each}.
      </p>
    {/if}
    {#if actions}<div class="actions" style="--i: 2">{@render actions()}</div>{/if}

    {#if entity}
      <section style="--i: 2" data-testid="notes" aria-labelledby="case-notes">
        <h3 class="label" id="case-notes"><span>Notes</span></h3>
        {#if notes.length}{#each notes as paragraph, index (index)}<p class="prose">{paragraph.replace(/^#+\s*/, '')}</p>{/each}{:else}<p class="muted small">No notes yet: the document has no body.</p>{/if}
      </section>

      {#if findings.length}
        <section style="--i: 3" aria-labelledby="case-findings" data-testid="case-findings">
          <h3 class="label" id="case-findings"><span>Findings</span><span>{findings.length}</span></h3>
          <div class="findings">
            {#each findings.slice(0, FINDINGS_SHOWN) as finding (finding.no)}
              <button type="button" class="finding {railOf(finding.row)}" onclick={() => onfinding(finding.no)}>
                <span class="docket-no">{finding.no}</span>
                <b>{finding.headline}</b>
                {#if finding.row.confidence !== undefined}
                  <span class="weight {railOf(finding.row)}"><span class="bar"><i style="width: {finding.row.confidence * 100}%"></i></span>{percent(finding.row.confidence)}</span>
                {/if}
              </button>
            {/each}
          </div>
          {#if findings.length > FINDINGS_SHOWN}
            <button type="button" class="linkish more" onclick={onfindings}>{findings.length - FINDINGS_SHOWN} more in Facts</button>
          {/if}
        </section>
      {/if}

      <section style="--i: 3" aria-labelledby="case-why" data-testid="evidence">
        <h3 class="label" id="case-why"><span>Why {weight !== null ? weight.toFixed(2) : ''}</span><span>{sources.length} source{sources.length === 1 ? '' : 's'}</span></h3>
        {#if explained}
          <Why {explained} scored={false} policiesUrl={canEditSchema ? `${resolve('/o/[org]/w/[ws]/ontology', ws)}?tab=policies` : null} />
        {:else if why?.failed && why.id === entity.id}
          <p class="muted small">Could not explain the confidence just now.</p>
        {:else}
          <p class="muted small">Explaining the confidence…</p>
        {/if}
      </section>

      <section style="--i: 3" aria-labelledby="case-facts">
        <h3 class="label" id="case-facts"><span>Facts</span><span>{attributes.length}</span></h3>
        {#if attributes.length}
          <table class="kv">
            <tbody>
              {#each attributes as [key, value] (key)}
                <tr>
                  <th scope="row">{key}</th>
                  <td>{#if typeof value === 'string' && byId.has(value)}{@render record(value)}{:else}<Value {value} />{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="muted small">No facts recorded.</p>
        {/if}
      </section>
    {/if}

    <section style="--i: 4" aria-labelledby="case-linked" data-testid="linked-records">
      <h3 class="label" id="case-linked"><span>Linked records</span><span>{links.outgoing.length + links.incoming.length}</span></h3>
      {#if links.outgoing.length + links.incoming.length === 0}
        <p class="muted small">No relations on file.</p>
      {:else}
        <ul class="rel-list">
          {#each links.outgoing as edge, index (`out${index}`)}
            {@const target = byId.get(edge.target)}
            <li>
              <span class="rel">{edge.rel} →</span>
              {@render code(target?.type)}
              {@render record(edge.target)}
              {#if !target}<span class="stamp red">Not on record</span>{:else if linkWeak(edge)}<span class="stamp red">Uncorroborated</span>{/if}
            </li>
          {/each}
          {#each links.incoming as edge, index (`in${index}`)}
            {@const source = byId.get(edge.source)}
            <li>
              {@render code(source?.type)}
              {@render record(edge.source)}
              <span class="rel">→ {edge.rel}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if entity}
      <section style="--i: 5" aria-labelledby="case-exhibits" data-testid="case-exhibits">
        <h3 class="label" id="case-exhibits"><span>Exhibits</span><span>{filed.length}</span></h3>
        {#each filed as exhibit (exhibit.key)}
          <div class="exhibit">
            <button type="button" class="ex" onclick={() => onexhibit?.(exhibit)} title="Open in Exhibits">{exhibit.label}</button>
            <span class="ex-note">
              {typeof exhibit.evidence.note === 'string' && exhibit.evidence.note ? exhibit.evidence.note : exhibit.location || 'Evidence on file'}
              {#if exhibit.link}<span class="muted small"> · on {exhibit.link.rel} → {titleOf(exhibit.link.target)}</span>{/if}
            </span>
            {#if exhibit.location && typeof exhibit.evidence.note === 'string' && exhibit.evidence.note}<span class="loc">{exhibit.location}</span>{/if}
            <span class="by">{`${exhibit.source ?? 'source not given'}${day(exhibit.at) ? ` · filed ${day(exhibit.at)}` : ''}${typeof exhibit.evidence.observedBy === 'string' ? ` by ${exhibit.evidence.observedBy}` : ''}`}</span>
          </div>
        {:else}
          <p class="muted small">No exhibits: nothing records where this was seen.</p>
        {/each}
      </section>

      {#if entries && entries.length > 0}
        <section style="--i: 6" aria-labelledby="case-entries">
          <h3 class="label" id="case-entries"><span>Docket entries</span><span>{entries.length}</span></h3>
          {#each entries.slice(0, 12) as entry (entry.key)}
            <div class="exhibit">
              <span class="mono muted">#{String(entry.no).padStart(3, '0')}</span>
              <span><b class="kind {entry.kind}">{SHEET_KINDS[entry.kind].toUpperCase()}</b> — {docketText(entry)}</span>
              <span class="by">{day(entry.day)}{entry.change ? ` · ${entry.change.actorLabel}` : typeof entry.evidence?.observedBy === 'string' ? ` · ${entry.evidence.observedBy}` : ''}</span>
            </div>
          {/each}
        </section>
      {/if}

      <details class="raw" style="--i: 7">
        <summary class="label">Raw frontmatter</summary>
        <pre>{JSON.stringify(entity.frontmatter, null, 2)}</pre>
      </details>
    {/if}
  </div>
</article>

<style>
  .case-file {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  header {
    position: relative;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--rule);
  }
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
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
    margin: 8px 40px 10px 0;
    font-size: 30px;
    line-height: 1.02;
    overflow-wrap: anywhere;
  }
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-right: 36px;
  }
  .tag {
    min-width: 0;
    color: var(--mute);
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }
  .tag .mono {
    font-size: 11.5px;
  }
  .body {
    display: grid;
    align-content: start;
    gap: 20px;
    min-height: 0;
    padding: 14px 20px 26px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .body > * {
    animation: rise 0.45s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 50ms + 80ms);
  }
  .summary {
    margin: 0;
    font: 400 20px/1.35 var(--font-serif);
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--signal-soft);
    font-size: 13px;
  }
  .notice :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--signal);
  }
  .notice.warn {
    background: var(--warn-soft);
  }
  .notice.warn :global(svg) {
    color: var(--warn);
  }
  .notice.info {
    background: var(--info-soft);
  }
  .notice.info :global(svg) {
    color: var(--info);
  }
  .notice a {
    color: inherit;
    font-weight: 600;
  }
  .score {
    font: 400 26px/1 var(--font-serif);
  }
  .replaces {
    margin: 0;
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  section > .label {
    display: flex;
    justify-content: space-between;
    margin: 0 0 8px;
  }
  .prose {
    margin: 0;
    color: var(--ink-2);
    font-size: 13.5px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .prose + .prose {
    margin-top: 8px;
  }
  .small {
    font-size: 12.5px;
  }
  .muted.small {
    margin: 0;
  }
  .kv {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  .kv th {
    width: 36%;
    padding: 6px 12px 6px 0;
    color: var(--mute);
    font: 400 12px var(--font-mono);
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .kv td {
    padding: 6px 0;
    border-bottom: 1px solid var(--rule);
    overflow-wrap: anywhere;
  }
  .kv tr:last-child td {
    border-bottom: 0;
  }
  .rel-list {
    display: grid;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rel-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    font-size: 13.5px;
  }
  .rel {
    color: var(--mute);
    font: 500 11.5px var(--font-mono);
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
  .linkish:hover {
    text-decoration-color: var(--signal);
  }
  .code.ref {
    background: var(--mute);
  }
  .exhibit {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
    font-size: 13.5px;
  }
  .exhibit:first-of-type {
    padding-top: 0;
    border-top: 0;
  }
  .ex {
    align-self: start;
    height: 19px;
    margin-top: 1px;
    padding: 0 6px;
    border: 0;
    border-radius: 4px;
    background: var(--ink);
    color: var(--bg);
    font: 600 10.5px/1 var(--font-mono);
    letter-spacing: 0.04em;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s,
      box-shadow 0.2s;
  }
  .ex:hover {
    background: var(--signal);
    color: var(--signal-ink);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--signal) 22%, transparent);
  }
  .ex-note {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .loc {
    grid-column: 2;
    color: var(--ink-2);
    font: 11.5px/1.45 var(--font-mono);
    overflow-wrap: anywhere;
  }
  .by {
    grid-column: 2;
    color: var(--mute);
    font-size: 12px;
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
  .raw summary {
    cursor: pointer;
  }
  .raw pre {
    margin: 8px 0 0;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--bg);
    font: 11.5px/1.5 var(--font-mono);
    overflow-x: auto;
  }
  /* A finding about the record, in brief: its number, headline and weight, on its rail. */
  .findings {
    display: grid;
    gap: 8px;
  }
  .finding {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 10px;
    padding: 10px 12px;
    border: 0;
    border-radius: 8px;
    background: var(--bg);
    box-shadow:
      inset 0 0 0 1px var(--rule),
      inset 3px 0 0 var(--rule-2);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: box-shadow 0.2s;
  }
  .finding.high {
    box-shadow:
      inset 0 0 0 1px var(--rule),
      inset 3px 0 0 var(--ok);
  }
  .finding.mid {
    box-shadow:
      inset 0 0 0 1px var(--rule),
      inset 3px 0 0 var(--warn);
  }
  .finding.low {
    box-shadow:
      inset 0 0 0 1px var(--rule),
      inset 3px 0 0 var(--signal);
  }
  .finding:hover b {
    text-decoration: underline;
    text-decoration-color: var(--signal);
  }
  .finding b {
    grid-column: 1 / -1;
    font: 400 17px/1.2 var(--font-serif);
    text-underline-offset: 3px;
  }
  .finding .weight {
    grid-row: 1;
    grid-column: 2;
  }
  .finding .weight .bar {
    width: 40px;
  }
  .finding .weight.none .bar i {
    background: var(--rule-2);
  }
  .more {
    margin-top: 8px;
    font-size: 12.5px;
  }
</style>
