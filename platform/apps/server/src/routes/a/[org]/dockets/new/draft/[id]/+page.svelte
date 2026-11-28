<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowLeft, Sparkles } from '@lucide/svelte'

  import SchemaEditor from '$lib/components/schema/schema-editor.svelte'

  let { data, form } = $props()
  const here = $derived({ org: data.org.slug, id: data.pending.id })
  const template = $derived(data.pending.message?.replace(/^Drafted by AI from /, '') ?? null)
</script>

<svelte:head>
  <title>Review the draft · {data.pending.name}</title>
</svelte:head>

<div class="head">
  <div>
    <p class="caption"><span class="label"><Sparkles size={13} aria-hidden="true" /> New docket · drafted by AI</span></p>
    <h1>Review <em>{data.pending.name}</em></h1>
    <p class="muted state" data-testid="draft-status">
      AI drafted this ontology{template ? ` from ${template}` : ''}. Nothing exists yet: change what you like, and
      <strong>Create docket</strong> makes <span class="mono">/d/{data.pending.slug}</span> with it as its first version. Discard
      it to start again.
    </p>
  </div>
  <div class="toolbar">
    {#if data.pending.space}
      <a class="button small" href={resolve('/a/[org]/s/[space]/new', { org: data.org.slug, space: data.pending.space.slug })}><ArrowLeft size={14} aria-hidden="true" /> New docket</a>
    {:else}
      <a class="button small" href={resolve('/a/[org]/dockets/new', { org: data.org.slug })}><ArrowLeft size={14} aria-hidden="true" /> New docket</a>
    {/if}
  </div>
</div>

{#if form && 'flash' in form && form.flash}<p class="flash" role="status">{form.flash}</p>{/if}

<SchemaEditor
  initial={data.pending.yaml}
  draft={{ id: data.pending.id, parentNumber: 0, message: data.pending.message, author: data.pending.author, source: data.pending.source }}
  head={null}
  canPublish={true}
  csrf={data.csrf}
  urls={{
    check: resolve('/a/[org]/dockets/new/draft/[id]/check', here),
    score: resolve('/a/[org]/dockets/new/draft/[id]/score', here),
    convert: resolve('/a/[org]/dockets/new/draft/[id]/convert', here),
  }}
  org={data.org.slug}
  usage={data.usage}
  vocabulary={data.vocabulary}
  trust={data.trust}
  problem={form && 'problem' in form ? (form.problem ?? null) : null}
  diagnostics={form && 'diagnostics' in form && Array.isArray(form.diagnostics) ? (form.diagnostics as string[]) : null}
  publishLabel="Create docket"
/>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  h1 {
    margin: 0 0 0.3rem;
    font: 400 clamp(32px, 4.2vw, 50px) / 1 var(--font-serif);
    letter-spacing: -0.015em;
  }
  h1 em {
    color: var(--signal);
  }
  .caption {
    margin: 0 0 8px;
  }
  .caption .label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .state {
    margin: 0;
    max-width: 48rem;
    font-size: 14px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
</style>
