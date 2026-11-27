<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { EVIDENCE_SHOWN, evidenceLocation, isUrl, type UiEvidence } from '$lib/graph/model'

  import Value from './value.svelte'

  /** One observation: what kind of source, where exactly, links to it, and when and by whom. */
  let { item }: { item: UiEvidence } = $props()

  const location = $derived(evidenceLocation(item))
  const urls = $derived((Array.isArray(item.urls) ? item.urls : [item.urls]).filter(isUrl))
  const byline = $derived([item.observedAt, item.observedBy && `by ${String(item.observedBy)}`].filter(Boolean).join(' '))
  const rest = $derived(Object.entries(item).filter(([key]) => !EVIDENCE_SHOWN.has(key)))
</script>

<div class="evidence">
  <div class="head">
    {#if typeof item.source === 'string'}<span class="badge mono">{item.source}</span>{/if}
    {#if location}<span class="mono where">{location}</span>{/if}
  </div>
  {#if typeof item.note === 'string'}<p>{item.note}</p>{/if}
  {#each urls as url (url)}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the evidence's own external URL -->
    <a class="where" href={url} target="_blank" rel="noreferrer">{url}</a>
  {/each}
  {#if rest.length > 0}
    <dl>
      {#each rest as [key, value] (key)}
        <dt class="muted">{key}</dt>
        <dd><Value {value} /></dd>
      {/each}
    </dl>
  {/if}
  {#if byline}<span class="muted">{byline}</span>{/if}
</div>

<style>
  .evidence {
    display: grid;
    gap: 0.25rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--muted) 50%, transparent);
    font-size: 0.75rem;
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .badge {
    flex-shrink: 0;
    padding: 0 0.35rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.625rem;
  }
  .where {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.125rem 0.5rem;
    margin: 0;
  }
  dd {
    margin: 0;
    min-width: 0;
  }
</style>
