<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import type { ComponentRenderProps } from '@openuidev/svelte-lang'

  import { sourceKey } from '$lib/ask/agent'
  import { typeCode } from '$lib/docket'

  import CitedText from './cited-text.svelte'
  import { answerContext } from './context'
  import { elementProps } from './elements'

  /** Records compared side by side: a row per record, linking it, its cells in the columns' order. */
  let { props }: ComponentRenderProps<{ columns?: string[]; rows?: unknown[] }> = $props()

  const ctx = answerContext()
  const columns = $derived(props.columns ?? [])
  const rows = $derived(elementProps<{ id?: string; cells?: string[] }>(props.rows))
</script>

<div class="wrap" data-testid="answer-table">
  <table>
    <thead>
      <tr>
        <th class="label" scope="col">Record</th>
        {#each columns as column, index (index)}<th class="label" scope="col">{column}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row, index (index)}
        {@const source = row.id ? ctx.resolve(row.id) : null}
        <tr class:on={source !== null && ctx.lit.key === sourceKey(source)}>
          <th scope="row">
            {#if source}
              <a
                href="{resolve('/a/[org]/d/[ws]/graph', { org: ctx.org, ws: source.workspace })}?focus={encodeURIComponent(source.id)}"
                style="--c: {ctx.colourOf(source.workspace, source.type)}"
                data-testid="answer-record"
                data-id={source.id}
                data-workspace={source.workspace}
                onmouseenter={() => (ctx.lit.key = sourceKey(source))}
                onmouseleave={() => (ctx.lit.key = null)}><span class="code">{typeCode(source.type)}</span> {source.title}</a
              >
            {:else}
              <span class="mono muted">{row.id ?? ''}</span>
            {/if}
          </th>
          {#each columns as _, cell (cell)}<td><CitedText text={row.cells?.[cell] ?? ''} /></td>{/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
    border: 1px solid var(--rule);
    border-radius: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th,
  td {
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--rule);
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }
  thead th {
    background: var(--sunk);
    white-space: nowrap;
  }
  tbody th {
    font-weight: 500;
    min-width: 160px;
  }
  tr.on {
    background: var(--sunk);
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
</style>
