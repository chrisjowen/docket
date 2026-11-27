<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'

  /** The account's Settings: AI for its owners, System accounts for everyone who manages access. */
  let { org, active, owner }: { org: string; active: 'ai' | 'system-accounts'; owner: boolean } = $props()
</script>

<nav class="subtabs" aria-label="Settings">
  {#if owner}
    <a href={resolve('/o/[org]/settings', { org })} aria-current={active === 'ai' ? 'page' : undefined}>AI</a>
  {/if}
  <a href={resolve('/o/[org]/settings/system-accounts', { org })} aria-current={active === 'system-accounts' ? 'page' : undefined}>System accounts</a>
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
