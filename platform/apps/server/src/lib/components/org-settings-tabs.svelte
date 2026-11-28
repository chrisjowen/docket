<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'

  /**
   * The account's Settings: AI for its owners, Roles for its admins (everyone
   * else who reaches Settings reads them), System accounts for whoever manages
   * system accounts somewhere.
   */
  let { org, active }: { org: string; active: 'ai' | 'roles' | 'system-accounts' } = $props()
  const data = $derived(page.data as { owner?: boolean; managesSystemAccounts?: boolean })
</script>

<nav class="subtabs" aria-label="Settings">
  {#if data.owner}
    <a href={resolve('/a/[org]/settings', { org })} aria-current={active === 'ai' ? 'page' : undefined}>AI</a>
  {/if}
  <a href={resolve('/a/[org]/settings/roles', { org })} aria-current={active === 'roles' ? 'page' : undefined}>Roles</a>
  {#if data.owner || data.managesSystemAccounts}
    <a href={resolve('/a/[org]/settings/system-accounts', { org })} aria-current={active === 'system-accounts' ? 'page' : undefined}>System accounts</a>
  {/if}
</nav>

<style>
  .subtabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0.5rem 0 1rem;
  }
  .subtabs a {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted-foreground);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .subtabs a:hover {
    color: var(--foreground);
  }
  .subtabs a[aria-current='page'] {
    color: var(--foreground);
    border-color: var(--gilt);
    background: color-mix(in srgb, var(--gilt) 12%, transparent);
  }
</style>
