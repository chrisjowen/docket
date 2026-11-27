<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  import CitedText from './cited-text.svelte'

  /** What the reader must not miss: a record gone out of date, records that disagree, a gap in the record. */
  let { props }: ComponentRenderProps<{ tone?: 'note' | 'caution'; text?: string }> = $props()
</script>

{#if props.text}
  <p class="callout" class:caution={props.tone === 'caution'} data-testid="answer-callout">
    <span class="label">{props.tone === 'caution' ? 'Caution' : 'Note'}</span>
    <span><CitedText text={props.text} /></span>
  </p>
{/if}

<style>
  .callout {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
    margin: 0;
    padding: 10px 14px;
    border-left: 3px solid var(--rule-2);
    border-radius: 0 8px 8px 0;
    background: var(--sunk);
    font-size: 14.5px;
    overflow-wrap: anywhere;
  }
  .callout.caution {
    border-left-color: var(--warn);
    background: var(--warn-soft);
  }
</style>
