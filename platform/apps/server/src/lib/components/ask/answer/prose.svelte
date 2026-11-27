<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  import CitedText from './cited-text.svelte'

  /** A paragraph of the answer, in serif, each citation a footnote. */
  let { props }: ComponentRenderProps<{ text?: string }> = $props()
</script>

{#if props.text}<p class="prose"><CitedText text={props.text} /></p>{/if}

<style>
  .prose {
    margin: 0;
    max-width: 64ch;
    font: 400 20px/1.55 var(--font-serif);
    overflow-wrap: anywhere;
  }
</style>
