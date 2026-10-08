<script lang="ts">
  import type { CanonicalReference, TableBlock, TableCell, TableColumn } from '@docket/contracts'
  import { resolves } from '$lib/ask/evidence.js'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import EvidenceChips from '../evidence-chips.svelte'
  import { getAskView } from '../view.js'

  let { block, result }: { block: TableBlock; result: AnsweredResult } = $props()

  const workspace = getWorkspace()
  const view = getAskView()
  const titleOf = (id: string): string => workspace.graph?.entities.find((entity) => entity.id === id)?.title ?? id
  const withEvidence = $derived(block.rows.some((row) => (row.evidenceIds?.length ?? 0) > 0))
  const numeric = (column: TableColumn): boolean => ['number', 'integer', 'decimal'].includes(column.type)

  const isReference = (cell: TableCell): cell is CanonicalReference => typeof cell === 'object' && cell !== null

  /** A cell as its column's type says: numbers keep every digit they were sent with. */
  const shown = (cell: TableCell, column: TableColumn): string => {
    if (cell === null) return '—'
    if (column.type === 'boolean') return cell === true ? 'yes' : 'no'
    if (column.type === 'integer' && typeof cell === 'number') return cell.toLocaleString()
    if (column.type === 'datetime' && typeof cell === 'string') {
      const date = new Date(cell)
      if (!Number.isNaN(date.getTime())) return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }
    return String(cell)
  }
</script>

<div class="overflow-x-auto rounded-md border">
  <table class="w-full border-collapse text-sm">
    <thead class="bg-muted/60 text-muted-foreground text-left text-xs">
      <tr>
        {#each block.columns as column (column.key)}
          <th scope="col" class="px-3 py-1.5 font-medium {numeric(column) ? 'text-right' : ''}" title={column.type}>{column.label}</th>
        {/each}
        {#if withEvidence}<th scope="col" class="px-3 py-1.5 font-medium">Evidence</th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each block.rows as row, index (index)}
        <tr class="border-t align-top">
          {#each block.columns as column (column.key)}
            {@const cell = row.cells[column.key] ?? null}
            <td class="px-3 py-1.5 {numeric(column) ? 'text-right font-mono tabular-nums' : ''} {column.type === 'datetime' || column.type === 'date' ? 'whitespace-nowrap tabular-nums' : ''}">
              {#if column.type === 'reference' && isReference(cell)}
                {#if resolves(cell, view.casebook) && cell.kind === 'entity'}
                  <button type="button" class="underline-offset-2 hover:underline" onclick={() => workspace.select(cell.id)}>{titleOf(cell.id)}</button>
                {:else}
                  <code class="font-mono text-xs" title="Not resolved against the casebook">{cell.id}</code>
                {/if}
              {:else}
                <span class={cell === null ? 'text-muted-foreground' : ''} title={typeof cell === 'string' ? cell : undefined}>{shown(cell, column)}</span>
              {/if}
            </td>
          {/each}
          {#if withEvidence}<td class="px-3 py-1.5"><EvidenceChips ids={row.evidenceIds ?? []} {result} /></td>{/if}
        </tr>
      {:else}
        <tr><td colspan={block.columns.length + (withEvidence ? 1 : 0)} class="text-muted-foreground px-3 py-2 text-xs">No rows.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
<EvidenceChips ids={block.evidenceIds} {result} />
