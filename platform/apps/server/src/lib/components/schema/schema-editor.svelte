<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { afterNavigate, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import type { Disposition, Migration, Unresolved } from '@docket/platform-ontology-service'
  import { GitPullRequestArrow, Save, Send, Shuffle } from '@lucide/svelte'
  import { onDestroy, tick, untrack } from 'svelte'
  import type { Document } from 'yaml'

  import Csrf from '$lib/components/csrf.svelte'
  import CheckPanel from '$lib/components/ontology/check-panel.svelte'
  import {
    addType,
    edit,
    hasLegacyTrust,
    nameProblem,
    parse,
    policiesOf,
    removeType,
    renameKey,
    renameType,
    setPolicies,
    usesTrust,
    type OntologyModel,
  } from '$lib/ontology/editor'
  import type { TrustData } from '$lib/ontology/schema'
  import type { CheckState } from '$lib/ontology/types'

  import PoliciesPane from './policies-pane.svelte'
  import SourcesPane from './sources-pane.svelte'
  import TypesPane from './types-pane.svelte'

  type Tab = 'types' | 'sources' | 'policies' | 'yaml'
  const TABS: Tab[] = ['types', 'sources', 'policies', 'yaml']
  const LEDE: Record<Tab, string> = {
    types: 'The kinds of record this docket keeps, the facts each carries, and what each can point to.',
    sources: 'Where facts come from. Each kind of source says what attributes it has, who may set them, and how an observation points into it.',
    policies: 'How much a fact is worth, given where it came from. The most specific rule sets the score; adjustments then apply.',
    yaml: 'The whole schema as the file docket reads: every change in the other tabs is made here.',
  }

  interface Props {
    /** The text to show: the draft's, or the head's when there is no draft. */
    initial: string
    draft: { id: string; parentNumber: number; message: string | null; author: string; source: string } | null
    head: { number: number; yaml: string } | null
    canPublish: boolean
    csrf: string | null
    urls: { check: string; score: string; convert: string }
    org: string
    usage: { types: Record<string, number>; relationships: Record<string, number> }
    vocabulary: { icons: string[]; attributeTypes: string[]; locationFields: string[] }
    trust: TrustData & { records: { id: string; title: string; type: string; confidence: number }[] }
    problem?: string | null
    diagnostics?: string[] | null
    /** What the publish button says: "Publish v<n>" unless publishing makes something else, such as a new docket. */
    publishLabel?: string | null
  }
  let { initial, draft, head, canPublish, csrf, urls, org, usage, vocabulary, trust, problem = null, diagnostics = null, publishLabel = null }: Props = $props()

  const readonly = untrack(() => !draft)
  let text = $state(untrack(() => initial))
  let saved = $state(untrack(() => initial))
  let attested = $state(untrack(() => ({ people: trust.people, registered: trust.registered, repositories: trust.repositories, manage: trust.manage })))
  const search = untrack(() => page.url.searchParams)
  let tab = $state<Tab>(TABS.includes(search.get('tab') as Tab) ? (search.get('tab') as Tab) : 'types')
  let selectedType = $state<string | null>(search.get('type'))
  let selectedSource = $state<string | null>(search.get('source'))
  // A record's "Why" links a policy by its name: `rule=<name>` opens the editor on it.
  const ruleAt = (name: string | null) => {
    const at = name === null ? -1 : policiesOf(parse(untrack(() => initial)).model ?? { resourceTypes: {}, relationships: {} }).findIndex((policy) => policy.name === name)
    return at >= 0 ? at : null
  }
  let selectedPolicy = $state<number | null>(search.get('policy') !== null ? Number(search.get('policy')) : ruleAt(search.get('rule')))
  let trySource = $state<string | null>(search.get('try'))
  let migration = $state<Migration[]>([])
  let result = $state<CheckState>({ status: 'idle' })
  let message = $state(untrack(() => draft?.message ?? ''))
  let acceptNarrowing = $state(false)
  let dispositions = $state<Record<string, Disposition>>({})
  let notes = $state<string[]>([])
  let toast = $state<string | null>(null)
  let converting = $state(false)

  const parsed = $derived(parse(text))
  const model = $derived<OntologyModel | null>(parsed.model)
  const headModel = $derived(head ? parse(head.yaml).model : null)
  const types = $derived(Object.keys(model?.resourceTypes ?? {}))
  const relationships = $derived(Object.keys(model?.relationships ?? {}))
  const removedTypes = $derived(Object.keys(headModel?.resourceTypes ?? {}).filter((t) => !types.includes(t) && usage.types[t]))
  const removedRelationships = $derived(Object.keys(headModel?.relationships ?? {}).filter((r) => !relationships.includes(r) && usage.relationships[r]))
  const dirty = $derived(text !== saved)
  const unsaved = $derived(dirty || message !== (draft?.message ?? ''))
  const stale = $derived(Boolean(draft && head && draft.parentNumber !== head.number))
  const legacy = $derived(Boolean(model && !usesTrust(model)))
  const movedFromHead = $derived(Boolean(model && usesTrust(model) && headModel && !usesTrust(headModel)))
  const counts = $derived({ types: types.length, sources: Object.keys(model?.sources ?? {}).length, policies: policiesOf(model ?? { resourceTypes: {}, relationships: {} }).length })

  const check = $derived(result.status === 'ok' ? result.check : null)
  const settled = (resource: Unresolved) => {
    const disposition = dispositions[resource.resourceId]
    return disposition === 'accept-data-loss' || (disposition === 'update-in-repo' && resource.updatable)
  }
  // A rescore moves confidence and nothing else: it publishes without "publish anyway".
  const needsAcceptance = $derived(check?.classification === 'narrowing' || check?.classification === 'breaking')
  const blockedReason = $derived.by(() => {
    if (!canPublish) return 'Only owners and admins publish. Save the draft and ask one of them.'
    if (stale) return `The head moved to v${head?.number}. Rebase the draft and check it again.`
    if (result.status === 'checking' || result.status === 'idle') return 'Waiting for the check.'
    if (!check) return 'Fix the draft first.'
    if (!check.changes.length && !migration.length) return `Nothing to publish: the draft matches v${head?.number ?? 0}.`
    if (!check.unresolved.every(settled)) return 'Blocked until the breaking change is resolved.'
    if (needsAcceptance && !acceptNarrowing) return 'Tick "publish anyway" to accept the new diagnostics.'
    return null
  })
  const ruling = $derived.by(() => {
    if (!check) return null
    if (check.classification === 'breaking') return { stamp: 'red', word: 'Blocked', title: 'The draft would leave records the schema no longer knows' }
    if (check.classification === 'narrowing') return { stamp: 'warn', word: 'Narrows', title: 'Some records would gain problems' }
    if (check.classification === 'rescore') return { stamp: 'ok', word: 'Re-scores', title: 'The draft is consistent with the record, and moves confidence' }
    return { stamp: 'ok', word: 'Sustained', title: 'The draft is consistent with the record' }
  })

  function apply(change: (doc: Document) => void, note: string) {
    if (readonly) return
    text = edit(text, change)
    notes = [...notes.slice(-19), note]
  }

  // Where the editor is lives in the address, so a link opens the same tab and selection:
  // written only once the router is up, which `replaceState` needs.
  let routed = $state(false)
  afterNavigate(() => (routed = true))
  $effect(() => {
    if (!routed) return
    const url = new URL(page.url)
    // The first tab is where the editor opens: the address names only another.
    if (tab === 'types') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    for (const [key, value] of [
      ['type', tab === 'types' ? selectedType : null],
      ['source', tab === 'sources' ? selectedSource : null],
      ['policy', tab === 'policies' && selectedPolicy !== null ? String(selectedPolicy) : null],
    ] as const) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    url.searchParams.delete('try')
    url.searchParams.delete('rule')
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own path, with the editor's place as the query
    if (url.search !== page.url.search) untrack(() => replaceState(`${page.url.pathname}${url.search}`, page.state))
  })

  // The live dry run: every edit is checked against every document, 500 ms after the last one.
  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  async function runCheck(yaml: string, steps: Migration[]) {
    const mine = ++sequence
    result = { status: 'checking' }
    try {
      const response = await fetch(urls.check, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' },
        body: JSON.stringify({ yaml, migration: steps.filter((step) => step.from && (step.to || step.type)) }),
      })
      if (mine !== sequence) return
      if (!response.ok) {
        result = { status: 'error', message: `The check failed (${response.status}). Try again in a moment.` }
        return
      }
      const body = await response.json()
      if (mine !== sequence) return
      if (body.ok) result = { status: 'ok', check: body.check }
      else if (body.invalid) result = { status: 'invalid', diagnostics: body.invalid }
      else result = { status: 'migration', problems: body.migration }
    } catch {
      if (mine === sequence) result = { status: 'error', message: 'The check could not reach the server.' }
    }
  }
  $effect(() => {
    if (readonly) return
    const yaml = text
    const steps = $state.snapshot(migration) as Migration[]
    clearTimeout(timer)
    timer = setTimeout(() => void runCheck(yaml, steps), 500)
  })
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function say(words: string) {
    toast = words
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = null), 5000)
  }
  onDestroy(() => {
    clearTimeout(timer)
    clearTimeout(toastTimer)
  })

  function addTypeNamed(name: string): string | null {
    const problem = nameProblem(name, types)
    if (problem) return problem
    apply((doc) => addType(doc, name), `added the ${name} type`)
    selectedType = name
    return null
  }

  function rename(kind: 'type' | 'relationship', from: string, to: string): boolean {
    const taken = kind === 'type' ? types : relationships
    if (to === from || nameProblem(to, taken)) return false
    if (kind === 'type') apply((doc) => renameType(doc, from, to), `renamed ${from} → ${to}`)
    else apply((doc) => renameKey(doc, ['relationships'], from, to), `renamed ${from} → ${to}`)
    // What the documents already use needs moving with it.
    if (kind === 'type' && usage.types[from]) migration = [...migration.filter((s) => s.from !== from), { op: 'renameType', from, to }]
    if (kind === 'relationship' && usage.relationships[from]) migration = [...migration.filter((s) => s.from !== from), { op: 'renameRelationship', from, to }]
    if (kind === 'type') selectedType = to
    return true
  }

  /** Renames a source type, and every policy found in it. Evidence already filed under the old name needs the new one too. */
  function renameSource(from: string, to: string): boolean {
    if (!model || to === from || nameProblem(to, Object.keys(model.sources ?? {}))) return false
    const policies = policiesOf(model).map((policy) => (policy.when.source === from ? { ...policy, when: { ...policy.when, source: to } } : policy))
    apply((doc) => {
      renameKey(doc, ['sources'], from, to)
      if (policies.length) setPolicies(doc, policies)
    }, `renamed the ${from} source → ${to}`)
    selectedSource = to
    return true
  }

  async function convert() {
    converting = true
    try {
      const response = await fetch(urls.convert, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' }, body: JSON.stringify({ yaml: text }) })
      const body = (await response.json().catch(() => null)) as { ok: boolean; yaml?: string; problem?: string } | null
      if (!body?.ok || !body.yaml) return say(body?.problem ?? 'The schema could not be converted.')
      text = body.yaml
      notes = [...notes, 'converted the evidence settings to sources and policies']
      say('Converted. Every score is unchanged until you edit a rule.')
    } finally {
      converting = false
    }
  }

  async function showRuling() {
    await tick()
    document.getElementById(tab === 'policies' && check && (check.rescored.length || check.proposals.length) ? 'impact' : 'ruling')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
</script>

{#if problem}
  <div class="alert" role="alert">
    <p>{problem}</p>
    {#if diagnostics?.length}<ul class="mono">{#each diagnostics as line, i (i)}<li>{line}</li>{/each}</ul>{/if}
  </div>
{/if}

{#if stale && draft}
  <form method="POST" action="?/save" class="stale" use:enhance={() => {
    const sent = text
    return async ({ result, update }) => {
      await update({ reset: false })
      if (result.type === 'success') saved = sent
    }
  }}>
    <Csrf token={csrf} />
    <input type="hidden" name="draft" value={draft.id} />
    <input type="hidden" name="yaml" value={text} />
    <input type="hidden" name="rebase" value="on" />
    <GitPullRequestArrow size={16} aria-hidden="true" />
    <span>This draft was made against v{draft.parentNumber}; the head is now v{head?.number}. Its check already runs against v{head?.number}. Rebase to publish it.</span>
    <button class="button small" type="submit">Rebase onto v{head?.number}</button>
  </form>
{/if}

<p class="lede">{LEDE[tab]}</p>
<nav class="tabs" aria-label="Schema">
  <div role="tablist">
    <button type="button" role="tab" aria-selected={tab === 'types'} onclick={() => (tab = 'types')}>Types &amp; relations <span class="n">{counts.types}</span></button>
    <button type="button" role="tab" aria-selected={tab === 'sources'} onclick={() => (tab = 'sources')}>Sources <span class="n">{counts.sources}</span></button>
    <button type="button" role="tab" aria-selected={tab === 'policies'} onclick={() => (tab = 'policies')}>Policies <span class="n">{counts.policies}</span></button>
    <button type="button" role="tab" aria-selected={tab === 'yaml'} onclick={() => (tab = 'yaml')}>YAML</button>
  </div>
</nav>

{#if (tab === 'sources' || tab === 'policies') && model && legacy}
  <div class="note convert" role="status">
    <Shuffle size={16} aria-hidden="true" />
    <div>
      <b>This schema still prices evidence the old way:</b> a number on each kind of evidence, and confidence numbers scattered over types and relationships.
      {#if hasLegacyTrust(model)}{:else}It names no sources of its own, so docket's built-in ones apply.{/if}
      Convert it to sources and policies to edit them here; every score stays exactly as it is.
    </div>
    {#if !readonly}<button type="button" class="button small primary" disabled={converting} onclick={convert}>Convert to sources &amp; policies</button>{:else}<span class="muted small">Start a draft to convert it.</span>{/if}
  </div>
{:else if tab === 'policies' && movedFromHead}
  <p class="note small" role="status">
    <b>Moved here from v{head?.number}.</b> The evidence settings and the confidence numbers on types became the sources and policies below. Every score is unchanged until you edit a rule.
  </p>
{/if}

<div class="body">
  {#if tab === 'yaml' || !model}
    {#if parsed.error}<p class="alert" role="alert">{parsed.error}</p>{/if}
    <textarea class="yaml mono" aria-label="Ontology YAML" spellcheck="false" {readonly} bind:value={text}></textarea>
  {:else if tab === 'types'}
    <TypesPane
      {model}
      {readonly}
      {usage}
      {vocabulary}
      selected={selectedType}
      onselect={(name) => (selectedType = name)}
      {apply}
      onrename={rename}
      onaddtype={addTypeNamed}
      onremovetype={(name) => apply((doc) => removeType(doc, name), `removed the ${name} type`)}
      onpolicy={(index) => {
        tab = 'policies'
        selectedPolicy = index >= 0 ? index : null
      }}
    />
  {:else if legacy}
    <p class="muted">Convert the schema above to see its {tab}.</p>
  {:else if tab === 'sources'}
    <SourcesPane
      {model}
      {readonly}
      attributeTypes={vocabulary.attributeTypes}
      selected={selectedSource}
      onselect={(name) => (selectedSource = name)}
      {apply}
      onrename={renameSource}
      bind:trust={attested}
      {org}
      {csrf}
      ontry={(source) => {
        trySource = source
        tab = 'policies'
      }}
      onpolicy={(index) => {
        tab = 'policies'
        selectedPolicy = index
      }}
      ontoast={say}
    />
  {:else}
    <PoliciesPane
      {model}
      {text}
      {readonly}
      {apply}
      selected={selectedPolicy}
      onselect={(index) => (selectedPolicy = index)}
      {trySource}
      {check}
      trust={{ ...attested, records: trust.records }}
      scoreUrl={urls.score}
      {csrf}
      head={head?.number ?? 0}
    />
  {/if}
</div>

{#if !readonly && draft}
  <section class="card ruling" id="ruling" aria-label="Check against the record">
    <div class="ruling-head">
      {#if ruling}<span class="stamp {ruling.stamp}">{ruling.word}</span><h2>{ruling.title}</h2>{:else}<h2>Checking the draft against the record…</h2>{/if}
    </div>
    <div class="ruling-body">
      <CheckPanel
        {result}
        {migration}
        onmigration={(steps) => (migration = steps)}
        {dispositions}
        ondisposition={(id, value) => (dispositions = { ...dispositions, [id]: value })}
        {removedTypes}
        {removedRelationships}
        {types}
        {relationships}
      />
      <div class="publish">
        <form id="save-form" method="POST" action="?/save" use:enhance={() => {
          const sent = text
          return async ({ result, update }) => {
            await update({ reset: false })
            if (result.type === 'success') saved = sent
          }
        }}>
          <Csrf token={csrf} />
          <input type="hidden" name="draft" value={draft.id} />
          <input type="hidden" name="yaml" value={text} />
          <label>
            Message
            <input name="message" bind:value={message} placeholder="What this changes, and why" maxlength="200" />
          </label>
        </form>
        <form id="publish-form" method="POST" action="?/publish">
          <Csrf token={csrf} />
          <input type="hidden" name="draft" value={draft.id} />
          <input type="hidden" name="yaml" value={text} />
          <input type="hidden" name="message" value={message} />
          <input type="hidden" name="expectedHead" value={draft.parentNumber} />
          <input type="hidden" name="migration" value={JSON.stringify(migration.filter((step) => step.from && (step.to || step.type)))} />
          <input type="hidden" name="dispositions" value={JSON.stringify(dispositions)} />
          {#if check && needsAcceptance && canPublish && check.unresolved.every(settled)}
            <label class="check">
              <input type="checkbox" name="acceptNarrowing" bind:checked={acceptNarrowing} />
              Publish anyway: accept the new diagnostics
            </label>
          {/if}
        </form>
        {#if blockedReason}<p class="muted small" data-testid="publish-blocked">{blockedReason}</p>{/if}
      </div>
    </div>
  </section>

  <div class="draft-bar" role="region" aria-label="Draft">
    <p>
      <b>{check ? `${check.changes.length} change${check.changes.length === 1 ? '' : 's'} from v${head?.number ?? 0}` : 'Draft'}</b>{#if unsaved} · unsaved{/if}
      {#if notes.length}<span class="last"> · {notes.at(-1)}</span>{/if}
    </p>
    <div class="bar-buttons">
      <button class="ghost" type="submit" form="save-form" formaction="?/discard">Discard</button>
      <button class="ghost" type="submit" form="save-form" disabled={!unsaved}>
        <Save size={14} aria-hidden="true" /> {unsaved ? 'Save draft' : 'Saved'}
      </button>
      <button class="ghost" type="button" onclick={showRuling}>Check against record</button>
      <button class="solid" type="submit" form="publish-form" disabled={blockedReason !== null}>
        <Send size={14} aria-hidden="true" /> {publishLabel ?? `Publish v${(head?.number ?? 0) + 1}`}
      </button>
    </div>
  </div>
{/if}

{#if toast}<p class="toast" role="status">{toast}</p>{/if}

<style>
  .lede {
    max-width: 66ch;
    margin: 4px 0 14px;
    color: var(--ink-2);
    font-size: 15.5px;
  }
  .tabs [role='tablist'] {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 18px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 18px;
  }
  .tabs [role='tab'] {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 10px 0;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: transparent;
    color: var(--mute);
    font: 500 14px var(--font-sans);
    cursor: pointer;
  }
  .tabs [role='tab'][aria-selected='true'] {
    color: var(--ink);
    border-bottom-color: var(--ink);
  }
  .n {
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--sunk);
    font: 500 11px var(--font-mono);
  }
  .note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    margin: 0 0 16px;
    border-radius: 9px;
    background: var(--info-soft);
    font-size: 14px;
  }
  .note > div {
    flex: 1;
    min-width: 18rem;
  }
  .note.convert {
    background: var(--warn-soft);
  }
  .body {
    min-height: 20rem;
  }
  .yaml {
    width: 100%;
    min-height: 36rem;
    font-size: 13px;
    line-height: 1.45;
    tab-size: 2;
    white-space: pre;
  }
  .ruling {
    margin-top: 22px;
    padding: 18px 20px;
    scroll-margin-top: 70px;
  }
  .ruling-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .ruling-head h2 {
    margin: 0;
    font: 400 24px/1.15 var(--font-serif);
  }
  .ruling-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20rem;
    gap: 16px;
    align-items: start;
  }
  .publish {
    display: grid;
    gap: 10px;
  }
  .publish label {
    display: grid;
    gap: 4px;
  }
  .check {
    display: flex !important;
    align-items: center;
    gap: 8px;
  }
  .check input {
    accent-color: var(--signal);
  }
  .draft-bar {
    position: sticky;
    bottom: 14px;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    margin-top: 22px;
    padding: 10px 12px 10px 18px;
    border-radius: 12px;
    background: var(--ink);
    color: var(--bg);
    box-shadow: var(--shadow-2);
  }
  .draft-bar p {
    margin: 0;
    font-size: 14px;
    min-width: 0;
  }
  .last {
    opacity: 0.7;
  }
  .bar-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .bar-buttons button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    font: 500 13px var(--font-sans);
    cursor: pointer;
  }
  .ghost {
    border: 1px solid color-mix(in oklab, var(--bg) 35%, transparent);
    background: transparent;
    color: var(--bg);
  }
  .solid {
    border: 0;
    background: var(--bg);
    color: var(--ink);
  }
  .bar-buttons button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .stale {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.8rem;
    margin: 0 0 1rem;
    border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    font-size: 0.875rem;
  }
  .stale span {
    flex: 1;
    min-width: 14rem;
  }
  .toast {
    position: fixed;
    right: 20px;
    bottom: 84px;
    z-index: 20;
    max-width: 26rem;
    margin: 0;
    padding: 10px 14px;
    border-radius: 9px;
    background: var(--paper);
    box-shadow: var(--shadow-2);
    font-size: 13.5px;
  }
  .small {
    font-size: 13px;
  }
  .alert p {
    margin: 0;
  }
  @media (max-width: 1000px) {
    .ruling-body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
