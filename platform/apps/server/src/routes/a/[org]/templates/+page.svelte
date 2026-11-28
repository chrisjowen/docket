<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import { LayoutTemplate, Lock, Plus } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import { TYPES_SHOWN, typeLabel } from '$lib/ontology/catalogue'

  let { data, form } = $props()
  const full = $derived(data.templates.length >= data.max)
</script>

<svelte:head>
  <title>Templates · {data.org.name}</title>
</svelte:head>

<div class="head">
  <div>
    <h1>Templates</h1>
    <p class="muted lede">
      Save a docket's published ontology as one of {data.org.name}'s templates, and New docket offers it beside the built-in ones.
      A template holds the record types, relationships, sources and policies, never the documents. Whoever may change {data.org.name}'s
      settings sees and changes these, and no other account ever sees them.
    </p>
  </div>
  <a class="button" href={resolve('/a/[org]/dockets/new', { org: data.org.slug })}><Plus size={16} aria-hidden="true" /> New docket</a>
</div>

{#if form && 'flash' in form && form.flash}<p class="flash" role="status">{form.flash}</p>{/if}
{#if form && 'problem' in form && form.problem}<p class="alert" role="alert">{form.problem}</p>{/if}

<section class="card save" aria-labelledby="save-title">
  <h2 id="save-title">Save a docket as a template</h2>
  {#if !data.dockets.length}
    <p class="muted">No docket has a published ontology to save yet.</p>
  {:else if full}
    <p class="muted">{data.org.name} keeps {data.max} templates, the most it can. Delete one to save another.</p>
  {:else}
    <form method="POST" action="?/save" class="grid" use:enhance>
      <Csrf token={data.csrf} />
      <label>
        Docket
        <select name="workspace" required>
          {#each data.dockets as docket (docket.id)}<option value={docket.id}>{docket.name}</option>{/each}
        </select>
      </label>
      <label>
        Name
        <input name="name" required maxlength="80" placeholder="Field sales" />
      </label>
      <label class="wide">
        Description
        <textarea name="description" rows="2" maxlength="500" placeholder="What a docket started from it keeps track of."></textarea>
      </label>
      <label class="wide">
        Domain tags <span class="muted">(comma separated)</span>
        <input name="tags" maxlength="200" placeholder="sales, customers" />
      </label>
      <div class="wide"><button class="button primary" type="submit">Save as a template</button></div>
    </form>
  {/if}
</section>

<h2 class="section">Your account's templates <span class="muted n">{data.templates.length} of {data.max}</span></h2>
{#if data.templates.length}
  <ul class="templates">
    {#each data.templates as template (template.id)}
      <li class="card template" data-testid="org-template">
        <div class="title">
          <LayoutTemplate size={16} aria-hidden="true" />
          <strong>{template.name}</strong>
          {#each template.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
        </div>
        {#if template.description}<p class="muted summary">{template.description}</p>{/if}
        {#if template.types.length}
          <p class="types" aria-label="Record types">
            {#each template.types.slice(0, TYPES_SHOWN * 2) as type (type)}<span class="type">{typeLabel(type)}</span>{/each}
            {#if template.types.length > TYPES_SHOWN * 2}<span class="muted small">+{template.types.length - TYPES_SHOWN * 2} more</span>{/if}
          </p>
        {/if}
        <p class="muted small">
          {template.types.length} record types · {template.relationships} relationships{#if template.from} · from {template.from}{/if}
          · updated by {template.updatedBy} {template.updatedAt.slice(0, 16).replace('T', ' ')}
        </p>
        <details>
          <summary>Edit</summary>
          <div class="edit">
            <form method="POST" action="?/edit" class="grid" use:enhance>
              <Csrf token={data.csrf} />
              <input type="hidden" name="template" value={template.templateId} />
              <label>Name <input name="name" required maxlength="80" value={template.name} /></label>
              <label>Domain tags <input name="tags" maxlength="200" value={template.tags.join(', ')} /></label>
              <label class="wide">Description <textarea name="description" rows="2" maxlength="500" value={template.description}></textarea></label>
              <div class="wide"><button class="button small" type="submit">Save changes</button></div>
            </form>
            <form method="POST" action="?/update" class="row" use:enhance>
              <Csrf token={data.csrf} />
              <input type="hidden" name="template" value={template.templateId} />
              <label class="grow">
                Update it from
                <select name="workspace" required>
                  {#each data.dockets as docket (docket.id)}<option value={docket.id} selected={docket.id === template.fromId}>{docket.name}</option>{/each}
                </select>
              </label>
              <button class="button small" type="submit">Update from docket</button>
            </form>
            <form
              method="POST"
              action="?/delete"
              use:enhance={({ cancel }) => {
                if (!confirm(`Delete the "${template.name}" template? Dockets started from it keep their ontology.`)) cancel()
              }}
            >
              <Csrf token={data.csrf} />
              <input type="hidden" name="template" value={template.templateId} />
              <button class="button small danger" type="submit">Delete template</button>
            </form>
          </div>
        </details>
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted empty">None yet. Save a docket above, or use <strong>Save as a template</strong> in a docket's settings.</p>
{/if}

<h2 class="section">Built in <span class="muted n"><Lock size={13} aria-hidden="true" /> read-only</span></h2>
<ul class="templates">
  {#each data.builtIn as template (template.id)}
    <li class="card template builtin">
      <div class="title">
        <strong>{template.name}</strong>
        {#each template.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
      </div>
      <p class="muted summary">{template.description}</p>
      <p class="muted small">{template.types.length} record types · {template.relationships} relationships</p>
    </li>
  {/each}
</ul>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
  }
  .head .button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 0.4rem;
  }
  .lede {
    max-width: 46rem;
    margin: 0;
  }
  .save {
    max-width: 52rem;
    margin-top: 1.25rem;
    padding: 1rem 1.2rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0 0 0.6rem;
  }
  .section {
    margin-top: 1.8rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .n {
    font-size: 0.8125rem;
    font-weight: 400;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.7rem;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.6rem;
  }
  .grow {
    flex: 1;
    min-width: 12rem;
  }
  .templates {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: 0.7rem;
    max-width: 72rem;
  }
  .template {
    padding: 0.8rem 0.95rem;
    display: grid;
    align-content: start;
    gap: 0.4rem;
    min-width: 0;
  }
  .template p {
    margin: 0;
  }
  .builtin {
    opacity: 0.85;
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .tag {
    font-size: 0.75rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border);
  }
  .summary {
    font-size: 0.875rem;
  }
  .types {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .type {
    font-size: 0.75rem;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    background: color-mix(in srgb, currentColor 7%, transparent);
  }
  .small {
    font-size: 0.8125rem;
  }
  details summary {
    cursor: pointer;
    font-weight: 500;
    font-size: 0.875rem;
  }
  .edit {
    display: grid;
    gap: 0.8rem;
    margin-top: 0.7rem;
    padding-top: 0.7rem;
    border-top: 1px solid var(--border);
  }
  .danger {
    color: var(--danger, #b42318);
  }
  .empty {
    margin: 0;
  }
</style>
