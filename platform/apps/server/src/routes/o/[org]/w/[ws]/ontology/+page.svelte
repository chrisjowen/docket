<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Download, FileUp, GitBranch, History } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import SchemaEditor from '$lib/components/schema/schema-editor.svelte'

  let { data, form } = $props()
  const ws = $derived({ org: data.org.slug, ws: data.workspace.slug })
  const otherDrafts = $derived(data.drafts.filter((draft) => draft.id !== data.draft?.id))
  const describe = (source: string) =>
    source.startsWith('template:') ? `the ${source.slice(9)} template` : source.startsWith('rollback:') ? source.slice(9) : source === 'import' ? 'an import' : 'the head'
</script>

<svelte:head>
  <title>Schema · {data.workspace.name}</title>
</svelte:head>

<div class="head">
  <div>
    <p class="caption"><span class="label">{data.draft ? `Schema v${data.draft.parentNumber + 1} · draft from v${data.draft.parentNumber}` : data.head ? `Schema v${data.head.number}` : 'Schema'}</span></p>
    <h1>The <em>schema</em></h1>
    <p class="muted state" data-testid="ontology-status">
      {#if data.draft}
        Editing a draft of v{data.draft.parentNumber + 1}, started by {data.draft.author} from {describe(data.draft.source)}.
        The head is {data.head ? `v${data.head.number}` : 'unpublished'}.
      {:else if data.head}
        v{data.head.number} is published. {data.propose ? 'Start a draft to change it: every change is checked against every document first.' : ''}
      {:else}
        Nothing is published yet.
      {/if}
    </p>
  </div>
  <div class="toolbar">
    <a class="button small" href={resolve('/o/[org]/w/[ws]/ontology/history', ws)}><History size={14} aria-hidden="true" /> History</a>
    {#if data.head}
      <a class="button small" href={resolve('/o/[org]/w/[ws]/ontology/export', ws)} download="entities.yaml">
        <Download size={14} aria-hidden="true" /> Export YAML
      </a>
    {/if}
    {#if data.draft}
      <a class="button small" href={resolve('/o/[org]/w/[ws]/ontology', ws)}>Close draft</a>
    {/if}
  </div>
</div>

{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}

{#if data.propose && !data.draft}
  <div class="start">
    <form method="POST" action="?/draft" class="card row">
      <Csrf token={data.csrf} />
      <GitBranch size={16} aria-hidden="true" />
      <label class="grow">
        <span class="visually-hidden">Start the draft from</span>
        <select name="from">
          <option value="head">{data.head ? `v${data.head.number}, the head` : 'a blank ontology'}</option>
          {#each data.templates as template (template.id)}<option value="template:{template.id}">the {template.name} template</option>{/each}
        </select>
      </label>
      <button class="button primary" type="submit">Start a draft</button>
    </form>
    <details class="card import">
      <summary><FileUp size={16} aria-hidden="true" /> Import an entities.yaml as a draft</summary>
      <form method="POST" action="?/import" enctype="multipart/form-data" class="stack">
        <Csrf token={data.csrf} />
        <label>File <input type="file" name="file" accept=".yaml,.yml,text/yaml" /></label>
        <label>or paste it <textarea name="yaml" rows="6" class="mono" spellcheck="false"></textarea></label>
        <div><button class="button" type="submit">Import as a draft</button></div>
        <p class="muted fine">An import never publishes on its own: it becomes a draft and goes through the same checks.</p>
      </form>
    </details>
    {#if data.drafts.length}
      <div class="card drafts">
        <h2>Open drafts</h2>
        <ul>
          {#each data.drafts as draft (draft.id)}
            <li>
              <a href="{resolve('/o/[org]/w/[ws]/ontology', ws)}?draft={draft.id}">{draft.message ?? `Draft from ${describe(draft.source)}`}</a>
              <span class="muted small">{draft.author} · against v{draft.parentNumber ?? 0} · {draft.updatedAt.slice(0, 16).replace('T', ' ')}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{:else if otherDrafts.length}
  <p class="muted small others">
    Other open drafts:
    {#each otherDrafts as draft, i (draft.id)}
      {#if i}, {/if}<a href="{resolve('/o/[org]/w/[ws]/ontology', ws)}?draft={draft.id}">{draft.message ?? draft.author}</a>
    {/each}
  </p>
{/if}

{#if data.draft || data.head}
  {#key data.draft?.id ?? 'head'}
    <SchemaEditor
      initial={data.draft?.yaml ?? data.head?.yaml ?? ''}
      draft={data.draft}
      head={data.head}
      canPublish={data.publish}
      csrf={data.csrf}
      urls={{
        check: resolve('/o/[org]/w/[ws]/ontology/check', ws),
        score: resolve('/o/[org]/w/[ws]/ontology/score', ws),
        convert: resolve('/o/[org]/w/[ws]/ontology/convert', ws),
      }}
      org={data.org.slug}
      usage={data.usage}
      vocabulary={data.vocabulary}
      trust={data.trust}
      problem={form && 'problem' in form ? (form.problem ?? null) : null}
      diagnostics={form && 'diagnostics' in form && Array.isArray(form.diagnostics) ? (form.diagnostics as string[]) : null}
    />
  {/key}
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
  }
  h1 {
    margin: 0 0 0.3rem;
    font: 400 clamp(36px, 4.6vw, 54px) / 0.98 var(--font-serif);
    letter-spacing: -0.015em;
  }
  h1 em {
    color: var(--signal);
  }
  .caption {
    margin: 0 0 8px;
  }
  .state {
    margin: 0;
    max-width: 48rem;
    font-size: 14px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .start {
    display: grid;
    gap: 0.6rem;
    margin-top: 1rem;
    max-width: 52rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
  }
  .grow {
    flex: 1;
    min-width: 14rem;
  }
  .import {
    padding: 0.7rem 0.9rem;
  }
  .import summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-weight: 500;
  }
  .import form {
    margin-top: 0.8rem;
  }
  .fine,
  .small {
    font-size: 0.8125rem;
    margin: 0;
  }
  .drafts {
    padding: 0.7rem 0.9rem;
  }
  .drafts h2 {
    font-size: 1rem;
    margin: 0 0 0.4rem;
  }
  .drafts ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  .drafts li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
  }
  .others {
    margin-top: 0.75rem;
  }
</style>
