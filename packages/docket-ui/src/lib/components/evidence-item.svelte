<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { EVIDENCE_SHOWN, evidenceLocation, isUrl, type Evidence } from '$lib/model.js'
  import Value from './value.svelte'

  /** One observation: what kind of source, where exactly, links to it, and when and by whom. */
  let { item }: { item: Evidence } = $props()

  const record = $derived(typeof item === 'string' ? null : item)
  const location = $derived(record ? evidenceLocation(record) : '')
  const urls = $derived(
    record ? (Array.isArray(record.urls) ? record.urls : [record.urls]).filter(isUrl) : []
  )
  const byline = $derived(
    record
      ? [record.observedAt, record.observedBy && `by ${String(record.observedBy)}`].filter(Boolean).join(' ')
      : ''
  )
  const rest = $derived(record ? Object.entries(record).filter(([key]) => !EVIDENCE_SHOWN.has(key)) : [])
</script>

<div class="bg-muted/50 flex flex-col gap-1 rounded-md border px-2.5 py-1.5 text-xs">
  {#if record === null}
    {#if isUrl(item)}
      <a class="break-all underline underline-offset-2" href={item as string} target="_blank" rel="noreferrer">{item}</a>
    {:else}
      <span class="break-words">{item}</span>
    {/if}
  {:else}
    <div class="flex items-start gap-2">
      {#if typeof record.source === 'string'}
        <Badge variant="outline" class="shrink-0 font-mono text-[10px]">{record.source}</Badge>
      {/if}
      {#if location}<span class="min-w-0 font-mono break-all">{location}</span>{/if}
    </div>
    {#if typeof record.note === 'string'}<p class="break-words">{record.note}</p>{/if}
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
  {/if}
</div>
