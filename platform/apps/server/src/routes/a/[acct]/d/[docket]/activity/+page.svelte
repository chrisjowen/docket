<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Bot, FileText, GitBranch, Globe, Network, Sparkles, SquareTerminal } from '@lucide/svelte'

  import { ACTION_LABELS, CHANNEL_LABELS } from '$lib/activity'
  import EvidenceItem from '$lib/components/graph/evidence-item.svelte'
  import type { UiEvidence } from '$lib/graph/model'

  let { data } = $props()

  const ws = $derived({ acct: data.org.slug, docket: data.workspace.slug })

  const icons = { mcp: Bot, ui: Globe, cli: SquareTerminal, repo: GitBranch, ontology: Network, enrichment: Sparkles }

  /** A filter applies as soon as it changes: the form is a GET, so the URL can be shared. */
  const apply = (event: Event & { currentTarget: HTMLSelectElement }) => event.currentTarget.form?.requestSubmit()

  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
</script>

<svelte:head>
  <title>Activity · {data.workspace.name}</title>
</svelte:head>

<h1>Activity</h1>
<p class="muted lede">
  Every change to {data.workspace.name}'s knowledge, newest first: who made it and through which channel, the evidence it
  added, and what the ontology check said. Each entry links to its audit event.
</p>

<form class="filters" method="GET" aria-label="Filter activity" data-sveltekit-keepfocus data-sveltekit-noscroll>
  <label>
    Channel
    <select class="small" name="channel" value={data.filters.channel ?? ''} onchange={apply} data-testid="filter-channel">
      <option value="">All channels</option>
      {#each data.channels as channel (channel)}<option value={channel}>{CHANNEL_LABELS[channel] ?? channel}</option>{/each}
    </select>
  </label>
  <label>
    Actor
    <select class="small" name="actor" value={data.filters.actor ?? ''} onchange={apply} data-testid="filter-actor">
      <option value="">Everyone</option>
      {#each data.actors as entry (entry.actor)}<option value={entry.actor}>{entry.label}</option>{/each}
    </select>
  </label>
  <noscript><button class="button small" type="submit">Filter</button></noscript>
</form>

{#if data.events.length === 0}
  <section class="card empty">
    <p>No activity {data.filters.channel || data.filters.actor ? 'matches these filters' : 'yet'}.</p>
    <p class="muted">Writes from MCP clients, the graph's capture forms, the CLI and repo syncs appear here.</p>
  </section>
{:else}
  <ol class="events" data-testid="activity">
    {#each data.events as entry (entry.id)}
      {@const Icon = icons[entry.channel]}
      <li class="card event" data-channel={entry.channel} data-outcome={entry.outcome} data-testid="activity-event">
        <header>
          <span class="channel" title={CHANNEL_LABELS[entry.channel]}><Icon size={15} aria-hidden="true" /> {CHANNEL_LABELS[entry.channel] ?? entry.channel}</span>
          <span class="who">
            <strong>{entry.actorLabel}</strong>
            {ACTION_LABELS[entry.action] ?? entry.action}
            {#if entry.resourceId}
              <a class="mono" href="{resolve('/a/[acct]/d/[docket]/graph', ws)}?id={encodeURIComponent(entry.resourceId)}">{entry.resourceId}</a>
            {/if}
          </span>
          <span class={`badge ${entry.outcome === 'ok' ? 'safe' : entry.outcome === 'refused' ? 'invalid' : 'narrowing'}`}>
            {entry.outcome === 'ok' ? 'written' : entry.outcome}
          </span>
          <time class="muted" datetime={entry.at}>{when(entry.at)}</time>
        </header>

        {#if entry.documents.length}
          <ul class="documents">
            {#each entry.documents as document, i (`${document.documentId ?? document.path}:${document.change}:${i}`)}
              <li><FileText size={13} aria-hidden="true" /> <span class="mono">{document.path}</span> <span class="muted">{document.change}{#if document.revision !== undefined}, revision {document.revision}{/if}</span></li>
            {/each}
          </ul>
        {/if}

        {#if entry.reason}<p class="reason"><span class="muted">Reason:</span> {entry.reason}</p>{/if}
        {#if entry.ontology}
          <p class="muted small">
            {#if entry.ontology.number}Version {entry.ontology.number}{:else if entry.ontology.draftId}Draft{/if}
            {#if entry.ontology.classification}· check: <span class={`badge ${entry.ontology.classification}`}>{entry.ontology.classification}</span>{/if}
            {#if entry.ontology.draftId && !entry.ontology.number}
              · <a href="{resolve('/a/[acct]/d/[docket]/ontology', ws)}?draft={entry.ontology.draftId}">review the draft</a>
            {/if}
          </p>
        {/if}

        {#if entry.evidence.length}
          <details open={entry.evidence.length <= 2}>
            <summary>{entry.evidenceCount} evidence {entry.evidenceCount === 1 ? 'entry' : 'entries'}</summary>
            {#each entry.evidence as group, g (`${group.on}:${g}`)}
              <div class="group">
                <span class="muted small">on <span class="mono">{group.on}</span></span>
                {#each group.entries as item, i (i)}<EvidenceItem item={item as UiEvidence} />{/each}
              </div>
            {/each}
          </details>
        {/if}

        {#if entry.diagnostics.length}
          <ul class="diagnostics" aria-label="Validator outcome">
            {#each entry.diagnostics as d, i (i)}
              <li class:error={d.severity === 'error'}><span class="mono">{d.severity} {d.code}</span>: {d.message}</li>
            {/each}
          </ul>
        {:else if entry.outcome === 'ok' && entry.channel !== 'ontology'}
          <p class="muted small">Checked against the published ontology: no findings.</p>
        {/if}
        {#if entry.detailError}<p class="alert small">The detail of this entry did not open: {entry.detailError}</p>{/if}

        <footer class="muted small">
          <a href="{resolve('/a/[acct]/audit', { acct: data.org.slug })}?request={encodeURIComponent(entry.requestId)}">Audit event</a> · request <span class="mono">{entry.requestId}</span>
        </footer>
      </li>
    {/each}
  </ol>
{/if}

<style>
  h1 {
    margin: 0;
  }
  .lede {
    margin: 0.2rem 0 0;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    margin: 1rem 0;
  }
  .filters label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .empty {
    padding: 1.25rem;
  }
  .empty p {
    margin: 0 0 0.3rem;
  }
  .events {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .event {
    display: grid;
    gap: 0.5rem;
    padding: 0.8rem 1rem;
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.75rem;
  }
  .channel {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--gilt);
  }
  .who {
    flex: 1 1 18rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  time {
    font-size: 0.8125rem;
  }
  .documents,
  .diagnostics {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .documents li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .diagnostics li.error {
    color: var(--destructive);
  }
  .reason {
    margin: 0;
    font-size: 0.875rem;
  }
  details summary {
    cursor: pointer;
    font-size: 0.85rem;
  }
  .group {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.4rem;
  }
  .small {
    font-size: 0.8125rem;
    margin: 0;
  }
  footer {
    overflow-wrap: anywhere;
  }
</style>
