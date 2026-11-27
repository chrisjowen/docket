<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowLeft, Share2 } from '@lucide/svelte'

  let { data } = $props()

  const ws = $derived({ org: data.org.slug, ws: data.workspace.slug })
  const doc = $derived({ ...ws, path: data.document.path })
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
</script>

<svelte:head>
  <title>{data.document.title ?? data.document.resourceId} · {data.workspace.name}</title>
</svelte:head>

<p class="back">
  <a href={resolve('/o/[org]/w/[ws]/documents', ws)}><ArrowLeft size={14} aria-hidden="true" /> Documents</a>
</p>
<h1>{data.document.title ?? data.document.resourceId}</h1>
<p class="muted meta">
  <span class="mono">{data.document.resourceId}</span> · <span class="mono">{data.document.resourceType}</span> ·
  <span class="badge">{data.document.origin}</span>
  · revision {data.document.revision} · <span class="mono">{data.document.path}</span>
</p>
<p>
  <a class="button small" href="{resolve('/o/[org]/w/[ws]/graph', ws)}#{encodeURIComponent(data.document.resourceId)}">
    <Share2 size={14} aria-hidden="true" /> Show in graph
  </a>
</p>

<div class="layout">
  <section class="card text" aria-label="Document text" data-testid="document-text">
    {#if !data.shown.current}
      <p class="flash" role="status">
        Revision {data.shown.revision} of {data.document.revision}. <a href={resolve('/o/[org]/w/[ws]/documents/[...path]', doc)}>Show the current text</a>
      </p>
    {/if}
    {#if data.shown.error}
      <p class="alert" role="alert">{data.shown.error}</p>
    {:else}
      {#if data.shown.frontmatter !== null}
        <h2>Frontmatter</h2>
        <pre class="frontmatter" data-testid="document-frontmatter">{data.shown.frontmatter}</pre>
      {/if}
      <h2>Body</h2>
      {#if data.shown.body.trim()}
        <pre class="body" data-testid="document-body">{data.shown.body}</pre>
      {:else}
        <p class="muted">No body: everything is in the frontmatter.</p>
      {/if}
    {/if}
  </section>

  <aside class="card revisions" aria-label="Revisions">
    <h2>Revisions</h2>
    <ol>
      {#each data.revisions as revision (revision.revision)}
        <li aria-current={revision.revision === data.shown.revision ? 'true' : undefined}>
          <a href="{resolve('/o/[org]/w/[ws]/documents/[...path]', doc)}?rev={revision.revision}">Revision {revision.revision}</a>
          <span class="muted small">{revision.createdBy} · <time datetime={revision.createdAt}>{when(revision.createdAt)}</time></span>
        </li>
      {/each}
    </ol>
  </aside>
</div>

<style>
  .back {
    margin: 0 0 0.5rem;
  }
  .back a {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.875rem;
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 0.4rem;
    overflow-wrap: anywhere;
  }
  .meta {
    overflow-wrap: anywhere;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 16rem;
    gap: 1rem;
    align-items: start;
    margin-top: 1rem;
    max-width: 72rem;
  }
  .card {
    padding: 1rem 1.1rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
  }
  pre {
    margin: 0 0 1rem;
    padding: 0.75rem 0.9rem;
    border-radius: var(--radius);
    background: var(--muted);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .revisions ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .revisions li {
    display: grid;
    padding-left: 0.5rem;
    border-left: 3px solid transparent;
  }
  .revisions li[aria-current='true'] {
    border-left-color: var(--gilt);
  }
  .small {
    font-size: 0.8125rem;
  }
  @media (max-width: 760px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
