<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'

  import { SETTINGS_TABS, type SettingsTab } from '$lib/how-it-works'

  let { org, ws, active }: { org: string; ws: string; active: SettingsTab } = $props()
</script>

<nav class="subtabs" aria-label="Settings">
  {#each SETTINGS_TABS as tab (tab.key)}
    <a href={resolve(tab.route, { acct: org, docket: ws })} aria-current={active === tab.key ? 'page' : undefined}>{tab.label}</a>
  {/each}
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
