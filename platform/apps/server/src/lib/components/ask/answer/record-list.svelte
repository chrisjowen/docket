<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  import { elementProps } from './elements'
  import RecordLink from './record-link.svelte'

  /** Several records, each a link into the graph, under a title. */
  let { props }: ComponentRenderProps<{ title?: string; items?: unknown[] }> = $props()

  const items = $derived(elementProps<{ id?: string; note?: string }>(props.items))
</script>

<section class="list" data-testid="answer-list">
  {#if props.title}<h3 class="label">{props.title}</h3>{/if}
  <ul>
    {#each items as item, index (index)}
      {#if item.id}<li><RecordLink ref={item.id} note={item.note} /></li>{/if}
    {/each}
  </ul>
</section>

<style>
  .list {
    display: grid;
    gap: 4px;
  }
  h3 {
    margin: 0 0 2px;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 1px;
  }
</style>
