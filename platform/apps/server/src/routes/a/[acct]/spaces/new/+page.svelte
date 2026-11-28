<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import { untrack } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()

  const initial = untrack(() => form)
  let name = $state(initial?.name ?? '')
  let slug = $state(initial?.slug ?? '')
  let slugEdited = $state(Boolean(initial?.slug))
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
</script>

<svelte:head>
  <title>New space · {data.org.name}</title>
</svelte:head>

<h1>New space</h1>
<p class="muted lede">
  A space groups dockets for a team, a department or a client. A role on a space covers every docket in it, including ones added
  later, so you give people access once. Admins on the space see every docket in it: to keep something from them, put it in
  another space.
</p>

<form
  method="POST"
  class="card fields"
  use:enhance={() => {
    submitting = true
    return async ({ update }) => {
      await update({ reset: false })
      submitting = false
    }
  }}
>
  <Csrf token={data.csrf} />
  <label>
    Name
    <input name="name" required maxlength="80" bind:value={name} placeholder="Engineering" />
  </label>
  <label>
    Address
    <span class="slug">
      <span class="muted mono">/a/{data.org.slug}/s/</span>
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
  <label>
    What it is for <span class="muted">(optional)</span>
    <textarea name="description" rows="2" maxlength="300" placeholder="The platform, payments and incident dockets">{initial?.description ?? ''}</textarea>
  </label>
  {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
  <p class="muted fine">Next you choose who gets access to it, then add its dockets with its +.</p>
  <div class="actions">
    <button class="button primary" type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create space'}</button>
    <a class="button" href={resolve('/a/[acct]', { acct: data.org.slug })}>Cancel</a>
  </div>
</form>

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.4rem;
  }
  .lede {
    max-width: 44rem;
  }
  .fields {
    max-width: 40rem;
    margin-top: 1.5rem;
    padding: 1.1rem 1.25rem;
    display: grid;
    gap: 0.9rem;
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
  .fine {
    font-size: 0.8125rem;
    margin: 0;
  }
  .alert {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
