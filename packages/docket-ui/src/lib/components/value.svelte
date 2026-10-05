<script lang="ts">
  import { isUrl } from '$lib/model.js'
  import Self from './value.svelte'

  /** Any frontmatter value: scalars inline, URLs as links, lists and objects nested. */
  let { value, inline = false }: { value: unknown; inline?: boolean } = $props()

  /** A YAML date arrives as midnight UTC; show it as the date it was written as. */
  const shown = (scalar: string | number | boolean): string =>
    String(scalar).replace(/^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/, '$1')
</script>

{#if value === null || value === undefined}
  <span class="text-muted-foreground">—</span>
{:else if isUrl(value)}
  <a class="break-all underline underline-offset-2" href={value} target="_blank" rel="noreferrer">{value}</a>
{:else if typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'}
  <span class="break-words">{shown(value)}</span>
{:else if Array.isArray(value)}
  {#if inline || value.every((item) => typeof item !== 'object' || item === null)}
    <span class="break-words">{value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ')}</span>
  {:else}
    <ul class="flex flex-col gap-1">
      {#each value as item, index (index)}<li><Self value={item} /></li>{/each}
    </ul>
  {/if}
{:else if inline}
  <span class="font-mono text-xs">{JSON.stringify(value)}</span>
{:else}
  <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
    {#each Object.entries(value as Record<string, unknown>) as [key, item] (key)}
      <dt class="text-muted-foreground">{key}</dt>
      <dd class="min-w-0"><Self value={item} /></dd>
    {/each}
  </dl>
{/if}
