<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import { BookCopy, FileUp, LayoutTemplate, Search, Settings2, Sparkles } from '@lucide/svelte'
  import { untrack } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import { TYPES_SHOWN, catalogueTags, filterCatalogue, typeLabel, type CatalogueKind } from '$lib/ontology/catalogue'

  let { data, form } = $props()

  const initial = untrack(() => (form && 'start' in form ? form : null))
  let name = $state(initial?.name ?? '')
  let slug = $state(initial?.slug ?? '')
  let slugEdited = $state(Boolean(initial?.slug))
  let start = $state(initial?.start ?? 'template')
  let chosen = $state(initial?.template || 'sdlc')
  let description = $state(initial && 'description' in initial ? String(initial.description ?? '') : '')
  let query = $state('')
  let kind = $state<CatalogueKind>('all')
  let tag = $state<string | null>(null)
  let submitting = $state(false)

  const suggested = $derived(
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40),
  )
  $effect(() => {
    if (!slugEdited) slug = suggested
  })
  const problemLines = $derived(form && 'diagnostics' in form && Array.isArray(form.diagnostics) ? (form.diagnostics as string[]) : [])

  const counts = $derived({
    all: data.catalogue.length,
    'built-in': data.catalogue.filter((card) => card.kind === 'built-in').length,
    org: data.catalogue.filter((card) => card.kind === 'org').length,
  })
  const tags = $derived(catalogueTags(data.catalogue.filter((card) => kind === 'all' || card.kind === kind)))
  const shown = $derived(filterCatalogue(data.catalogue, { query, kind, tag }))
  const picked = $derived(data.catalogue.find((card) => card.id === chosen))
  const KINDS: { value: CatalogueKind; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'built-in', label: 'Built in' },
    { value: 'org', label: 'Your organisation' },
  ]

  function clearFilters() {
    query = ''
    kind = 'all'
    tag = null
  }
</script>

<svelte:head>
  <title>New docket · {data.org.name}</title>
</svelte:head>

<h1>New docket</h1>
<p class="muted lede">
  A docket is an ontology, the documents that follow it, and later their graph. Dockets share
  {data.org.name}'s stores and keys, and each has its own ontology.
</p>

{#if data.drafts.length}
  <section class="card drafts" aria-label="Drafts waiting for review">
    <h2>Waiting for your review</h2>
    <ul>
      {#each data.drafts as draft (draft.id)}
        <li>
          <a href={resolve('/o/[org]/workspaces/new/draft/[id]', { org: data.org.slug, id: draft.id })}>{draft.name}</a>
          <span class="muted mono small">/w/{draft.slug}</span>
          <span class="muted small">drafted {draft.updatedAt.slice(0, 16).replace('T', ' ')}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if data.full}
  <p class="alert" role="alert">{data.org.name} already has {data.limit} dockets, the most the beta holds.</p>
{:else}
  <form
    method="POST"
    enctype="multipart/form-data"
    class="stack"
    use:enhance={() => {
      submitting = true
      return async ({ update }) => {
        await update({ reset: false })
        submitting = false
      }
    }}
  >
    <Csrf token={data.csrf} />
    <div class="card fields">
      <label>
        Name
        <input name="name" required maxlength="80" bind:value={name} placeholder="Platform" />
      </label>
      <label>
        Address
        <span class="slug">
          <span class="muted mono">/o/{data.org.slug}/w/</span>
          <input
            name="slug"
            required
            maxlength="40"
            pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
            bind:value={slug}
            oninput={() => (slugEdited = true)}
          />
        </span>
      </label>
    </div>

    <fieldset class="card start">
      <legend>Start the ontology from</legend>
      <div class="choices" role="radiogroup" aria-label="Start the ontology from">
        <label class="choice" class:on={start === 'template'}>
          <input type="radio" name="start" value="template" bind:group={start} />
          <LayoutTemplate size={18} aria-hidden="true" />
          <span>A template</span>
        </label>
        <label class="choice" class:on={start === 'describe'}>
          <input type="radio" name="start" value="describe" bind:group={start} />
          <Sparkles size={18} aria-hidden="true" />
          <span>Describe your domain</span>
        </label>
        <label class="choice" class:on={start === 'import'}>
          <input type="radio" name="start" value="import" bind:group={start} />
          <FileUp size={18} aria-hidden="true" />
          <span>An entities.yaml file</span>
        </label>
        <label class="choice" class:on={start === 'copy'} class:off={!data.copyable.length}>
          <input type="radio" name="start" value="copy" bind:group={start} disabled={!data.copyable.length} />
          <BookCopy size={18} aria-hidden="true" />
          <span>Another docket</span>
        </label>
      </div>

      {#if start === 'template'}
        <input type="hidden" name="template" value={chosen} />
        <div class="catalogue">
          <div class="toolbar">
            <label class="search">
              <Search size={16} aria-hidden="true" />
              <span class="visually-hidden">Search templates</span>
              <input type="search" bind:value={query} placeholder="Search by name, record type or domain" />
            </label>
            <div class="kinds" role="group" aria-label="Show templates">
              {#each KINDS as each (each.value)}
                <button
                  type="button"
                  class="kind"
                  aria-pressed={kind === each.value}
                  disabled={each.value === 'org' && !counts.org}
                  onclick={() => {
                    kind = each.value
                    if (tag && !catalogueTags(data.catalogue.filter((card) => each.value === 'all' || card.kind === each.value)).includes(tag)) tag = null
                  }}>{each.label} <span class="n">{counts[each.value]}</span></button
                >
              {/each}
            </div>
          </div>
          {#if tags.length}
            <div class="tags" role="group" aria-label="Domain">
              {#each tags as each (each)}
                <button type="button" class="tag" aria-pressed={tag === each} onclick={() => (tag = tag === each ? null : each)}>{each}</button>
              {/each}
            </div>
          {/if}

          {#if shown.length}
            <div class="cards" role="radiogroup" aria-label="Template" data-testid="template-catalogue">
              {#each shown as card (card.id)}
                <label class="template" class:on={chosen === card.id}>
                  <input type="radio" value={card.id} bind:group={chosen} />
                  <span class="title">
                    <strong>{card.name}</strong>
                    <span class="badge" class:org={card.kind === 'org'}>{card.kind === 'org' ? 'Organisation' : 'Built in'}</span>
                  </span>
                  <span class="muted summary">{card.description || 'No description.'}</span>
                  {#if card.types.length}
                    <span class="types" aria-label="Record types">
                      {#each card.types.slice(0, TYPES_SHOWN) as type (type)}<span class="type">{typeLabel(type)}</span>{/each}
                      {#if card.types.length > TYPES_SHOWN}<span class="more muted">+{card.types.length - TYPES_SHOWN} more</span>{/if}
                    </span>
                  {/if}
                  <span class="muted fine">
                    {card.types.length ? `${card.types.length} record type${card.types.length === 1 ? '' : 's'}` : 'No record types yet'}
                    · {card.relationships} relationship{card.relationships === 1 ? '' : 's'}
                  </span>
                </label>
              {/each}
            </div>
          {:else}
            <div class="empty muted">
              <p>No template matches.</p>
              <p>
                <button type="button" class="button small" onclick={clearFilters}>Show every template</button>
                <button type="button" class="button small" onclick={() => (start = 'describe')}><Sparkles size={14} aria-hidden="true" /> Describe your domain instead</button>
              </p>
            </div>
          {/if}
          <p class="muted fine picked">
            {#if picked}Starting from <strong>{picked.name}</strong>.{:else}Choose a template.{/if}
            {#if data.manageTemplates}
              <a href={resolve('/o/[org]/templates', { org: data.org.slug })}><Settings2 size={13} aria-hidden="true" /> Manage your organisation's templates</a>
            {/if}
          </p>
        </div>
      {:else if start === 'describe'}
        <div class="stack describe">
          <label>
            What should this docket keep track of?
            <textarea
              name="description"
              rows="6"
              maxlength={data.maxDescription}
              bind:value={description}
              placeholder="We run a veterinary clinic. We want to remember the pets we treat, their owners, appointments, treatments and the vets who give them, and which medicines each treatment used."
            ></textarea>
          </label>
          <p class="muted fine counter">{description.length} / {data.maxDescription}</p>
          <p class="muted fine">
            AI drafts the record types, their fields and the relationships between them, starting from the closest template, on
            {data.org.name}'s AI budget. The draft opens in the ontology editor with the usual change check: nothing is created until
            you review it and accept it.
          </p>
        </div>
      {:else if start === 'import'}
        <div class="stack">
          <label>
            Upload <span class="mono">.docket/entities.yaml</span>
            <input type="file" name="file" accept=".yaml,.yml,text/yaml" />
          </label>
          <label>
            or paste it
            <textarea name="yaml" rows="8" class="mono" spellcheck="false" placeholder="version: 1&#10;resourceTypes: …"></textarea>
          </label>
          <p class="muted fine">It is read with docket's loader; schema errors are reported with their paths.</p>
        </div>
      {:else}
        <label>
          Copy the published ontology of
          <select name="copyFrom">
            {#each data.copyable as workspace (workspace.id)}
              <option value={workspace.id}>{workspace.name}</option>
            {/each}
          </select>
        </label>
      {/if}
    </fieldset>

    {#if form?.problem}
      <div class="alert" role="alert">
        <p>{form.problem}</p>
        {#if problemLines.length}
          <ul class="mono">
            {#each problemLines as line, i (i)}<li>{line}</li>{/each}
          </ul>
        {/if}
      </div>
    {/if}
    <div class="actions">
      {#if start === 'describe'}
        <button class="button primary" type="submit" disabled={submitting}>
          <Sparkles size={16} aria-hidden="true" />
          {submitting ? 'Drafting… this can take a minute' : 'Draft with AI'}
        </button>
      {:else}
        <button class="button primary" type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create docket'}</button>
      {/if}
      <a class="button" href={resolve('/o/[org]', { org: data.org.slug })}>Cancel</a>
    </div>
  </form>
{/if}

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.4rem;
  }
  .lede {
    max-width: 44rem;
  }
  form,
  .drafts {
    max-width: 56rem;
    margin-top: 1.5rem;
  }
  .drafts {
    padding: 0.8rem 1rem;
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
  .fields,
  .start {
    padding: 1.1rem 1.25rem;
    display: grid;
    gap: 0.9rem;
  }
  fieldset {
    margin: 0;
    min-width: 0;
  }
  legend {
    font-weight: 600;
    padding: 0 0.3rem;
  }
  .slug {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }
  .slug input {
    flex: 1;
    min-width: 0;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.5rem;
  }
  .choice,
  .template {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.65rem 0.75rem;
    font-weight: 500;
  }
  .choice.on,
  .template.on {
    border-color: var(--gilt);
    background: color-mix(in srgb, var(--gilt) 8%, transparent);
  }
  .choice.off {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .choice input,
  .template input {
    accent-color: var(--gilt);
  }
  .catalogue {
    display: grid;
    gap: 0.7rem;
    min-width: 0;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .search {
    flex: 1 1 16rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    min-width: 0;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    padding-left: 0;
    padding-right: 0;
    background: transparent;
    box-shadow: none;
  }
  .kinds,
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .kind,
  .tag {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.3rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .kind[aria-pressed='true'],
  .tag[aria-pressed='true'] {
    border-color: var(--gilt);
    background: color-mix(in srgb, var(--gilt) 14%, transparent);
  }
  .kind:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .kind .n {
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.6rem;
  }
  .template {
    position: relative;
    display: grid;
    align-content: start;
    gap: 0.45rem;
    padding: 0.75rem 0.85rem;
    min-width: 0;
  }
  .template input {
    position: absolute;
    top: 0.85rem;
    right: 0.8rem;
    margin: 0;
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    padding-right: 1.4rem;
  }
  .badge {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--mute, inherit);
    white-space: nowrap;
  }
  .badge.org {
    border-color: var(--gilt);
  }
  .summary {
    font-size: 0.875rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
  .more {
    font-size: 0.75rem;
  }
  .empty {
    padding: 1rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
  .empty p {
    margin: 0 0 0.5rem;
  }
  .empty p:last-child {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .picked {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .picked a {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .counter {
    text-align: right;
    margin-top: -0.4rem;
  }
  .fine,
  .small {
    font-size: 0.8125rem;
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .actions .button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .alert p {
    margin: 0;
  }
  .alert ul {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    font-size: 0.8125rem;
  }
</style>
