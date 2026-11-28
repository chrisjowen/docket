<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import { ArrowRight, BrainCog, CircleCheck, Database, FileText, Hourglass, RefreshCw, Search, Share2, TriangleAlert } from '@lucide/svelte'
  import { onMount } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import SettingsTabs from '$lib/components/settings-tabs.svelte'
  import { STORES, ago, duration, storeName, timeline, triggersText, type StoreKey } from '$lib/how-it-works'

  import type { PageData } from './$types'

  let { data, form } = $props()

  const CHANNELS: Record<string, string> = { mcp: 'MCP', ui: 'Web', cli: 'CLI', repo: 'Repo', ontology: 'Ontology' }
  const ACTIONS: Record<string, string> = {
    remember: 'remembered',
    'add-evidence': 'added evidence',
    retire: 'retired',
    'propose-ontology': 'proposed an ontology change',
    'publish-ontology': 'published the ontology',
    'repo-sync': 'synced from the repo',
    push: 'pushed from a checkout',
  }
  const icons = { documents: FileText, neo4j: Share2, mem0: Search, cognee: BrainCog }
  const storeOf = (id: string) => STORES[(id in STORES ? id : 'neo4j') as StoreKey]

  // The standing moves as the worker works: read it again while the page is open, without the documents.
  // Each store's lag is the one the page loaded with: the poll does not work it out.
  type Polled = Omit<PageData['live'], 'stores'> & { stores: Omit<PageData['live']['stores'][number], 'synced' | 'behind'>[] }
  let polled = $state<Polled | null>(null)
  const live = $derived(polled && polled.now > data.live.now ? polled : data.live)
  const titles = $derived(new Map(data.live.runs.flatMap((run) => run.instances.flatMap((instance) => instance.changes.map((change) => [change.id, change.title] as const)))))
  const runs = $derived(
    live.runs.map((run) => ({
      ...run,
      instances: run.instances.map((instance) => ({
        ...instance,
        changes: instance.changes.map((change) => ({ ...change, title: change.title ?? titles.get(change.id) ?? null })),
      })),
    })),
  )
  const projections = $derived(
    live.stores.map((store) => {
      const loaded = data.live.stores.find((known) => known.id === store.id)
      return { ...store, synced: loaded?.synced ?? false, behind: loaded?.behind ?? data.documents.exhibits }
    }),
  )

  const history = $derived(timeline(runs, data.ingests))
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const waiting = $derived(live.outbox.oldestAt ? live.now - new Date(live.outbox.oldestAt).getTime() : 0)

  onMount(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const response = await fetch(resolve('/a/[org]/d/[ws]/settings/sync/status', { org: data.org.slug, ws: data.workspace.slug })).catch(() => null)
      if (response?.ok) polled = (await response.json()) as Polled
    }, 15_000)
    return () => clearInterval(timer)
  })
</script>

<svelte:head>
  <title>Sync · Settings · {data.workspace.name}</title>
</svelte:head>

<h1>Settings</h1>
<p class="muted lede">{data.workspace.name} belongs to {data.org.name}; its members' roles apply here.</p>
<SettingsTabs org={data.org.slug} ws={data.workspace.slug} active="sync" />

<p class="intro">
  Every write lands in <strong>Documents</strong> first. The worker then projects each change into the
  <strong>Graph</strong> and the <strong>Search index</strong>, which search and questions read from. This page shows how
  that is going; nothing here changes a store.
</p>

<ol class="flow" aria-label="Stores" style:--projections={projections.length}>
  <li class="card store" data-testid="store-documents">
    <h2><Database size={16} aria-hidden="true" /> {STORES.documents.name} <span class="muted engine">{STORES.documents.engine}</span></h2>
    <p class="muted role">{STORES.documents.role}</p>
    <dl>
      <dt>Holds</dt>
      <dd>{data.documents.documents} documents, {data.documents.exhibits} exhibits</dd>
      <dt>Last change</dt>
      <dd>{#if live.lastChange}<time datetime={live.lastChange} title={when(live.lastChange)}>{ago(live.lastChange, live.now)}</time>{:else}none recorded{/if}</dd>
      <dt>Lag</dt>
      <dd>none: the other stores are projected from here</dd>
      <dt>Failures</dt>
      <dd>
        {#if data.documents.failures > 0}
          <span class="badge narrowing">{data.documents.failures} refused or failed</span> in the recent writes below
        {:else}none in the recent writes{/if}
        {#if data.documents.unreadable > 0}<br /><span class="muted">{data.documents.unreadable} documents have errors and are not projected</span>{/if}
      </dd>
    </dl>
  </li>
  {#each projections as store (store.id)}
    {@const Icon = icons[(store.id in icons ? store.id : 'neo4j') as keyof typeof icons]}
    {@const upToDate = store.synced && store.behind === 0}
    <li class="arrow" aria-hidden="true"><ArrowRight size={18} /></li>
    <li class="card store" data-testid="store-{store.id}" data-state={upToDate ? 'current' : store.failures > 0 ? 'failing' : 'behind'}>
      <h2>
        <Icon size={16} aria-hidden="true" /> {storeName(store.id)} <span class="muted engine">{storeOf(store.id).engine}</span>
        {#if store.optional}<span class="badge" data-testid="optional-{store.id}">optional</span>{/if}
      </h2>
      <p class="muted role">{storeOf(store.id).role}</p>
      <dl>
        <dt>State</dt>
        <dd>
          {#if upToDate}
            <span class="state ok"><CircleCheck size={14} aria-hidden="true" /> Up to date</span>
          {:else if store.failures > 0}
            <span class="state bad"><TriangleAlert size={14} aria-hidden="true" /> Failing</span>
          {:else}
            <span class="state wait"><Hourglass size={14} aria-hidden="true" /> Catching up</span>
          {/if}
        </dd>
        <dt>Last sync</dt>
        <dd>{#if store.syncedAt}<time datetime={store.syncedAt} title={when(store.syncedAt)}>{ago(store.syncedAt, live.now)}</time>{:else}never{/if}</dd>
        <dt>Lag</dt>
        <dd data-testid="lag-{store.id}">
          {#if !store.synced}not yet projected: {store.behind} exhibits to go
          {:else if store.behind === 0}none
          {:else}{store.behind} exhibits behind the documents{/if}
          {#if live.outbox.pending > 0 && !upToDate}<br /><span class="muted">oldest change waiting {duration(waiting)}</span>{/if}
        </dd>
        <dt>Failures</dt>
        <dd>
          {#if store.failures === 0}none since the last good pass
          {:else}
            <span class="badge invalid">{store.failures} in a row</span>
            {#if store.retryAt}<span class="muted">retrying {new Date(store.retryAt).getTime() > live.now ? `in ${duration(new Date(store.retryAt).getTime() - live.now)}` : 'now'}</span>{/if}
            {#if store.error}<br /><span class="error">{store.error}</span>{/if}
          {/if}
        </dd>
      </dl>
    </li>
  {/each}
</ol>

<section class="card recheck" aria-labelledby="recheck-heading">
  <div>
    <h2 id="recheck-heading">Re-check the stores</h2>
    <p class="muted">
      Compares each store with the documents and catches up anything missing, now rather than at the next change or
      retry. It never clears a store.
      {#if live.outbox.pending > 0}{live.outbox.pending} change{live.outbox.pending === 1 ? ' is' : 's are'} waiting for the worker.{/if}
    </p>
    {#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}
  </div>
  {#if data.canRecheck}
    <form method="POST" action="?/recheck" use:enhance>
      <Csrf token={data.csrf} />
      <button class="button small" type="submit" disabled={live.outbox.recheckPending} data-testid="recheck">
        <RefreshCw size={14} aria-hidden="true" /> {live.outbox.recheckPending ? 'Re-check queued' : 'Re-check now'}
      </button>
    </form>
  {:else}
    <p class="muted small">Only owners can ask for a re-check.</p>
  {/if}
</section>

<h2 class="history-heading">Recent syncs</h2>
<p class="muted small">Document changes and the worker's passes that projected them, newest first. Records are named by id; no document text is kept here.</p>
{#if history.length === 0}
  <p class="card empty">Nothing yet: write a document, push a checkout or sync a repo, and the passes appear here.</p>
{:else}
  <ol class="history" data-testid="sync-history">
    {#each history as entry (`${entry.kind}:${entry.kind === 'sync' ? entry.sync?.id : entry.documents?.id}`)}
      {#if entry.sync}
        {@const run = entry.sync}
        <li class="card entry" data-testid="sync-run" data-ok={run.ok}>
          <header>
            <span class="kind"><RefreshCw size={14} aria-hidden="true" /> Pass</span>
            <span class="what">{triggersText(run.triggers)} · took {duration(run.tookMs)}</span>
            <span class={`badge ${run.ok ? 'safe' : 'invalid'}`}>{run.ok ? 'synced' : 'failed'}</span>
            <time class="muted" datetime={entry.at}>{when(entry.at)}</time>
          </header>
          <ul class="instances">
            {#each run.instances as instance (instance.id)}
              <li data-testid="sync-run-{instance.id}">
                <strong>{storeName(instance.id)}</strong>:
                {#if instance.error}<span class="error">{instance.error}</span>{/if}
                {#if instance.reset}cleared and projected again,{/if}
                {#if instance.upserts + instance.deletes === 0 && !instance.error}nothing to change
                {:else if instance.upserts + instance.deletes > 0}{instance.upserts} written, {instance.deletes} removed{/if}
                {#if instance.failed > 0}<span class="error">, {instance.failed} not acknowledged</span>{/if}
                {#if instance.changes.length > 0}
                  <details>
                    <summary>What changed</summary>
                    <ul class="changes">
                      {#each instance.changes as change, i (`${change.kind}:${change.id}:${i}`)}
                        <li>
                          <span class={`op ${change.operation}`}>{change.operation === 'upsert' ? '+' : '−'}</span>
                          <span class="mono">{change.id}</span>
                          {#if change.title}<span class="muted">{change.title}</span>{/if}
                          {#if change.kind !== 'entity'}<span class="muted small">({change.kind})</span>{/if}
                        </li>
                      {/each}
                      {#if instance.upserts + instance.deletes > instance.changes.length}
                        <li class="muted">and {instance.upserts + instance.deletes - instance.changes.length} more</li>
                      {/if}
                    </ul>
                  </details>
                {/if}
              </li>
            {/each}
          </ul>
        </li>
      {:else if entry.documents}
        {@const change = entry.documents}
        <li class="card entry" data-testid="sync-documents" data-outcome={change.outcome}>
          <header>
            <span class="kind"><FileText size={14} aria-hidden="true" /> Documents</span>
            <span class="what"><strong>{change.actor}</strong> {ACTIONS[change.action] ?? change.action} via {CHANNELS[change.channel] ?? change.channel}</span>
            <span class={`badge ${change.outcome === 'ok' ? 'safe' : change.outcome === 'refused' ? 'invalid' : 'narrowing'}`}>{change.outcome === 'ok' ? 'written' : change.outcome}</span>
            <time class="muted" datetime={entry.at}>{when(entry.at)}</time>
          </header>
          {#if change.documents.length > 0}
            <ul class="changes">
              {#each change.documents.slice(0, 8) as document, i (`${document.path}:${i}`)}
                <li><span class="mono">{document.path}</span> <span class="muted">{document.change}</span></li>
              {/each}
              {#if change.documents.length > 8}<li class="muted">and {change.documents.length - 8} more</li>{/if}
            </ul>
          {/if}
        </li>
      {/if}
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
  .flow {
    display: grid;
    /* The documents, then an arrow and a card for each store projected from them, cognee included when on. */
    grid-template-columns: minmax(0, 1fr) repeat(var(--projections), auto minmax(0, 1fr));
    align-items: stretch;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .arrow {
    display: flex;
    align-items: center;
    color: var(--muted-foreground);
  }
  .store {
    padding: 0.9rem 1rem;
    min-width: 0;
  }
  .store[data-state='failing'] {
    border-color: color-mix(in srgb, var(--destructive) 50%, var(--border));
  }
  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.3rem;
    font-size: 1.05rem;
  }
  .engine {
    font-size: 0.8rem;
    font-weight: 400;
  }
  .role {
    margin: 0 0 0.6rem;
    font-size: 0.85rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.3rem 0.8rem;
    margin: 0;
    font-size: 0.875rem;
  }
  dt {
    color: var(--muted-foreground);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 500;
  }
  .state.ok {
    color: var(--ok);
  }
  .state.wait {
    color: var(--warn);
  }
  .state.bad,
  .error {
    color: var(--destructive);
  }
  .recheck {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    margin-top: 1rem;
    padding: 0.9rem 1rem;
  }
  .recheck p {
    margin: 0.2rem 0 0;
    max-width: 44rem;
  }
  .history-heading {
    margin: 1.75rem 0 0.2rem;
    font-size: 1.15rem;
  }
  .empty {
    padding: 1rem;
  }
  .history {
    display: grid;
    gap: 0.5rem;
    margin: 0.75rem 0 0;
    padding: 0;
    list-style: none;
  }
  .entry {
    display: grid;
    gap: 0.4rem;
    padding: 0.7rem 0.9rem;
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.75rem;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--gilt);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .what {
    flex: 1 1 16rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  time {
    font-size: 0.8125rem;
  }
  .instances,
  .changes {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .changes {
    margin-top: 0.3rem;
  }
  .changes li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .op {
    font-family: var(--font-mono);
    width: 1ch;
  }
  .op.upsert {
    color: var(--ok);
  }
  .op.delete {
    color: var(--destructive);
  }
  details summary {
    cursor: pointer;
    color: var(--muted-foreground);
  }
  .small {
    font-size: 0.8125rem;
  }
  @media (max-width: 900px) {
    .flow {
      grid-template-columns: minmax(0, 1fr);
    }
    .arrow {
      justify-content: center;
      transform: rotate(90deg);
    }
  }
</style>
