<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Download, GitBranch, History, Undo2 } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()
  const ws = $derived({ org: data.org.slug, ws: data.workspace.slug })
  const head = $derived(data.versions[0]?.number ?? 0)
  const describeSource = (source: string) =>
    source.startsWith('template:')
      ? `from the ${source.slice(9)} template`
      : source.startsWith('copy:')
        ? `copied from ${source.slice(5)}`
        : source.startsWith('rollback:')
          ? `back to ${source.slice(9)}`
          : source === 'import'
            ? 'imported'
            : 'edited'
</script>

<svelte:head>
  <title>Ontology history · {data.workspace.name}</title>
</svelte:head>

<div class="head">
  <div>
    <h1><History size={24} aria-hidden="true" /> Ontology history</h1>
    <p class="muted">Every published version of {data.workspace.name}'s ontology. Versions are never rewritten: a rollback publishes a new one.</p>
  </div>
  <a class="button" href={resolve('/o/[org]/w/[ws]/ontology', ws)}>Back to the editor</a>
</div>

{#if data.published}<p class="flash" role="status">Published v{data.published}.</p>{/if}
{#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}

<ol class="versions">
  {#each data.versions as version (version.number)}
    <li class="card" data-version={version.number}>
      <div class="title">
        <strong class="number">v{version.number}</strong>
        {#if version.number === head}<span class="badge owner">head</span>{/if}
        <span class="badge {version.classification}">{version.classification}</span>
        {#if version.source.startsWith('mcp:')}<span class="badge" title="Published directly by an MCP client">via MCP</span>{/if}
        <span class="message">{version.message ?? describeSource(version.source)}</span>
        <span class="muted small">{version.publishedBy} · {version.publishedAt?.slice(0, 16).replace('T', ' ')}</span>
      </div>
      {#if version.changes.length}
        <ul class="changes" aria-label="Changes in v{version.number}">
          {#each version.changes as change, i (i)}
            <li class="op-{change.op === '+' ? 'add' : change.op === '-' ? 'remove' : 'change'}">
              <span class="op" aria-hidden="true">{change.op === '-' ? '−' : change.op}</span>
              {change.text.replace(/`/g, '')}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">No structural change.</p>
      {/if}
      {#if version.migration.length}
        <p class="small">Migration: <span class="mono">{version.migration.join(', ')}</span></p>
      {/if}
      {#if version.dispositions.length}
        <p class="small">Dispositions: <span class="mono">{version.dispositions.join(', ')}</span></p>
      {/if}
      {#if version.affected}
        <p class="small muted">Published anyway, with {version.affected} resource(s) gaining diagnostics.</p>
      {/if}
      <div class="actions">
        <a class="button small" href="{resolve('/o/[org]/w/[ws]/ontology/export', ws)}?v={version.number}" download="entities.yaml">
          <Download size={14} aria-hidden="true" /> Export
        </a>
        <details>
          <summary class="button small">YAML</summary>
          <pre class="mono">{version.yaml}</pre>
        </details>
        {#if version.number !== head}
          {#if data.propose}
            <form method="POST" action="?/draft">
              <Csrf token={data.csrf} />
              <input type="hidden" name="from" value={version.number} />
              <button class="button small" type="submit"><GitBranch size={14} aria-hidden="true" /> Open as draft</button>
            </form>
          {/if}
          {#if data.rollback}
            <form method="POST" action="?/rollback">
              <Csrf token={data.csrf} />
              <input type="hidden" name="to" value={version.number} />
              <input type="hidden" name="expectedHead" value={head} />
              <button class="button small" type="submit"><Undo2 size={14} aria-hidden="true" /> Roll back to v{version.number}</button>
            </form>
          {/if}
        {/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 2rem;
    margin: 0 0 0.4rem;
  }
  .versions {
    list-style: none;
    margin: 1.5rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
    max-width: 56rem;
  }
  .versions > li {
    padding: 0.9rem 1.1rem;
    min-width: 0;
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }
  .number {
    font-family: var(--font-serif);
    font-size: 1.25rem;
  }
  .message {
    font-weight: 500;
  }
  .small {
    font-size: 0.8125rem;
  }
  .changes {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    display: grid;
    gap: 0.1rem;
  }
  .changes li {
    overflow-wrap: anywhere;
  }
  .op {
    display: inline-block;
    width: 1.1rem;
    font-weight: 700;
  }
  .op-add .op {
    color: var(--ok);
  }
  .op-remove .op {
    color: var(--destructive);
  }
  .op-change .op {
    color: var(--warn);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: 0.4rem;
    margin-top: 0.7rem;
  }
  details summary {
    list-style: none;
  }
  details summary::-webkit-details-marker {
    display: none;
  }
  details[open] {
    flex-basis: 100%;
    order: 9;
  }
  pre {
    max-height: 22rem;
    overflow: auto;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--background);
    font-size: 0.78rem;
    white-space: pre;
  }
</style>
