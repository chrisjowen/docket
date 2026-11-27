<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'

  import { answerSegments, sourceKey } from '$lib/ask/agent'

  import { answerContext } from './context'

  /** Prose with each `[ref]` citation of a record the agent found as a numbered footnote linking into the graph. */
  let { text }: { text: string } = $props()

  const ctx = answerContext()
  const segments = $derived(answerSegments(text, ctx.resolve))
</script>

{#each segments as segment, index (index)}{#if 'cite' in segment}{@const key = sourceKey(segment.cite)}<a
      class="fn"
      class:on={ctx.lit.key === key}
      href="{resolve('/o/[org]/w/[ws]/graph', { org: ctx.org, ws: segment.cite.workspace })}?focus={encodeURIComponent(segment.cite.id)}"
      aria-label="Footnote {ctx.footnote(segment.cite)}: {segment.cite.title}"
      data-testid="answer-cite"
      data-id={segment.cite.id}
      onmouseenter={() => (ctx.lit.key = key)}
      onmouseleave={() => (ctx.lit.key = null)}
      onfocus={() => (ctx.lit.key = key)}
      onblur={() => (ctx.lit.key = null)}>{ctx.footnote(segment.cite)}</a
    >{:else}{segment.text}{/if}{/each}

<style>
  .fn {
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    margin: 0 1px 0 2px;
    vertical-align: super;
    border-radius: 4px;
    background: var(--signal-soft);
    color: var(--signal);
    font: 600 10px/1 var(--font-mono);
    text-decoration: none;
    transition:
      background 0.15s,
      box-shadow 0.2s;
  }
  .fn:hover,
  .fn.on {
    background: var(--signal);
    color: var(--signal-ink);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--signal) 22%, transparent);
  }
</style>
