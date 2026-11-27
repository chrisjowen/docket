<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  import RecordLink from './record-link.svelte'

  /** One record the answer is about, as a case card. */
  let { props }: ComponentRenderProps<{ id?: string; note?: string }> = $props()
</script>

{#if props.id}<RecordLink ref={props.id} note={props.note} card />{/if}
