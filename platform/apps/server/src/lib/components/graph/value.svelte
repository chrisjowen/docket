<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { isUrl } from '$lib/graph/model'

  import Self from './value.svelte'

  /** Any frontmatter value: scalars inline, URLs as links, lists and objects nested. */
  let { value, inline = false }: { value: unknown; inline?: boolean } = $props()

  /** A YAML date arrives as midnight UTC; show it as the date it was written as. */
  const shown = (scalar: string | number | boolean): string => String(scalar).replace(/^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/, '$1')
</script>

{#if value === null || value === undefined}
  <span class="muted">—</span>
{:else if isUrl(value)}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external URL a document states -->
  <a class="wrap" href={value} target="_blank" rel="noreferrer">{value}</a>
{:else if typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'}
  <span class="wrap">{shown(value)}</span>
{:else if Array.isArray(value)}
  {#if inline || value.every((item) => typeof item !== 'object' || item === null)}
    <span class="wrap">{value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ')}</span>
  {:else}
    <ul class="list">
      {#each value as item, index (index)}<li><Self value={item} /></li>{/each}
    </ul>
  {/if}
{:else if inline}
  <span class="mono small">{JSON.stringify(value)}</span>
{:else}
  <dl class="pairs">
    {#each Object.entries(value as Record<string, unknown>) as [key, item] (key)}
      <dt class="muted">{key}</dt>
      <dd><Self value={item} /></dd>
    {/each}
  </dl>
{/if}

<style>
  .wrap {
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 0.75rem;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.25rem;
  }
  .pairs {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.125rem 0.5rem;
    margin: 0;
    font-size: 0.75rem;
  }
  .pairs dd {
    margin: 0;
    min-width: 0;
  }
</style>
