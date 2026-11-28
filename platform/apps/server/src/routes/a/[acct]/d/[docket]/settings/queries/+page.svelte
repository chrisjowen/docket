<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import type { TracedStore } from '@docket/platform-canonical-store'
  import { Bot, Search, Sparkles } from '@lucide/svelte'

  import SettingsTabs from '$lib/components/settings-tabs.svelte'
  import { cost, duration, queryLabel, storeName } from '$lib/how-it-works'

  let { data } = $props()

  const ws = $derived({ acct: data.org.slug, docket: data.workspace.slug })
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const TOOLS = { search: { label: 'Search', tool: 'docket_search' }, ask: { label: 'Ask', tool: 'docket_ask' } } as const
  const PURPOSES: Record<string, string> = { cypher: 'wrote the graph query', synthesis: 'wrote the answer', extraction: 'extracted facts' }
  const COVERAGE: Record<string, string> = { exhaustive: 'every match', 'top-k': 'the best matches' }

  /** What a store returned, in one line: how many, how complete, how fresh. */
  function returned(store: TracedStore): string {
    const parts = [`Returned ${store.hitCount} ${store.hitCount === 1 ? 'exhibit' : 'exhibits'}${store.rows !== undefined ? `, ${store.rows} rows` : ''}`]
    const coverage = store.coverage && COVERAGE[store.coverage.mode]
    if (coverage) parts.push(`${coverage}${store.coverage?.truncated ? ', cut short' : ''}`)
    if (store.freshness?.state === 'behind') parts.push(`index behind${store.freshness.behind !== undefined ? ` by ${store.freshness.behind}` : ''}`)
    return parts.join(' · ')
  }
</script>

<svelte:head>
  <title>Queries · Settings · {data.workspace.name}</title>
</svelte:head>

<h1>Settings</h1>
<p class="muted lede">{data.workspace.name} belongs to {data.org.name}; its members' roles apply here.</p>
<SettingsTabs org={data.org.slug} ws={data.workspace.slug} active="queries" />

<p class="intro">
  <span data-testid="queries-whose">
    {#if data.everyone}Every question anyone asked of {data.workspace.name}, with who asked it.
    {:else}Only the questions you asked of {data.workspace.name}, through any of your tokens or OAuth clients; whoever may see audit and usage here sees everyone's.{/if}
  </span>
  Each is replayed step by step: what the documents held, which stores were asked and what each returned, the query each
  ran and whether a fixed template or a model wrote it, what went into the answer, and what it cost. The newest
  {data.kept.limit} are kept, for {data.kept.days} days; they name records by id and title, never their text.
</p>

{#if data.traces.length === 0}
  <section class="card empty">
    <p>No questions yet.</p>
    <p class="muted">
      Ask through an MCP client with <span class="mono">docket_search</span> or <span class="mono">docket_ask</span> (see
      <a href={resolve('/a/[acct]/d/[docket]/mcp', ws)}>MCP</a>), and each one appears here.
    </p>
  </section>
{:else}
  <ol class="traces" data-testid="query-traces">
    {#each data.traces as trace, index (trace.id)}
      {@const detail = trace.detail}
      <li class="card trace" data-testid="query-trace" data-tool={trace.tool} data-outcome={trace.outcome}>
        <details open={index === 0}>
          <summary>
            <span class="tool">
              {#if trace.tool === 'search'}<Search size={14} aria-hidden="true" />{:else}<Sparkles size={14} aria-hidden="true" />{/if}
              {TOOLS[trace.tool].label}
            </span>
            <span class="question">{detail?.question ?? 'question unavailable'}</span>
            <span class="facts muted">
              {trace.actor} · <time datetime={trace.at}>{when(trace.at)}</time> · {duration(trace.durationMs)} · {cost(trace.costUsd)}
            </span>
            {#if trace.outcome === 'failed'}<span class="badge invalid">failed</span>{/if}
          </summary>

          {#if !detail}
            <p class="alert small">This trace did not open: {trace.detailError}</p>
          {:else}
            <ol class="steps">
              <li>
                <h3>Asked</h3>
                <p>
                  {trace.actor} called <span class="mono">{TOOLS[trace.tool].tool}</span>:
                  <q>{detail.question}</q>
                </p>
              </li>

              <li>
                <h3>Read the documents</h3>
                <p>
                  {detail.read.exhibits} exhibits in {detail.read.documents} documents, the canonical record every answer is checked against.
                  {#if !detail.read.indexSynced}The stores were still being projected.{:else if detail.read.indexBehind > 0}The stores were {detail.read.indexBehind} exhibits behind them.{:else}The stores were up to date with them.{/if}
                </p>
              </li>

              <li>
                <h3>Asked {detail.stores.length === 1 ? 'one store' : `${detail.stores.length} stores`}</h3>
                {#if detail.stores.length === 0}
                  <p class="muted">No store was asked{detail.error ? `: ${detail.error}` : '.'}</p>
                {/if}
                <div class="stores">
                  {#each detail.stores as store (store.adapter)}
                    <section class="store" data-testid="trace-store-{store.adapter}" data-state={store.state}>
                      <h4>
                        {storeName(store.adapter)}
                        {#if store.adapter === 'cognee'}<span class="badge" data-testid="trace-cognee">optional · floored</span>{/if}
                        <span class="muted small">{store.state === 'answered' ? `answered${store.durationMs !== undefined ? ` in ${duration(store.durationMs)}` : ''}` : 'failed'}</span>
                      </h4>
                      {#if store.error}<p class="error small">{store.error}</p>{/if}
                      {#if store.interpretation}<p class="small">{store.interpretation}</p>{/if}
                      {#if store.query}
                        <p class="small">
                          <span class={`badge ${store.query.by === 'model' ? 'owner' : 'safe'}`} data-testid="query-by">
                            {#if store.query.by === 'model'}<Bot size={12} aria-hidden="true" />{/if}
                            {queryLabel(store.query)}
                          </span>
                        </p>
                        {#if store.query.fallback}<p class="muted small">{store.query.fallback}</p>{/if}
                        <pre class="query" data-testid="query-text">{store.query.text}</pre>
                      {/if}
                      {#if store.assumptions?.length}
                        <ul class="notes small muted">
                          {#each store.assumptions as assumption, i (i)}<li>{assumption}</li>{/each}
                        </ul>
                      {/if}
                      <p class="small">{returned(store)}</p>
                      {#if store.hits.length > 0}
                        <ul class="hits">
                          {#each store.hits as hit (hit.id)}
                            <li><a class="mono" href="{resolve('/a/[acct]/d/[docket]/graph', ws)}#{encodeURIComponent(hit.id)}">{hit.id}</a>{#if hit.title}<span class="muted">{hit.title}</span>{/if}</li>
                          {/each}
                          {#if store.hitCount > store.hits.length}<li class="muted">and {store.hitCount - store.hits.length} more</li>{/if}
                        </ul>
                      {/if}
                      {#if store.notes.length > 0}
                        <ul class="notes small muted">
                          {#each store.notes as note, i (i)}<li>{note}</li>{/each}
                        </ul>
                      {/if}
                    </section>
                  {/each}
                </div>
              </li>

              <li>
                <h3>Put the answer together</h3>
                <p>
                  The stores pointed at {detail.answer.counts.resolved + detail.answer.counts.stale + detail.answer.counts.unresolved} records:
                  {detail.answer.counts.resolved} as the documents hold them{#if detail.answer.counts.stale > 0}, {detail.answer.counts.stale} changed since they were projected{/if}{#if detail.answer.counts.unresolved > 0}, {detail.answer.counts.unresolved} the documents no longer hold (left out){/if}.
                  {#if detail.answer.connections > 0}docket read {detail.answer.connections} {detail.answer.connections === 1 ? 'path' : 'paths'} joining them from the documents.{/if}
                </p>
                {#if detail.answer.references.length > 0}
                  <ul class="hits">
                    {#each detail.answer.references as reference, i (`${reference.id}:${i}`)}
                      <li>
                        <span class="mono">{reference.entity ?? reference.id}</span>
                        {#if reference.title}<span class="muted">{reference.title}</span>{/if}
                        <span class="muted small">found by {reference.foundBy.map(storeName).join(' and ')}{reference.status !== 'resolved' ? ` · ${reference.status}` : ''}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if detail.answer.synthesis}
                  <p data-testid="trace-synthesis">
                    <span class="badge owner"><Bot size={12} aria-hidden="true" /> {detail.answer.synthesis.model}</span>
                    wrote the answer from them, citing {detail.answer.synthesis.citedEntities.length} exhibits{#if detail.answer.synthesis.citedEvidence > 0} and {detail.answer.synthesis.citedEvidence} pieces of evidence{/if}{#if detail.answer.synthesis.citedEntities.length > 0}:
                      <span class="mono">{detail.answer.synthesis.citedEntities.join(', ')}</span>{/if}.
                  </p>
                {:else if trace.tool === 'search'}
                  <p class="muted">Search returns what the stores found as it is: no model writes an answer.</p>
                {:else if detail.answer.notice}
                  <p class="muted">No summary: {detail.answer.notice}</p>
                {/if}
                {#if detail.error}<p class="error small">The question failed: {detail.error}</p>{/if}
              </li>

              <li>
                <h3>Cost</h3>
                {#if detail.calls.length === 0}
                  <p data-testid="trace-cost">No model was called, so it cost nothing from the AI budget{trace.tool === 'search' ? ': search never calls one' : ''}.</p>
                {:else}
                  <table class="calls" data-testid="trace-cost">
                    <thead><tr><th>Model</th><th>For</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
                    <tbody>
                      {#each detail.calls as call, i (i)}
                        <tr>
                          <td class="mono">{call.model}</td>
                          <td>{PURPOSES[call.purpose] ?? call.purpose}</td>
                          <td>{call.promptTokens.toLocaleString()} / {call.completionTokens.toLocaleString()}</td>
                          <td>{cost(call.costUsd)}</td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot><tr><td colspan="3">Total, from the org's AI budget</td><td>{cost(trace.costUsd)}</td></tr></tfoot>
                  </table>
                {/if}
              </li>
            </ol>
          {/if}
        </details>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .lede {
    margin-top: 0;
  }
  .intro {
    max-width: 48rem;
    margin: 0 0 1rem;
  }
  .empty {
    padding: 1.1rem;
  }
  .empty p {
    margin: 0 0 0.3rem;
  }
  .traces {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .trace {
    padding: 0.7rem 0.9rem;
    min-width: 0;
  }
  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.75rem;
    cursor: pointer;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--gilt);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .question {
    flex: 1 1 18rem;
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .facts {
    font-size: 0.8125rem;
  }
  .steps {
    display: grid;
    gap: 0.9rem;
    margin: 0.9rem 0 0.2rem;
    padding-left: 1.4rem;
  }
  .steps > li::marker {
    color: var(--gilt);
    font-weight: 600;
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
  }
  h4 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0 0 0.3rem;
    font-size: 0.9rem;
  }
  .steps p {
    margin: 0.2rem 0;
    overflow-wrap: anywhere;
  }
  .stores {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .store {
    min-width: 0;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--muted);
  }
  .store[data-state='failed'] {
    border-color: color-mix(in srgb, var(--destructive) 50%, var(--border));
  }
  .query {
    margin: 0.35rem 0;
    padding: 0.5rem 0.6rem;
    max-height: 14rem;
    overflow: auto;
    border-radius: var(--radius);
    background: var(--background);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .hits li {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.5rem;
  }
  .hits,
  .notes {
    display: grid;
    gap: 0.15rem;
    margin: 0.3rem 0;
    padding: 0;
    list-style: none;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .notes {
    padding-left: 1rem;
    list-style: disc;
  }
  .calls {
    width: 100%;
    max-width: 40rem;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .calls th,
  .calls td {
    padding: 0.25rem 0.5rem 0.25rem 0;
    text-align: left;
    border-bottom: 1px solid var(--border);
    overflow-wrap: anywhere;
  }
  .calls tfoot td {
    font-weight: 600;
    border-bottom: 0;
  }
  .error {
    color: var(--destructive);
  }
  .small {
    font-size: 0.8125rem;
  }
</style>
