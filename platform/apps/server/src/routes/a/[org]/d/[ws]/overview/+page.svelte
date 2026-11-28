<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowRight, Check, Copy, MessageSquareText, Network } from '@lucide/svelte'

  import { ACTION_LABELS, CHANNEL_LABELS, FILING_KINDS } from '$lib/activity'
  import { weightClass } from '$lib/docket'
  import { slotColour } from '$lib/graph/model'
  import { bandOf } from '$lib/trust/bands'
  import { countUp } from '$lib/motion'

  let { data } = $props()
  const ws = $derived({ org: data.org.slug, ws: data.workspace.slug })
  const maxType = $derived(Math.max(1, ...data.types.map((type) => type.count)))
  const snippet = $derived(`claude mcp add --transport http docket ${data.endpoint}`)
  const STORE_LABELS: Record<string, [string, string]> = { neo4j: ['Graph', 'Neo4j'], mem0: ['Memory', 'mem0'] }
  const percent = (value: number) => Math.round(value * 100)
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const standing = (store: (typeof data.index.stores)[number]) =>
    store.failures > 0
      ? { label: 'Failing', tone: 'red' }
      : !store.synced
        ? { label: 'Not synced', tone: 'idle' }
        : store.behind > 0
          ? { label: `Catching up · ${store.behind}`, tone: 'warn' }
          : { label: 'Current', tone: '' }

  let copied = $state(false)
  async function copy() {
    await navigator.clipboard.writeText(snippet)
    copied = true
    setTimeout(() => (copied = false), 1600)
  }
</script>

<svelte:head>
  <title>{data.workspace.name} · {data.org.name} · Docket Cloud</title>
</svelte:head>

<div class="page-head">
  <div class="titles">
    <h1 class="display">In re <em>{data.workspace.name}</em></h1>
    <p class="lede">
      The standing record of {data.workspace.name}: every record it holds, the relations between them, and the exhibits behind each one.
    </p>
  </div>
  <div class="actions">
    <a class="button" href={resolve('/a/[org]/d/[ws]/graph', ws)}><Network size={16} aria-hidden="true" /> Open the record</a>
    <a class="button primary" href="{resolve('/a/[org]/ask', { org: data.org.slug })}?ws={encodeURIComponent(data.workspace.slug)}"
      ><MessageSquareText size={16} aria-hidden="true" /> Ask the record</a
    >
  </div>
</div>

<section class="kpis reveal" aria-label="Key figures">
  <div class="kpi" style="--i: 0"><b use:countUp={{ value: data.figures.records }}>{data.figures.records}</b><span>records</span></div>
  <div class="kpi" style="--i: 1"><b use:countUp={{ value: data.figures.findings }}>{data.figures.findings}</b><span>findings</span></div>
  <div class="kpi" style="--i: 2"><b use:countUp={{ value: data.figures.exhibits }}>{data.figures.exhibits}</b><span>exhibits</span></div>
  <div class="kpi" class:flag={data.figures.weight !== null && bandOf(data.figures.weight, data.bands) === 'unverified'} style="--i: 3">
    {#if data.figures.weight === null}
      <b>-</b>
    {:else}
      <b><span use:countUp={{ value: percent(data.figures.weight) }}>{percent(data.figures.weight)}</span><small>%</small></b>
    {/if}
    <span>average weight of evidence</span>
  </div>
</section>

<div class="bento">
  <div class="col reveal">
    <section class="card" style="--i: 1" aria-labelledby="index-title">
      <div class="card-head">
        <h2 id="index-title">Record <em>index</em></h2>
        <span class="label">{data.types.length} {data.types.length === 1 ? 'type' : 'types'}</span>
      </div>
      {#if data.types.length}
        <ul class="types">
          {#each data.types as type, index (type.type)}
            <li style="--i: {index}">
              <span class="code" style="--c: {slotColour(type.slot)}">{type.code}</span>
              <span class="type-name">{type.type}</span>
              <span class="type-bar" aria-hidden="true"><i style="width: {(type.count / maxType) * 100}%; --c: {slotColour(type.slot)}"></i></span>
              <span class="mono count">{type.count}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">Nothing on the record yet. File documents, connect a repo or remember something over MCP.</p>
      {/if}
      <a class="more" href={resolve('/a/[org]/d/[ws]/graph', ws)}>Open the record <ArrowRight size={14} aria-hidden="true" /></a>
    </section>

    <section class="card" style="--i: 2" aria-labelledby="filings-title">
      <div class="card-head">
        <h2 id="filings-title">Latest <em>filings</em></h2>
        <a class="more inline" href={resolve('/a/[org]/d/[ws]/activity', ws)}>Activity <ArrowRight size={14} aria-hidden="true" /></a>
      </div>
      {#if data.filings.length}
        <table class="sheet">
          <tbody>
            {#each data.filings as filing (filing.id)}
              <tr>
                <td class="d mono">{day(filing.at)}</td>
                <td>
                  <span class="kind" class:bad={filing.outcome !== 'ok'}>{FILING_KINDS[filing.action] ?? filing.action}</span>
                  <span class="dash" aria-hidden="true">-</span>
                  {filing.actor}
                  {ACTION_LABELS[filing.action] ?? filing.action}
                  {#if filing.records.length}
                    <span class="muted">re</span>
                    {#each filing.records as record, index (record.id)}{#if index},
                      {/if}<a href="{resolve('/a/[org]/d/[ws]/graph', ws)}#{encodeURIComponent(record.id)}">{record.title}</a>{/each}
                  {:else if filing.documents}
                    <span class="muted">({filing.documents} {filing.documents === 1 ? 'document' : 'documents'})</span>
                  {/if}
                  <span class="via label">via {CHANNEL_LABELS[filing.channel] ?? filing.channel}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted">No filings yet.</p>
      {/if}
    </section>
  </div>

  <div class="col reveal">
    <section class="card" style="--i: 2" aria-labelledby="corroborate-title">
      <div class="card-head">
        <h2 id="corroborate-title">Needs <em>corroboration</em></h2>
        <span class="label">{data.uncorroborated} {data.uncorroborated === 1 ? 'finding' : 'findings'}</span>
      </div>
      {#if data.corroborate.length}
        <ul class="rows findings" data-testid="needs-corroboration">
          {#each data.corroborate as finding (finding.no)}
            <li>
              <a class="record" href="{resolve('/a/[org]/d/[ws]/graph', ws)}?view=facts&open={finding.no}"><span class="docket-no">{finding.no}</span> {finding.headline}</a>
              {#if finding.confidence !== null}
                <span class="weight {finding.unevidenced ? 'low' : weightClass(finding.confidence, data.bands)}" title="Weight of evidence">
                  <span class="bar"><i style="width: {percent(finding.confidence)}%"></i></span>{percent(finding.confidence)}%
                </span>
              {/if}
              <span class="sub">
                Re <span class="code" style="--c: {slotColour(finding.re.slot)}">{finding.re.code}</span>
                {finding.re.title} · {finding.exhibits}
                {finding.exhibits === 1 ? 'exhibit' : 'exhibits'} cited
                <span class="stamp red">{finding.standing}</span>
              </span>
            </li>
          {/each}
        </ul>
        <a class="more" href="{resolve('/a/[org]/d/[ws]/graph', ws)}?view=facts&flag=weak">All needing corroboration <ArrowRight size={14} aria-hidden="true" /></a>
      {:else}
        <p class="muted"><Check size={14} aria-hidden="true" /> Every finding carries at least half its weight in evidence.</p>
      {/if}
    </section>

    <section class="card" style="--i: 3" aria-labelledby="status-title">
      <div class="card-head">
        <h2 id="status-title">Filing <em>status</em></h2>
        <a class="more inline" href={resolve('/a/[org]/d/[ws]/settings/sync', ws)}>Sync <ArrowRight size={14} aria-hidden="true" /></a>
      </div>
      <ul class="stores">
        <li>
          <span class="live-dot" aria-hidden="true"></span>
          <span><b>Documents</b> <span class="muted">Postgres</span></span>
          <span class="status"><i></i>Current</span>
        </li>
        {#each data.index.stores as store (store.id)}
          {@const state = standing(store)}
          <li data-store={store.id}>
            <span class="live-dot" class:behind={state.tone === 'warn'} class:down={state.tone === 'red'} aria-hidden="true"></span>
            <span><b>{STORE_LABELS[store.id]?.[0] ?? store.id}</b> <span class="muted">{STORE_LABELS[store.id]?.[1] ?? ''}</span></span>
            <span class="status {state.tone}"><i></i>{state.label}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section class="card" style="--i: 4" aria-labelledby="connect-title">
      <div class="card-head">
        <h2 id="connect-title">Connect <em>Claude Code</em></h2>
        <button type="button" class="button small" onclick={copy}>
          {#if copied}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy{/if}
        </button>
      </div>
      <pre class="code-block"><code><span class="k">claude</span> mcp add --transport http docket {data.endpoint}</code></pre>
      <a class="more" href={resolve('/a/[org]/d/[ws]/mcp', ws)}>Tokens and clients <ArrowRight size={14} aria-hidden="true" /></a>
    </section>
  </div>
</div>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .kpis {
    margin-bottom: 14px;
  }
  .bento {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: 14px;
    align-items: start;
  }
  .col {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .card {
    padding: 18px 20px;
    min-width: 0;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }
  .card-head h2 {
    margin: 0;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
  }
  .more.inline {
    margin-top: 0;
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
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .types {
    display: grid;
    gap: 8px;
  }
  .types li {
    display: grid;
    grid-template-columns: 44px minmax(0, 9rem) minmax(0, 1fr) 2.5rem;
    align-items: center;
    gap: 10px;
    animation: rise 0.45s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 45ms + 120ms);
  }
  .type-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .type-bar {
    height: 6px;
    border-radius: 3px;
    background: var(--sunk);
    overflow: hidden;
  }
  .type-bar i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--c);
    transform-origin: left;
    animation: grow 0.8s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 45ms + 160ms);
  }
  .count {
    text-align: right;
    color: var(--ink-2);
  }
  .sheet {
    width: 100%;
    border-collapse: collapse;
  }
  .sheet td {
    padding: 9px 10px 9px 0;
    border-top: 1px solid var(--rule);
    vertical-align: top;
    font-size: 13.5px;
  }
  .sheet tr:first-child td {
    border-top: none;
  }
  .sheet .d {
    width: 96px;
    color: var(--mute);
    font-size: 12px;
    white-space: nowrap;
  }
  .kind {
    font: 600 10.5px var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .kind.bad {
    color: var(--signal);
  }
  .dash {
    color: var(--mute);
  }
  .sheet a {
    font-weight: 600;
  }
  .via {
    margin-left: 4px;
    font-size: 9.5px;
  }
  .rows li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 3px 10px;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }
  .rows li:first-child {
    border-top: none;
    padding-top: 0;
  }
  .record {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  /* A weak finding: its number and headline, its weight, and what it is about. */
  .rows.findings li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .rows.findings .sub {
    grid-column: 1 / -1;
  }
  .findings .record {
    text-decoration: none;
  }
  .findings .record:hover {
    text-decoration: underline;
    text-decoration-color: var(--signal);
  }
  .rows .sub {
    grid-column: 2 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--mute);
    font-size: 12.5px;
  }
  .stores li {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--rule);
  }
  .stores li:first-child {
    border-top: none;
  }
  .code-block .k {
    color: #ff8a7a;
  }
  .code-block code {
    white-space: pre-wrap;
    word-break: break-all;
  }
  @media (max-width: 1100px) {
    .bento {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 640px) {
    .types li {
      grid-template-columns: 40px minmax(0, 1fr) 2.5rem;
    }
    .type-bar {
      display: none;
    }
    .sheet .d {
      width: 78px;
    }
  }
</style>
