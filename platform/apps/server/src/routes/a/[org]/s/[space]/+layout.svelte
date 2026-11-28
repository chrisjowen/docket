<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { Plus } from '@lucide/svelte'

  let { data, children } = $props()

  const tabs = $derived([
    { label: 'Dockets', href: resolve('/a/[org]/s/[space]', { org: data.org.slug, space: data.space.slug }) },
    { label: 'Users & system accounts', href: resolve('/a/[org]/s/[space]/access', { org: data.org.slug, space: data.space.slug }) },
    // Storage and AI per space (tenancy v2 §5), for whoever may change settings here.
    ...(data.onSpace.settings ? [{ label: 'Settings', href: resolve('/a/[org]/s/[space]/settings', { org: data.org.slug, space: data.space.slug }) }] : []),
  ])
  const onNew = $derived(page.route.id === '/a/[org]/s/[space]/new')
</script>

{#if !onNew}
  <header class="space-head">
    <div class="titles">
      <p class="caption"><span class="label">Space</span>{#if data.space.general}<span class="label" aria-hidden="true">·</span><span class="label">Where {data.org.name} starts</span>{/if}</p>
      <h1>{data.space.name}</h1>
      {#if data.space.description}<p class="lede muted">{data.space.description}</p>{/if}
    </div>
    {#if data.onSpace.create}
      <a class="button primary" href={resolve('/a/[org]/s/[space]/new', { org: data.org.slug, space: data.space.slug })} data-testid="space-new-docket">
        <Plus size={16} aria-hidden="true" /> New docket
      </a>
    {/if}
  </header>

  <nav class="tabs" aria-label="{data.space.name} sections">
    {#each tabs as tab (tab.href)}
      <a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>{tab.label}</a>
    {/each}
  </nav>
{/if}

{@render children()}

<style>
  .space-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px 20px;
  }
  .titles {
    min-width: 0;
    flex: 1 1 22rem;
  }
  .caption {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 4px;
  }
  h1 {
    font-size: 2rem;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .lede {
    max-width: 44rem;
    margin: 0.4rem 0 0;
  }
  .space-head .button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin: 18px 0 20px;
    border-bottom: 1px solid var(--rule);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs a {
    flex: none;
    padding: 8px 12px;
    margin-bottom: -1px;
    border-bottom: 2px solid transparent;
    color: var(--mute);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .tabs a:hover {
    color: var(--ink);
  }
  .tabs a[aria-current='page'] {
    color: var(--ink);
    border-bottom-color: var(--signal);
  }
</style>
