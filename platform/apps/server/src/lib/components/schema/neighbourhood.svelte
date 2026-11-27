<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { relationsFrom, relationsTo, type OntologyModel } from '$lib/ontology/editor'
  import { typeColor } from '$lib/ontology/schema'

  interface Props {
    model: OntologyModel
    type: string
  }
  let { model, type }: Props = $props()

  type Row = { rel: string; name: string; y: number; w: number }

  // What the type points to (solid, right) and what points to it (dashed, left).
  const outgoing = $derived(
    relationsFrom(model, type).flatMap((relation) =>
      relation.definition.to === '*' ? [{ rel: relation.name, name: '*' }] : relation.definition.to.map((target) => ({ rel: relation.name, name: target })),
    ),
  )
  const incoming = $derived(relationsTo(model, type).flatMap((relation) => relation.from.map((from) => ({ rel: relation.name, name: from }))))

  const GAP = 84
  const width = (label: string) => Math.max(52, label.length * 6.6 + 24)
  const height = $derived(Math.max(110, Math.max(outgoing.length, incoming.length, 1) * 38 + 20))
  const cy = $derived(height / 2)
  const yOf = (index: number, count: number) => (count === 1 ? height / 2 : 20 + index * ((height - 40) / (count - 1)))
  const lay = (rows: { rel: string; name: string }[]): Row[] => rows.map((row, i) => ({ ...row, y: yOf(i, rows.length), w: width(row.name === '*' ? 'any type' : row.name) }))
  const right = $derived(lay(outgoing))
  const left = $derived(lay(incoming))
  const centre = $derived(width(type))
  // As wide as what it draws: the incoming column, the type, the outgoing column.
  const leftW = $derived(left.length ? Math.max(...left.map((row) => row.w)) + GAP : 0)
  const rightW = $derived(right.length ? Math.max(...right.map((row) => row.w)) + GAP : 0)
  const cl = $derived(leftW)
  const cr = $derived(leftW + centre)
  const CX = $derived(leftW + centre / 2)
  const outX = $derived(cr + GAP)
  const inEdge = $derived(leftW - GAP)
  const total = $derived(leftW + centre + rightW)
</script>

<svg class="hood" viewBox="-2 0 {total + 4} {height}" width={total + 4} height={height} role="img" aria-label="{type} and the types it connects to">
  {#each right as row (`${row.rel}-${row.name}`)}
    <path class="edge" d="M{cr} {cy} C{cr + 30} {cy}, {outX - 30} {row.y}, {outX} {row.y}" />
  {/each}
  {#each left as row (`${row.rel}-${row.name}`)}
    <path class="edge in" d="M{inEdge} {row.y} C{inEdge + 30} {row.y}, {cl - 30} {cy}, {cl} {cy}" />
  {/each}
  {#each right as row (`${row.rel}-${row.name}`)}
    {@render node(outX, row.y, row.w, row.name)}
    <text class="rel" x={outX - 4} y={row.y - 5} text-anchor="end">{row.rel}</text>
  {/each}
  {#each left as row (`${row.rel}-${row.name}`)}
    {@render node(inEdge - row.w, row.y, row.w, row.name)}
    <text class="rel" x={inEdge + 4} y={row.y - 5}>{row.rel}</text>
  {/each}
  <g class="centre">
    <rect x={cl} y={cy - 13} width={centre} height="26" rx="7" />
    <text x={CX} y={cy + 4} text-anchor="middle">{type}</text>
  </g>
</svg>

{#snippet node(x: number, y: number, w: number, name: string)}
  <g class="node">
    <rect x={x} y={y - 13} width={w} height="26" rx="7" />
    {#if name === '*'}
      <text x={x + 10} y={y + 4}>any type</text>
    {:else}
      <rect class="swatch" x={x + 8} y={y - 4} width="8" height="8" rx="2" style="fill: {typeColor(name)}" />
      <text x={x + 22} y={y + 4}>{name}</text>
    {/if}
  </g>
{/snippet}

<style>
  /* Drawn at its own size, never shrunk: a narrow card scrolls it. */
  .hood {
    display: block;
    margin: 6px auto;
  }
  .edge {
    fill: none;
    stroke: var(--rule-2);
    stroke-width: 1.4;
  }
  .edge.in {
    stroke-dasharray: 3 3;
  }
  .node rect:not(.swatch) {
    fill: var(--paper);
    stroke: var(--rule-2);
  }
  .centre rect {
    fill: var(--ink);
    stroke: var(--ink);
  }
  .centre text {
    fill: var(--bg);
  }
  text {
    font: 500 11px var(--font-sans);
    fill: var(--ink);
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 3px;
  }
  .centre text {
    stroke: var(--ink);
  }
  .rel {
    font: 9.5px var(--font-mono);
    fill: var(--mute);
  }
</style>
