<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
</script>

<svelte:head>
  <title>{page.status} · Docket Cloud</title>
</svelte:head>

<div class="error view-in">
  <p class="caption"><span class="docket-no">No. {page.status}</span> <span class="label">Docket Cloud</span></p>
  {#if page.status === 404}
    <h1>Not <em>found</em></h1>
  {:else}
    <h1>{page.error?.message ?? 'Something went wrong.'}</h1>
  {/if}
  <p class="lede">
    {#if page.status === 404}
      There is nothing here, or it belongs to an organisation you are not in.
    {:else if page.status === 403}
      Ask someone who manages access in this organisation if you need it.
    {:else}
      Try again in a moment.
    {/if}
  </p>
  <a class="button primary" href={resolve('/')}>Back to your organisations</a>
</div>

<style>
  .error {
    max-width: 40rem;
    margin: 0 auto;
    padding: 4rem 1rem;
  }
  .lede {
    margin-bottom: 1.5rem;
  }
</style>
