<script lang="ts">
  /** Docket's mark, as Docket Cloud draws it: a D on an ink tile, with the red seal. */
  let { size = 28 }: { size?: number } = $props()
</script>

<svg class="shrink-0" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
  <rect width="32" height="32" rx="7" style="fill: var(--ink)" />
  <path d="M10 8h7a8 8 0 0 1 0 16h-7z" fill="none" stroke-width="3" style="stroke: var(--bg)" />
  <circle cx="24" cy="9" r="3" style="fill: var(--signal)" />
</svg>
