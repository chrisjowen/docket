<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /**
   * Initials, never a remote image: the CSP allows images from this origin
   * only, and the page loads nothing from GitHub.
   */
  let { login, name = null }: { login: string; name?: string | null } = $props()
  const initials = $derived(
    (name ?? login)
      .split(/[\s-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?',
  )
</script>

<span class="avatar" aria-hidden="true">{initials}</span>

<style>
  .avatar {
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 999px;
    background: var(--secondary);
    border: 1px solid var(--border);
    color: var(--foreground);
    font-size: 0.65rem;
    font-weight: 700;
    flex: none;
  }
</style>
