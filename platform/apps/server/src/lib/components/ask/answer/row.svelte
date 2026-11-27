<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  import RecordLink from './record-link.svelte'

  /** A table's row; a table draws its rows itself, so this draws one found on its own, as its record and its cells. */
  let { props }: ComponentRenderProps<{ id?: string; cells?: string[] }> = $props()
</script>

{#if props.id}<RecordLink ref={props.id} note={(props.cells ?? []).join(' · ')} />{/if}
