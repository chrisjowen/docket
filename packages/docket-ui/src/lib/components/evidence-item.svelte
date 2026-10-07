<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { EVIDENCE_SHOWN, evidenceLocation, isUrl } from '$lib/model.js'
  import type { UiEvidence } from '$lib/types.js'
  import Value from './value.svelte'

  /** One observation: what kind of source, where exactly, links to it, and when and by whom. */
  let { item }: { item: UiEvidence } = $props()

  const location = $derived(evidenceLocation(item))
  const urls = $derived((Array.isArray(item.urls) ? item.urls : [item.urls]).filter(isUrl))
  const byline = $derived([item.observedAt, item.observedBy && `by ${String(item.observedBy)}`].filter(Boolean).join(' '))
  const rest = $derived(Object.entries(item).filter(([key]) => !EVIDENCE_SHOWN.has(key)))
</script>

<div class="bg-muted/50 flex flex-col gap-1 rounded-md border px-2.5 py-1.5 text-xs">
  <div class="flex items-start gap-2">
    {#if typeof item.source === 'string'}
      <Badge variant="outline" class="shrink-0 font-mono text-[10px]">{item.source}</Badge>
    {/if}
    {#if location}<span class="min-w-0 font-mono break-all">{location}</span>{/if}
  </div>
  {#if typeof item.note === 'string'}<p class="break-words">{item.note}</p>{/if}
  {#each urls as url (url)}
    <a class="break-all underline underline-offset-2" href={url} target="_blank" rel="noreferrer">{url}</a>
  {/each}
  {#if rest.length > 0}
    <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      {#each rest as [key, value] (key)}
        <dt class="text-muted-foreground">{key}</dt>
        <dd class="min-w-0"><Value {value} /></dd>
      {/each}
    </dl>
  {/if}
  {#if byline}<span class="text-muted-foreground">{byline}</span>{/if}
</div>
