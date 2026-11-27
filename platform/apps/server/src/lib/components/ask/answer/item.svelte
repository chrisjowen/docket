<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  import RecordLink from './record-link.svelte'

  /** One record of a list; a list draws its items itself, so this draws one found on its own. */
  let { props }: ComponentRenderProps<{ id?: string; note?: string }> = $props()
</script>

{#if props.id}<RecordLink ref={props.id} note={props.note} />{/if}
