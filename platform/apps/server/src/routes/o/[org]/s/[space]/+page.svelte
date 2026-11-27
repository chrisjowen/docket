<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Lock, Plus } from '@lucide/svelte'

  let { data } = $props()
  /** Docket numbers run across the account, as the sidebar shows them. */
  const numbers = $derived(new Map(data.dockets.map((docket) => [docket.slug, docket.docketNo])))
  const updated = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
</script>

<svelte:head>
  <title>{data.space.name} · {data.org.name}</title>
</svelte:head>

<p class="you muted">
  Your access here: <span class="badge" data-testid="space-access">{data.you}</span>
</p>

{#if data.inSpace.length}
  <ul class="cards" aria-label="Dockets in {data.space.name}">
    {#each data.inSpace as docket (docket.slug)}
      <li class="card docket" data-docket={docket.slug}>
        <span class="mono no muted">{numbers.get(docket.slug) ?? ''}</span>
        {#if docket.open}
          <a class="name" href={resolve('/o/[org]/w/[ws]/overview', { org: data.org.slug, ws: docket.slug })}>{docket.name}</a>
          <p class="meta">
            {#if docket.standing === 'active'}<span class="status"><i></i>Active</span>{:else}<span class="status warn"><i></i>Dormant</span>{/if}
            <span class="mono">{docket.documents} {docket.documents === 1 ? 'document' : 'documents'}</span>
            {#if docket.updatedAt}<span class="mono muted">updated {updated(docket.updatedAt)}</span>{/if}
          </p>
        {:else}
          <span class="name muted">{docket.name}</span>
          <p class="meta muted"><Lock size={13} aria-hidden="true" /> You have no access to this docket.</p>
        {/if}
      </li>
    {/each}
  </ul>
{:else}
  <div class="card empty">
    <p class="muted">No dockets in {data.space.name} yet.</p>
    {#if data.onSpace.create}
      <a class="button primary" href={resolve('/o/[org]/s/[space]/new', { org: data.org.slug, space: data.space.slug })}>
        <Plus size={16} aria-hidden="true" /> New docket in {data.space.name}
      </a>
    {/if}
  </div>
{/if}

<style>
  .you {
    margin: 0 0 14px;
    font-size: 0.875rem;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: 12px;
  }
  .docket {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    min-width: 0;
  }
  .no {
    font-size: 11px;
  }
  .name {
    font: 400 1.35rem/1.15 var(--font-serif);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a.name:hover {
    color: var(--signal);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin: 0;
    font-size: 0.8125rem;
  }
  .empty {
    display: grid;
    justify-items: start;
    gap: 10px;
    padding: 1.1rem 1.25rem;
  }
  .empty p {
    margin: 0;
  }
  .empty .button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
