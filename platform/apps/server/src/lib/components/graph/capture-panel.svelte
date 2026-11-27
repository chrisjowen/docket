<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { X } from '@lucide/svelte'
  import { untrack } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import { suggestId, type CaptureVocabulary } from '$lib/graph/capture'

  type Kind = 'resource' | 'link' | 'evidence'
  type Shown = { severity: string; code: string; message: string }

  /**
   * The graph browser's capture forms (§14.2): a new resource, a link, or more
   * evidence. Each posts the same structured write an MCP client makes, and
   * each carries evidence, shaped by the chosen source's required fields.
   */
  let {
    vocabulary,
    entities,
    edges,
    selected,
    csrf,
    result,
    onclose,
  }: {
    vocabulary: CaptureVocabulary
    entities: { id: string; type: string; title: string }[]
    edges: { source: string; rel: string; target: string }[]
    selected: string | null
    csrf: string | null
    result: { kind: Kind; id: string; diagnostics: Shown[]; done?: boolean } | null
    onclose: () => void
  } = $props()

  // The form opens on the tab that answered last, or on links and evidence when an exhibit is selected.
  let kind = $state<Kind>(untrack(() => result?.kind ?? (selected ? 'evidence' : 'resource')))
  let busy = $state(false)

  // New resource
  let type = $state(untrack(() => vocabulary.types[0]?.name ?? ''))
  let title = $state('')
  let id = $state('')
  let idEdited = $state(false)
  const typeDef = $derived(vocabulary.types.find((candidate) => candidate.name === type))
  $effect(() => {
    if (!idEdited) id = suggestId(type, title)
  })

  // Link and evidence: the resource they are about
  let about = $state(untrack(() => selected ?? ''))
  const aboutType = $derived(entities.find((entity) => entity.id === about)?.type ?? null)
  const allows = (constraint: '*' | string[], name: string | null) => constraint === '*' || (name !== null && constraint.includes(name))
  const rels = $derived(vocabulary.relationships.filter((relationship) => allows(relationship.from, aboutType)))
  let rel = $state('')
  const relDef = $derived(vocabulary.relationships.find((relationship) => relationship.name === rel))
  const targets = $derived(entities.filter((entity) => entity.id !== about && (!relDef || allows(relDef.to, entity.type))))
  const linksOf = $derived(edges.filter((edge) => edge.source === about))

  // Evidence: shaped by the source
  let source = $state(untrack(() => vocabulary.sources.find((candidate) => candidate.name === 'human')?.name ?? vocabulary.sources[0]?.name ?? ''))
  const sourceDef = $derived(vocabulary.sources.find((candidate) => candidate.name === source))
  const required = $derived(sourceDef?.requires ?? [])
  const anyOf = $derived(sourceDef?.requiresAny ?? [])
  const others = $derived(vocabulary.locationFields.filter((field) => !required.includes(field) && !anyOf.includes(field)))
  const PLACEHOLDERS: Record<string, string> = {
    repository: 'acme/platform',
    path: 'src/orders/handler.ts',
    lines: '12-40',
    symbol: 'createOrder',
    key: 'services.orders.replicas',
    method: 'GET',
    endpoint: '/v1/orders/{id}',
    urls: 'https://… (one per line)',
    commit: 'a1b2c3d',
  }
  const today = new Date().toISOString().slice(0, 10)

  const submit = () => {
    busy = true
    return async ({ update, result: answer }: { update: (options?: { reset?: boolean }) => Promise<void>; result: { type: string } }) => {
      await update({ reset: answer.type === 'success' })
      busy = false
      if (answer.type === 'success') {
        title = ''
        idEdited = false
      }
    }
  }
</script>

{#snippet evidenceFields()}
  <fieldset class="evidence" data-testid="evidence-fields">
    <legend>Evidence <span class="muted">(required: where this was seen)</span></legend>
    <label>
      Source
      <select name="evidence.source" bind:value={source} required>
        {#each vocabulary.sources as option (option.name)}
          <option value={option.name}>{option.name}</option>
        {/each}
      </select>
    </label>
    {#if sourceDef?.description}<p class="muted hint">{sourceDef.description}</p>{/if}
    {#each required as field (field)}
      <label>
        {field} <span class="muted">(required for {source})</span>
        {#if field === 'urls'}
          <textarea name="evidence.urls" rows="2" required placeholder={PLACEHOLDERS[field]}></textarea>
        {:else}
          <input name="evidence.{field}" required placeholder={PLACEHOLDERS[field]} />
        {/if}
      </label>
    {/each}
    {#if anyOf.length}
      <p class="muted hint">Give at least one of: {anyOf.join(', ')}.</p>
      {#each anyOf as field (field)}
        <label>
          {field}
          {#if field === 'urls'}
            <textarea name="evidence.urls" rows="2" placeholder={PLACEHOLDERS[field]}></textarea>
          {:else}
            <input name="evidence.{field}" placeholder={PLACEHOLDERS[field]} />
          {/if}
        </label>
      {/each}
    {/if}
    <label>
      Note
      <textarea name="evidence.note" rows="2" maxlength="1000" placeholder="What was seen there, in a sentence"></textarea>
    </label>
    <details>
      <summary class="muted">More about where it was seen</summary>
      <div class="grid">
        {#each others as field (field)}
          <label>
            {field}
            {#if field === 'urls'}
              <textarea name="evidence.urls" rows="2" placeholder={PLACEHOLDERS[field]}></textarea>
            {:else}
              <input name="evidence.{field}" placeholder={PLACEHOLDERS[field]} />
            {/if}
          </label>
        {/each}
        <label>
          Seen on
          <input name="evidence.observedAt" type="date" max={today} />
        </label>
      </div>
    </details>
    <p class="muted hint">You are recorded as the observer, through the web.</p>
  </fieldset>
{/snippet}

<section class="capture card" aria-label="Capture" data-testid="capture">
  <header>
    <h2>Capture</h2>
    <button class="icon" type="button" onclick={onclose} aria-label="Close capture"><X size={16} aria-hidden="true" /></button>
  </header>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected={kind === 'resource'} onclick={() => (kind = 'resource')}>New resource</button>
    <button type="button" role="tab" aria-selected={kind === 'link'} onclick={() => (kind = 'link')}>Add link</button>
    <button type="button" role="tab" aria-selected={kind === 'evidence'} onclick={() => (kind = 'evidence')}>Add evidence</button>
  </div>

  {#if result && result.kind === kind && result.diagnostics.length}
    <div class={result.done ? 'flash' : 'alert'} role={result.done ? 'status' : 'alert'} data-testid="capture-diagnostics">
      {#if !result.done}<p><strong>Not written.</strong> Fix these and capture again:</p>{/if}
      <ul>
        {#each result.diagnostics as d, i (i)}
          <li><span class="mono">{d.severity} {d.code}</span>: {d.message}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if vocabulary.types.length === 0}
    <p class="muted">The published ontology has no resource types yet: add some in the ontology editor first.</p>
  {:else if kind === 'resource'}
    <form method="POST" action="?/resource" class="stack" use:enhance={submit}>
      <Csrf token={csrf} />
      <label>
        Type
        <select name="type" bind:value={type} required>
          {#each vocabulary.types as option (option.name)}
            <option value={option.name}>{option.name}</option>
          {/each}
        </select>
      </label>
      {#if typeDef?.description}<p class="muted hint">{typeDef.description}</p>{/if}
      <label>
        Title
        <input name="title" bind:value={title} required maxlength="200" placeholder="Orders service" />
      </label>
      <label>
        Id
        <input name="id" class="mono" bind:value={id} oninput={() => (idEdited = true)} required maxlength="200" placeholder="{type}.orders" />
      </label>
      {#each typeDef?.attributes ?? [] as attribute (attribute.name)}
        <label>
          {attribute.name} <span class="muted">({attribute.type})</span>
          {#if attribute.enum}
            <select name="attr.{attribute.name}">
              <option value="">—</option>
              {#each attribute.enum as value (value)}<option value={String(value)}>{value}</option>{/each}
            </select>
          {:else if attribute.type === 'boolean'}
            <select name="attr.{attribute.name}">
              <option value="">—</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          {:else}
            <input name="attr.{attribute.name}" placeholder={attribute.type.endsWith('[]') ? 'comma, separated' : (attribute.description ?? '')} />
          {/if}
        </label>
      {/each}
      <label>
        Body <span class="muted">(Markdown, optional)</span>
        <textarea name="body" rows="3" maxlength="60000"></textarea>
      </label>
      {@render evidenceFields()}
      <button class="button primary" type="submit" disabled={busy}>Capture {type}</button>
    </form>
  {:else if kind === 'link'}
    <form method="POST" action="?/link" class="stack" use:enhance={submit}>
      <Csrf token={csrf} />
      <label>
        From
        <select name="id" bind:value={about} required>
          <option value="" disabled>Choose a resource</option>
          {#each entities as entity (entity.id)}<option value={entity.id}>{entity.title} ({entity.id})</option>{/each}
        </select>
      </label>
      <label>
        Relationship
        <select name="rel" bind:value={rel} required>
          <option value="" disabled>Choose</option>
          {#each rels as option (option.name)}<option value={option.name}>{option.name}</option>{/each}
        </select>
      </label>
      <label>
        To
        <select name="target" required>
          <option value="" disabled selected>Choose a resource</option>
          {#each targets as entity (entity.id)}<option value={entity.id}>{entity.title} ({entity.id})</option>{/each}
        </select>
      </label>
      {@render evidenceFields()}
      <button class="button primary" type="submit" disabled={busy || !about}>Add link</button>
    </form>
  {:else}
    <form method="POST" action="?/evidence" class="stack" use:enhance={submit}>
      <Csrf token={csrf} />
      <label>
        Resource
        <select name="id" bind:value={about} required>
          <option value="" disabled>Choose a resource</option>
          {#each entities as entity (entity.id)}<option value={entity.id}>{entity.title} ({entity.id})</option>{/each}
        </select>
      </label>
      <label>
        For
        <select name="link">
          <option value="">the resource itself</option>
          {#each linksOf as edge (`${edge.rel} ${edge.target}`)}
            <option value="{edge.rel} {edge.target}">link {edge.rel} → {edge.target}</option>
          {/each}
        </select>
      </label>
      {@render evidenceFields()}
      <button class="button primary" type="submit" disabled={busy || !about}>Add evidence</button>
    </form>
  {/if}
</section>

<style>
  .capture {
    padding: 1rem 1.1rem 1.2rem;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 1.15rem;
  }
  .icon {
    display: inline-flex;
    padding: 0.25rem;
    border: 0;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    margin: 0.75rem 0 0.9rem;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    padding: 0.4rem 0.6rem;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted-foreground);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .tabs button[aria-selected='true'] {
    color: var(--foreground);
    border-bottom-color: var(--gilt);
  }
  .evidence {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  legend {
    padding: 0 0.3rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .hint {
    margin: -0.2rem 0 0;
    font-size: 0.78rem;
  }
  details .grid {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.6rem;
  }
  summary {
    cursor: pointer;
    font-size: 0.82rem;
  }
  .alert ul,
  .flash ul {
    margin: 0.3rem 0 0;
    padding-left: 1.1rem;
  }
  .alert p {
    margin: 0;
  }
</style>
