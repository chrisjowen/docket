<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import FileText from '@lucide/svelte/icons/file-text'
  import Maximize2 from '@lucide/svelte/icons/maximize-2'
  import Minimize2 from '@lucide/svelte/icons/minimize-2'
  import DocketMark from '$lib/components/docket-mark.svelte'
  import EvidenceItem from '$lib/components/evidence-item.svelte'
  import Notes from '$lib/components/notes.svelte'
  import Value from '$lib/components/value.svelte'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { basisLabel, typeCode } from '$lib/model.js'
  import type { AppBridge } from './bridge.js'
  import { leadOf, linksByRel, notesOf, percent, sourcesOf, type ResourceCard } from './card.js'

  /**
   * docket_get's app: one resource as its card - its type and title, how
   * well its evidence supports it, its key attributes, the opening of its
   * notes, its links and the evidence behind it, and whether it has gone out
   * of date. A link, a mention in its notes or its replacement opens that
   * resource's card through the same tool.
   */
  interface Props {
    bridge: AppBridge
    /** The resource; null while it is read. */
    card: ResourceCard | null
    /** The id being read, while there is no card yet. */
    reading: string | null
    displayModes: () => string[]
    displayMode: () => string
    ondisplaymode: (mode: string) => void
    /** Read another resource and show its card; rejects with why it could not. */
    oncard: (id: string) => Promise<void>
    /** Back to what the app showed before, when it showed something. */
    onback: (() => void) | null
  }

  let { bridge, card, reading, displayModes, displayMode, ondisplaymode, oncard, onback }: Props = $props()

  const EVIDENCE_SHOWN = 3

  const resource = $derived(card?.resource ?? null)
  const body = $derived(resource ? notesOf(resource.body, resource.title) : '')
  const notes = $derived(leadOf(body))
  const attributes = $derived(resource ? Object.entries(resource.attributes) : [])
  const groups = $derived(resource ? linksByRel(resource.links) : [])
  const sources = $derived(resource ? sourcesOf(resource.evidence) : [])

  let allNotes = $state(false)
  let allEvidence = $state(false)
  let busy = $state<string | null>(null)
  let error = $state<string | null>(null)

  // Each card opens folded.
  $effect(() => {
    void card
    allNotes = false
    allEvidence = false
    error = null
  })

  async function show(id: string): Promise<void> {
    if (busy) return
    busy = id
    error = null
    try {
      await oncard(id)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = null
    }
  }

  async function open(): Promise<void> {
    if (!card?.viewer) return
    try {
      await bridge.request('ui/open-link', { url: card.viewer })
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      const granted = (await bridge.request('ui/request-display-mode', { mode: displayMode() === 'fullscreen' ? 'inline' : 'fullscreen' })) as {
        mode?: string
      } | null
      if (granted?.mode) ondisplaymode(granted.mode)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const fullscreen = $derived(displayMode() === 'fullscreen')
</script>

{#snippet target(id: string)}
  <button class="font-mono text-[12px] break-all hover:underline disabled:opacity-60" disabled={busy !== null} onclick={() => show(id)}>
    {busy === id ? `${id}…` : id}
  </button>
{/snippet}

<div class="bg-bg text-ink flex flex-col {fullscreen ? 'h-screen' : 'max-h-[40rem]'}">
  <header class="flex items-center gap-2.5 px-3 pt-3 pb-2">
    {#if onback}
      <Button variant="ghost" size="icon-sm" aria-label="Back" onclick={onback}><ArrowLeft /></Button>
    {/if}
    <DocketMark size={24} />
    <span class="label-mono min-w-0 flex-1 truncate">
      {resource ? `Exhibit · ${resource.type.replaceAll('_', ' ')}` : 'Exhibit'}
    </span>
    {#if card?.viewer && resource}
      <Button variant="outline" size="xs" onclick={open}><ExternalLink />Open in docket</Button>
    {/if}
    {#if displayModes().includes('fullscreen')}
      <Button variant="ghost" size="icon-sm" aria-label={fullscreen ? 'Show inline' : 'Show full screen'} onclick={toggleFullscreen}>
        {#if fullscreen}<Minimize2 />{:else}<Maximize2 />{/if}
      </Button>
    {/if}
  </header>

  {#if error}
    <p class="text-signal px-3 pb-1.5 text-xs">{error}</p>
  {/if}

  {#if !card}
    <div class="text-mute grid min-h-48 flex-1 place-items-center font-serif text-xl italic">Reading {reading ?? 'the resource'}…</div>
  {:else}
    <article class="bg-paper shadow-paper mx-3 mb-3 flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[14px] p-4">
      {#if card.superseded}
        <p class="border-signal/40 bg-signal-soft rounded-md border px-3 py-2 text-xs leading-relaxed">
          <span class="font-medium">Out of date since {card.superseded.validUntil.slice(0, 10)}:</span>
          {card.superseded.reason} Replaced by {@render target(card.superseded.current ?? card.superseded.by)}.
        </p>
      {/if}

      <header class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          {#if resource}<span class="type-code shrink-0" style="--c: var(--ink-2)">{typeCode(resource.type)}</span>{/if}
          <span class="text-mute min-w-0 font-mono text-[11px] break-all">{card.id}</span>
        </div>
        <h2 class="font-serif text-[1.9rem] leading-tight break-words">{resource?.title ?? card.id}</h2>
        {#if resource && resource.tags.length > 0}
          <div class="flex flex-wrap gap-1">
            {#each resource.tags as tag, index (index)}<Badge variant="secondary">{tag}</Badge>{/each}
          </div>
        {/if}
        {#if resource}
          <div class="text-mute flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span class="bg-sunk h-1.5 w-20 overflow-hidden rounded-full" aria-hidden="true">
              <span class="bg-ink/70 block h-full rounded-full" style="width: {resource.confidence * 100}%"></span>
            </span>
            <span class="text-ink tabular-nums">{percent(resource.confidence)}</span>
            <span>confidence · {basisLabel(resource.basis)} · {resource.evidenceCount} evidence</span>
          </div>
        {/if}
      </header>

      {#if !resource}
        <section class="flex flex-col gap-1.5">
          <h3 class="section-title">Its documents do not validate</h3>
          <ul class="flex flex-col gap-1 text-xs">
            {#each card.diagnostics as diagnostic, index (index)}
              <li><span class="font-mono">{diagnostic.severity} {diagnostic.code}</span>: {diagnostic.message}</li>
            {/each}
          </ul>
        </section>
      {:else}
        {@const hasBody = body.trim() !== ''}
        {#if resource.summary || hasBody}
          <section class="flex flex-col gap-2">
            <h3 class="section-title">{resource.summary ? 'Summary' : 'Notes'}</h3>
            {#if resource.summary}
              <p class="text-sm leading-relaxed break-words">{resource.summary}</p>
            {/if}
            {#if hasBody && (allNotes || !resource.summary)}
              <Notes content={allNotes ? body : notes.lead} titleOf={() => undefined} onselect={show} />
            {/if}
            {#if hasBody && (resource.summary || notes.more)}
              <button class="text-mute self-start text-xs hover:underline" onclick={() => (allNotes = !allNotes)}>
                {allNotes ? 'Show less' : resource.summary ? 'Read the notes' : 'Read all notes'}
              </button>
            {/if}
          </section>
        {/if}

        {#if attributes.length > 0}
          <section class="flex flex-col gap-2">
            <h3 class="section-title">Attributes</h3>
            <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
              {#each attributes as [key, value] (key)}
                <dt class="text-mute font-mono text-xs">{key}</dt>
                <dd class="min-w-0"><Value {value} /></dd>
              {/each}
            </dl>
          </section>
        {/if}

        {#if groups.length > 0}
          <section class="flex flex-col gap-2">
            <h3 class="section-title">Links ({resource.links.length})</h3>
            <ul class="flex flex-col gap-1.5 text-sm">
              {#each groups as [rel, links] (rel)}
                <li class="flex flex-col gap-0.5">
                  <span class="rel">{rel} →</span>
                  <ul class="flex flex-col gap-0.5 pl-3">
                    {#each links as link (link.target)}
                      <li class="flex flex-wrap items-baseline gap-x-2">
                        {@render target(link.target)}
                        <span class="text-mute text-[11px] tabular-nums">
                          {percent(link.confidence)}{link.evidence.length > 0 ? ` · ${link.evidence.length} evidence` : ''}
                        </span>
                      </li>
                    {/each}
                  </ul>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <section class="flex flex-col gap-2">
          <h3 class="section-title">Evidence ({resource.evidence.length})</h3>
          {#if sources.length > 0}
            <div class="flex flex-wrap items-center gap-1">
              <span class="text-mute mr-1 text-xs">Sources</span>
              {#each sources as { source, count } (source)}
                <Badge variant="secondary" class="font-mono text-[10px]">{source}{count > 1 ? ` ×${count}` : ''}</Badge>
              {/each}
            </div>
          {/if}
          {#if resource.evidence.length > 0}
            <ul class="flex flex-col gap-1.5">
              {#each allEvidence ? resource.evidence : resource.evidence.slice(0, EVIDENCE_SHOWN) as item, index (index)}
                <li><EvidenceItem {item} /></li>
              {/each}
            </ul>
            {#if resource.evidence.length > EVIDENCE_SHOWN}
              <button class="text-mute self-start text-xs hover:underline" onclick={() => (allEvidence = !allEvidence)}>
                {allEvidence ? 'Show less' : `Show all ${resource.evidence.length}`}
              </button>
            {/if}
          {:else}
            <p class="text-mute text-xs">No evidence on file: nothing records where this was seen.</p>
          {/if}
        </section>
      {/if}

      <footer class="text-mute flex flex-col gap-1 border-t pt-3 text-[11px]">
        {#each card.documents as document (document.path)}
          <span class="flex items-center gap-1.5">
            <FileText class="size-3 shrink-0" aria-hidden="true" />
            <span class="font-mono break-all">{document.path}</span>
            <span>· {document.origin}{document.revision === undefined ? '' : ` · revision ${document.revision}`}</span>
          </span>
        {/each}
        {#if card.supersedes?.length}
          <span class="flex flex-wrap items-baseline gap-x-1">
            Current record for
            {#each card.supersedes as older, index (older.id)}{@render target(older.id)}{index < card.supersedes.length - 1 ? ',' : ''}{/each}
          </span>
        {/if}
      </footer>
    </article>
  {/if}
</div>

<style>
  .rel {
    color: var(--signal);
    font-family: var(--serif);
    font-size: 13px;
    font-style: italic;
  }
</style>
