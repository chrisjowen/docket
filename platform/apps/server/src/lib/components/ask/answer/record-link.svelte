<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowRight } from '@lucide/svelte'

  import { sourceKey } from '$lib/ask/agent'
  import { typeCode } from '$lib/docket'

  import CitedText from './cited-text.svelte'
  import { answerContext } from './context'

  /**
   * A record the answer names, as a row linking into the graph: its type's
   * code in its colour, its title and id, and why it matters. A record the
   * agent never looked up is named but not linked.
   */
  let { ref, note, card = false }: { ref: string; note?: string | undefined; card?: boolean } = $props()

  const ctx = answerContext()
  const source = $derived(ctx.resolve(ref))
  const key = $derived(source ? sourceKey(source) : null)
</script>

{#if source}
  <a
    class="record"
    class:card
    class:on={key !== null && ctx.lit.key === key}
    style="--c: {ctx.colourOf(source.workspace, source.type)}"
    href="{resolve('/a/[org]/d/[ws]/graph', { org: ctx.org, ws: source.workspace })}?focus={encodeURIComponent(source.id)}"
    data-testid="answer-record"
    data-id={source.id}
    data-workspace={source.workspace}
    onmouseenter={() => (ctx.lit.key = key)}
    onmouseleave={() => (ctx.lit.key = null)}
  >
    <span class="code">{typeCode(source.type)}</span>
    <span class="body">
      <span class="head"><b>{source.title}</b><span class="mono muted">{source.id}</span>{#if source.stale}<span class="stamp warn">Stale</span>{/if}</span>
      {#if note}<span class="note"><CitedText text={note} /></span>{/if}
      {#if ctx.many}<span class="muted small">{ctx.docketName(source.workspace)}</span>{/if}
    </span>
    {#if card}<span class="open small">Open the case file <ArrowRight size={13} aria-hidden="true" /></span>{/if}
  </a>
{:else}
  <div class="record missing" class:card data-testid="answer-record-missing">
    <span class="code">?</span>
    <span class="body">
      <span class="head"><span class="mono">{ref}</span><span class="stamp">Not on the record</span></span>
      {#if note}<span class="note">{note}</span>{/if}
    </span>
  </div>
{/if}

<style>
  .record {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 9px 10px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
    transition: background 0.15s;
    overflow-wrap: anywhere;
  }
  a.record:hover,
  .record.on {
    background: var(--sunk);
  }
  .record.card {
    padding: 14px 16px;
    border: 1px solid var(--rule);
    border-left: 4px solid var(--c, var(--rule));
    border-radius: 10px;
    background: var(--paper);
  }
  .body {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
  }
  .head .mono {
    font-size: 12px;
  }
  .note {
    font-size: 14px;
  }
  .small {
    font-size: 12.5px;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--signal);
    white-space: nowrap;
  }
  .missing {
    opacity: 0.75;
  }
  @media (max-width: 640px) {
    .record {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .open {
      grid-column: 2;
    }
  }
</style>
