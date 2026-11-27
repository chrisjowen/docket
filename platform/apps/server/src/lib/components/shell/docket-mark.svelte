<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /** Docket's mark, Docket Entries: a stem and four ruled entries whose ends trace a D, the newest in signal red. */
  let { size = 30 }: { size?: number } = $props()
</script>

<svg class="mark" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
  <rect x="4" y="5.25" width="4.25" height="21.5" rx="1.6" fill="var(--ink)" />
  <rect x="10.75" y="5.25" width="8.5" height="3.6" rx="1.8" fill="var(--ink)" />
  <rect x="10.75" y="11.25" width="16.25" height="3.6" rx="1.8" fill="var(--ink)" />
  <rect x="10.75" y="17.25" width="16.25" height="3.6" rx="1.8" fill="var(--ink)" />
  <rect x="10.75" y="23.15" width="8.5" height="3.6" rx="1.8" fill="var(--signal)" />
</svg>

<style>
  .mark {
    flex: none;
  }
</style>
