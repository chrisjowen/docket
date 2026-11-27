<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  /** A section's heading in a longer answer. */
  let { props }: ComponentRenderProps<{ text?: string }> = $props()
</script>

{#if props.text}<h3 class="label">{props.text}</h3>{/if}

<style>
  h3 {
    margin: 6px 0 -4px;
  }
</style>
