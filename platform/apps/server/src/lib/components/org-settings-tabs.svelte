<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'

  /**
   * The account's Settings: AI for whoever may change settings on the whole account, Roles for its admins (everyone
   * else who reaches Settings reads them), System accounts for whoever manages
   * system accounts somewhere.
   */
  let { org, active }: { org: string; active: 'ai' | 'roles' | 'system-accounts' } = $props()
  const data = $derived(page.data as { owner?: boolean; managesSystemAccounts?: boolean; permissions?: { settings?: boolean } })
</script>

<nav class="subtabs" aria-label="Settings">
  {#if data.permissions?.settings}
    <a href={resolve('/a/[acct]/settings', { acct: org })} aria-current={active === 'ai' ? 'page' : undefined}>AI</a>
  {/if}
  <a href={resolve('/a/[acct]/settings/roles', { acct: org })} aria-current={active === 'roles' ? 'page' : undefined}>Roles</a>
  {#if data.owner || data.managesSystemAccounts}
    <a href={resolve('/a/[acct]/settings/system-accounts', { acct: org })} aria-current={active === 'system-accounts' ? 'page' : undefined}>System accounts</a>
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
