<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { untrack } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()

  // A refused submission comes back with what was typed; start from it.
  let name = $state(untrack(() => form?.name ?? ''))
  let slug = $state(untrack(() => form?.slug ?? ''))
  let slugEdited = $state(untrack(() => Boolean(form?.slug)))
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
</script>

<svelte:head>
  <title>New organisation · Docket Cloud</title>
</svelte:head>

<div class="narrow">
  <h1>New organisation</h1>
  <p class="muted">
    An organisation is your team's isolation unit: its own Postgres schema and role, its own data key, and later
    its own Neo4j database and Qdrant collections. You will be its owner.
  </p>

  {#if data.full}
    <p class="alert" role="alert">The beta is full: it holds {data.limit} organisations.</p>
  {:else}
    <form method="POST" class="stack card">
      <Csrf token={data.csrf} />
      <label>
        Name
        <input name="name" required maxlength="80" bind:value={name} autocomplete="organization" />
      </label>
      <label>
        Address
        <span class="slug">
          <span class="muted">/a/</span>
          <input
            name="slug"
            required
            maxlength="40"
            pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
            bind:value={slug}
            oninput={() => (slugEdited = true)}
          />
        </span>
        <span class="muted hint">Lowercase letters, digits and hyphens. It appears in URLs and MCP endpoints.</span>
      </label>
      {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
      <div>
        <button class="button primary" type="submit">Create organisation</button>
        <a class="button" href={resolve('/')}>Cancel</a>
      </div>
    </form>
  {/if}
</div>

<style>
  .narrow {
    max-width: 36rem;
    margin: 0 auto;
    padding: 0.5rem 0 1rem;
  }
  form.card {
    padding: 1.25rem;
    margin-top: 1.5rem;
  }
  .slug {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .slug input {
    flex: 1;
  }
  .hint {
    font-weight: 400;
    font-size: 0.8125rem;
  }
</style>
