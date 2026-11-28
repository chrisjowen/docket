<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'

  /** The operator console's pages: every account, and the beta waitlist. */
  let { active }: { active: 'accounts' | 'waitlist' } = $props()
</script>

<nav class="subtabs" aria-label="Operator console">
  <a href={resolve('/admin/accounts')} aria-current={active === 'accounts' ? 'page' : undefined}>Accounts</a>
  <a href={resolve('/admin/waitlist')} aria-current={active === 'waitlist' ? 'page' : undefined}>Waitlist</a>
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
