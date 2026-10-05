<script lang="ts">
  import { blocks, type Inline } from '$lib/model.js'

  interface Props {
    content: string
    /** Title of a mentioned entity, when a file defines it. */
    titleOf: (id: string) => string | undefined
    onselect: (id: string) => void
  }

  let { content, titleOf, onselect }: Props = $props()

  const parsed = $derived(blocks(content))
</script>

{#snippet runs(text: Inline[])}
  {#each text as run, index (index)}
    {#if run.kind === 'code'}
      <code class="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">{run.text}</code>
    {:else if run.kind === 'mention'}
      <button type="button" class="font-medium underline underline-offset-2" onclick={() => onselect(run.id)}>
        {titleOf(run.id) ?? run.id}
      </button>
    {:else if run.kind === 'link'}
      <a class="break-all underline underline-offset-2" href={run.href} target="_blank" rel="noreferrer">{run.text}</a>
    {:else}
      {run.text}
    {/if}
  {/each}
{/snippet}

<div class="flex flex-col gap-3 text-sm leading-relaxed break-words">
  {#each parsed as block, index (index)}
    {#if block.kind === 'heading'}
      <p class="font-semibold {block.level <= 2 ? 'text-base' : ''}">{@render runs(block.text)}</p>
    {:else if block.kind === 'paragraph'}
      <p>{@render runs(block.text)}</p>
    {:else if block.kind === 'list'}
      <ul class="flex list-disc flex-col gap-1 pl-5">
        {#each block.items as item, at (at)}<li>{@render runs(item)}</li>{/each}
      </ul>
    {:else}
      <pre class="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">{block.text}</pre>
    {/if}
  {/each}
</div>
