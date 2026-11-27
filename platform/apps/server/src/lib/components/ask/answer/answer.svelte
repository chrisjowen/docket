<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  /** The answer: its parts top to bottom. */
  let { props, renderNode }: ComponentRenderProps<{ children?: unknown[] }> = $props()
</script>

<div class="answer-ui" data-testid="answer-ui">{@render renderNode(props.children ?? [])}</div>

<style>
  .answer-ui {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
</style>
