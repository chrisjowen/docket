<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Bot, FileText, Info, Lock, Plus, Server, Trash2, TriangleAlert, UserRound } from '@lucide/svelte'
  import type { Document } from 'yaml'

  import { resolve } from '$app/paths'

  import {
    SETTERS,
    SOURCE_KINDS,
    addSourceType,
    fmt,
    items,
    nameProblem,
    renameKey,
    setValue,
    signed,
    type OntologyModel,
    type Setter,
    type SourceKind,
  } from '$lib/ontology/editor'
  import { KIND_LABELS, SETTER_LABELS, policiesFor, type TrustData } from '$lib/ontology/schema'


  interface Props {
    model: OntologyModel
    readonly: boolean
    attributeTypes: string[]
    selected: string | null
    onselect: (source: string) => void
    apply: (change: (doc: Document) => void, note: string) => void
    onrename: (from: string, to: string) => boolean
    trust: TrustData
    /** Where the org's people and registry APIs are, and the token their writes carry. */
    org: string
    csrf: string | null
    ontry: (source: string) => void
    onpolicy: (index: number) => void
    ontoast: (message: string) => void
  }
  let { model, readonly, attributeTypes, selected, onselect, apply, onrename, trust = $bindable(), org, csrf, ontry, onpolicy, ontoast }: Props = $props()

  const sources = $derived(Object.keys(model.sources ?? {}))
  const current = $derived(selected && model.sources?.[selected] ? selected : (sources[0] ?? null))
  const groups = $derived(
    [...SOURCE_KINDS, undefined].map((kind) => ({ kind, names: sources.filter((name) => model.sources?.[name]?.kind === kind) })).filter((group) => group.names.length),
  )
  const icons = { identity: UserRound, system: Server, content: FileText }

  let adding = $state('')
  let addingKind = $state<SourceKind>('content')
  let addProblem = $state<string | null>(null)
  let newAttribute = $state('')
  let newField = $state('')
  let registering = $state<{ instance: string; values: Record<string, string> }>({ instance: '', values: {} })
  let busy = $state(false)

  function addSource() {
    const name = adding.trim()
    addProblem = nameProblem(name, sources)
    if (addProblem) return
    apply((doc) => addSourceType(doc, name, addingKind), `added the ${name} source`)
    onselect(name)
    adding = ''
  }

  /** How many instances the org has registered of a source: people, repositories or registry entries. */
  function instances(name: string): number {
    const definition = model.sources?.[name]
    const setters = Object.values(definition?.attributes ?? {}).map((attribute) => attribute.setBy)
    if (definition?.kind === 'identity') return trust.people.length
    return (setters.includes('connection') ? trust.repositories.length : 0) + (setters.includes('registry') ? trust.registered.filter((entry) => entry.source === name).length : 0)
  }

  const shown = (value: unknown) => (Array.isArray(value) ? value.join(', ') : value === undefined || value === null || value === '' ? '—' : String(value))

  async function send(url: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<boolean> {
    busy = true
    try {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { message?: string } | null
        ontoast(problem?.message ?? `That was refused (${response.status}).`)
        return false
      }
      return true
    } finally {
      busy = false
    }
  }

  /** Sets one directory attribute of a person: what the org attests, at once; every workspace is scored again. */
  async function setPerson(login: string, attribute: string, raw: string, list: boolean) {
    const person = trust.people.find((each) => each.login === login)
    if (!person) return
    const value = list ? items(raw) : raw.trim()
    const attributes = { ...person.attributes, [attribute]: value }
    if (!(await send(`/api/o/${org}/people/${encodeURIComponent(login)}`, 'PUT', { attributes }))) return
    trust.people = trust.people.map((each) => (each.login === login ? { ...each, attributes } : each))
    ontoast(`${person.name ?? login}'s ${attribute} is now ${shown(value)}. Everything they are the source of is scored again.`)
  }

  async function register(source: string, attributes: string[]) {
    const instance = registering.instance.trim()
    if (!instance) return ontoast('Name the instance first: a document URL, say.')
    const values = Object.fromEntries(attributes.flatMap((name) => (registering.values[name]?.trim() ? [[name, registering.values[name]?.trim()]] : [])))
    if (!(await send(`/api/o/${org}/sources`, 'PUT', { source, instance, attributes: values }))) return
    trust.registered = [...trust.registered.filter((entry) => !(entry.source === source && entry.instance === instance)), { source, instance, attributes: values }]
    registering = { instance: '', values: {} }
    ontoast(`Registered ${instance}. Evidence citing it is scored again.`)
  }

  async function unregister(source: string, instance: string) {
    if (!(await send(`/api/o/${org}/sources?source=${encodeURIComponent(source)}&instance=${encodeURIComponent(instance)}`, 'DELETE'))) return
    trust.registered = trust.registered.filter((entry) => !(entry.source === source && entry.instance === instance))
    ontoast(`${instance} is no longer registered.`)
  }
</script>

<div class="pane">
  <nav class="rail" aria-label="Source types">
    {#each groups as group (group.kind ?? 'other')}
      <p class="label grp">{group.kind ? KIND_LABELS[group.kind] : 'Not grouped'}</p>
      <ul>
        {#each group.names as name (name)}
          {@const Icon = icons[model.sources?.[name]?.kind ?? 'content']}
          <li>
            <button type="button" class:on={current === name} aria-current={current === name ? 'true' : undefined} onclick={() => onselect(name)}>
              <span class="src-ico" aria-hidden="true"><Icon size={14} /></span>
              <span class="mono name">{name}</span>
              {#if instances(name)}<span class="count" title="registered instances">{instances(name)}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted none">No source types yet.</p>
    {/each}
    {#if !readonly}
      <div class="add">
        <input class="mono" aria-label="New source name" placeholder="new source" bind:value={adding} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addSource())} />
        <select aria-label="Kind of the new source" bind:value={addingKind}>
          {#each SOURCE_KINDS as kind (kind)}<option value={kind}>{KIND_LABELS[kind]}</option>{/each}
        </select>
        <button type="button" class="button small" onclick={addSource}><Plus size={13} aria-hidden="true" /> Add source</button>
        {#if addProblem}<p class="problem" role="alert">{addProblem}</p>{/if}
      </div>
    {/if}
  </nav>

  {#if current}
    {@const name = current}
    {@const source = model.sources?.[name] ?? {}}
    {@const attributes = Object.entries(source.attributes ?? {})}
    {@const fields = Object.entries(source.locator ?? {})}
    {@const directoryAttributes = attributes.filter(([, attribute]) => attribute.setBy === 'directory').map(([key]) => key)}
    {@const connectionAttributes = attributes.filter(([, attribute]) => attribute.setBy === 'connection').map(([key]) => key)}
    {@const registryAttributes = attributes.filter(([, attribute]) => attribute.setBy === 'registry').map(([key]) => key)}
    {@const scoring = policiesFor(model, name)}
    <section class="card main" data-source={name} aria-label="Source {name}">
      {#if source.kind === 'identity'}
        <p class="note"><Bot size={15} aria-hidden="true" /><span><b>Agents are not a source.</b> An agent always acts as someone: the user who signed it in over OAuth or owns its personal token, or a system account. What the agent cites is the source. When it cites nothing, the user it acts as is the source, and what the directory says about them is what gets scored. A system account is no person, so what it writes must cite a source.</span></p>
      {:else if attributes.length && attributes.every(([, attribute]) => attribute.setBy === 'reporter')}
        <p class="note warn"><TriangleAlert size={15} aria-hidden="true" /><span><b>Claimed, not attested.</b> Nothing vouches for a {name}: its attributes are whatever the writer says. Compare a source whose attributes only the registry or a connection can set: a writer saying otherwise is ignored.</span></p>
      {/if}
      <div class="title-row">
        <label class="grow">
          <span class="label">Source type</span>
          <input class="title-in" value={name} disabled={readonly} onchange={(e) => {
            if (!onrename(name, e.currentTarget.value.trim())) e.currentTarget.value = name
          }} />
        </label>
        <label>
          <span class="label">Kind</span>
          <select disabled={readonly} value={source.kind ?? ''} onchange={(e) => {
            const value = e.currentTarget.value
            apply((doc) => setValue(doc, ['sources', name, 'kind'], value), `${name} is now ${value || 'ungrouped'}`)
          }}>
            {#if !source.kind}<option value="">Not grouped</option>{/if}
            {#each SOURCE_KINDS as kind (kind)}<option value={kind}>{KIND_LABELS[kind]}</option>{/each}
          </select>
        </label>
        {#if !readonly}
          <button type="button" class="button small danger" onclick={() => apply((doc) => doc.deleteIn(['sources', name]), `removed the ${name} source`)}><Trash2 size={13} aria-hidden="true" /> Remove source</button>
        {/if}
      </div>
      <label>
        <span class="label">What it is</span>
        <textarea rows="2" disabled={readonly} value={source.description ?? ''} placeholder="Where these observations come from, and what to record of one." onchange={(e) => {
          const value = e.currentTarget.value.trim()
          apply((doc) => setValue(doc, ['sources', name, 'description'], value), `${name}: what it is`)
        }}></textarea>
      </label>

      <h3 class="sec">Attributes · what we know about one of these</h3>
      {#if attributes.length}
        <table class="grid" aria-label="Attributes of {name}">
          <thead><tr><th>Name</th><th>Kind</th><th>Values</th><th>Who may set it</th><th><span class="visually-hidden">Remove</span></th></tr></thead>
          <tbody>
            {#each attributes as [key, attribute] (key)}
              <tr data-attribute={key}>
                <td><input class="mono" aria-label="Name of {key}" value={key} disabled={readonly} onchange={(e) => {
                  const to = e.currentTarget.value.trim()
                  if (nameProblem(to, Object.keys(source.attributes ?? {})) && to !== key) return (e.currentTarget.value = key)
                  apply((doc) => renameKey(doc, ['sources', name, 'attributes'], key, to), `${name}: renamed ${key} → ${to}`)
                }} /></td>
                <td><select aria-label="Kind of {key}" disabled={readonly} value={attribute.type} onchange={(e) => {
                  const value = e.currentTarget.value
                  apply((doc) => setValue(doc, ['sources', name, 'attributes', key, 'type'], value), `${name}: ${key} is a ${value}`)
                }}>{#each attributeTypes as kind (kind)}<option value={kind}>{kind}</option>{/each}</select></td>
                <td><input class="mono" aria-label="Allowed values of {key}" placeholder="any" disabled={readonly} value={(attribute.enum ?? []).join(', ')} onchange={(e) => {
                  const value = items(e.currentTarget.value, attribute.type.startsWith('number'))
                  apply((doc) => setValue(doc, ['sources', name, 'attributes', key, 'enum'], value), `${name}: values of ${key}`)
                }} /></td>
                <td>
                  <select class="setby-sel" class:claimed={attribute.setBy === 'reporter'} aria-label="Who may set {key}" disabled={readonly} value={attribute.setBy} onchange={(e) => {
                    const value = e.currentTarget.value as Setter
                    apply((doc) => setValue(doc, ['sources', name, 'attributes', key, 'setBy'], value), `${name}: ${key} set by ${SETTER_LABELS[value].toLowerCase()}`)
                    ontoast(value === 'reporter' ? 'Now claimed: writers may state it, and policies will trust what they say.' : 'Now attested: only that system may set it; writers’ claims are ignored.')
                  }}>
                    {#each SETTERS as setter (setter)}<option value={setter}>{SETTER_LABELS[setter]}</option>{/each}
                  </select>
                </td>
                <td>{#if !readonly}<button type="button" class="icon-btn" aria-label="Remove {key}" onclick={() => apply((doc) => doc.deleteIn(['sources', name, 'attributes', key]), `${name}: removed ${key}`)}><Trash2 size={13} /></button>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted small">No attributes: every {name} is scored alike.</p>
      {/if}
      <p class="legend small">
        <span><i class="dot att"></i><b>Attested</b> values come from the directory, a connection or the registry, and policies trust them.</span>
        <span><i class="dot clm"></i><b>Claimed</b> values come from whoever files the observation.</span>
      </p>
      {#if !readonly}
        <div class="inline-add">
          <input class="mono" aria-label="New attribute name" placeholder="new attribute, e.g. status" bind:value={newAttribute} />
          <button type="button" class="button small" onclick={() => {
            const key = newAttribute.trim()
            if (nameProblem(key, Object.keys(source.attributes ?? {}))) return ontoast('Name the attribute in lowercase letters, digits, - or _.')
            apply((doc) => setValue(doc, ['sources', name, 'attributes', key], { type: 'string', setBy: 'registry' }), `${name}: added ${key}`)
            newAttribute = ''
          }}><Plus size={13} aria-hidden="true" /> Add an attribute</button>
        </div>
      {/if}

      <h3 class="sec">How an observation points into it</h3>
      <p class="muted small">Each source type names its own pointer fields: there is no fixed list of repository, path and lines boxes. The common ones still work on any source.</p>
      {#if fields.length}
        <table class="grid" aria-label="Pointer fields of {name}">
          <thead><tr><th>Field</th><th>Hint for agents</th><th>Required</th><th>Counts once per</th><th><span class="visually-hidden">Remove</span></th></tr></thead>
          <tbody>
            {#each fields as [field, locator] (field)}
              <tr data-field={field}>
                <td class="mono">{field}</td>
                <td><input aria-label="Hint for {field}" disabled={readonly} value={locator.description ?? ''} placeholder="What to put here" onchange={(e) => {
                  const value = e.currentTarget.value.trim()
                  apply((doc) => setValue(doc, ['sources', name, 'locator', field, 'description'], value || undefined), `${name}: hint for ${field}`)
                }} /></td>
                <td><input type="checkbox" aria-label="{field} is required" disabled={readonly} checked={Boolean(locator.required)} onchange={(e) => {
                  const value = e.currentTarget.checked
                  apply((doc) => doc.setIn(['sources', name, 'locator', field], doc.createNode({ ...locator, required: value || undefined }, { flow: true })), `${name}: ${field} ${value ? 'required' : 'optional'}`)
                }} /></td>
                <td><input type="checkbox" aria-label="Count one {name} per {field}" disabled={readonly} checked={(source.identifiedBy ?? []).includes(field)} onchange={(e) => {
                  const next = e.currentTarget.checked ? [...(source.identifiedBy ?? []), field] : (source.identifiedBy ?? []).filter((each) => each !== field)
                  apply((doc) => setValue(doc, ['sources', name, 'identifiedBy'], next), `${name}: one source per ${next.join(', ') || 'kind'}`)
                }} /></td>
                <td>{#if !readonly}<button type="button" class="icon-btn" aria-label="Remove {field}" onclick={() => apply((doc) => doc.deleteIn(['sources', name, 'locator', field]), `${name}: removed ${field}`)}><Trash2 size={13} /></button>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if !readonly}
        <div class="inline-add">
          <input class="mono" aria-label="New pointer field" placeholder="new field, e.g. url or message_id" bind:value={newField} />
          <button type="button" class="button small" onclick={() => {
            const field = newField.trim()
            if (nameProblem(field, Object.keys(source.locator ?? {}))) return ontoast('Name the field in lowercase letters, digits, - or _.')
            apply((doc) => doc.setIn(['sources', name, 'locator', field], doc.createNode({}, { flow: true })), `${name}: added the ${field} field`)
            newField = ''
          }}><Plus size={13} aria-hidden="true" /> Add a pointer field</button>
        </div>
      {/if}

      {#if source.kind === 'identity'}
        <h3 class="sec">People · from the members directory</h3>
        <table class="grid people" aria-label="People">
          <thead><tr><th>Person</th>{#each directoryAttributes as key (key)}<th>{key}</th>{/each}<th>Member</th></tr></thead>
          <tbody>
            {#each trust.people as person (person.login)}
              <tr data-person={person.login}>
                <td>
                  <b>{person.name ?? person.login}</b> <span class="muted mono small">@{person.login}</span>
                </td>
                {#each directoryAttributes as key (key)}
                  {@const declared = source.attributes?.[key]}
                  {@const list = declared?.type.endsWith('[]') ?? false}
                  <td>
                    {#if trust.manage}
                      {#if declared?.enum?.length && !list}
                        <select aria-label="{key} of {person.login}" disabled={busy} value={String(person.attributes[key] ?? '')} onchange={(e) => setPerson(person.login, key, e.currentTarget.value, false)}>
                          <option value="">—</option>
                          {#each declared.enum as option (option)}<option value={String(option)}>{option}</option>{/each}
                        </select>
                      {:else}
                        <input class="mono" aria-label="{key} of {person.login}" disabled={busy} value={shown(person.attributes[key]).replace('—', '')} placeholder={list ? 'comma, separated' : '—'} onchange={(e) => setPerson(person.login, key, e.currentTarget.value, list)} />
                      {/if}
                    {:else if person.attributes[key] !== undefined}
                      <span class="chip att"><Lock size={10} aria-hidden="true" /> {shown(person.attributes[key])}</span>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                {/each}
                <td class="muted small">{person.role}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="muted small foot">Set once per org, by whoever may change its settings, and attested to every workspace's policies. Changing someone's role scores again everything they are the source of. Service accounts act for the person shown above them; change that on <a href={resolve('/o/[org]/members', { org })}>Members &amp; roles</a>.</p>
      {:else if connectionAttributes.length || registryAttributes.length}
        {#if connectionAttributes.length}
          <h3 class="sec">Connected repositories</h3>
          {#if trust.repositories.length}
            <table class="grid" aria-label="Connected repositories">
              <thead><tr><th>Repository</th>{#each connectionAttributes as key (key)}<th>{key}</th>{/each}</tr></thead>
              <tbody>
                {#each trust.repositories as repository (repository.fullName)}
                  <tr>
                    <td class="mono">{repository.fullName}</td>
                    {#each connectionAttributes as key (key)}
                      <td>{#if repository.attributes[key] !== undefined}<span class="chip att"><Lock size={10} aria-hidden="true" /> {shown(repository.attributes[key])}</span>{:else}<span class="muted">—</span>{/if}</td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="muted small">No repository is connected yet.</p>
          {/if}
          <p class="muted small foot">Read from the GitHub app on every sync. Nobody types these in. GitHub reports visibility and branch protection; the source's own attributes of those names take them.</p>
        {/if}
        {#if registryAttributes.length}
          {@const entries = trust.registered.filter((entry) => entry.source === name)}
          <h3 class="sec">Registered sources</h3>
          {#if entries.length}
            <table class="grid" aria-label="Registered {name} sources">
              <thead><tr><th>Source</th>{#each registryAttributes as key (key)}<th>{key}</th>{/each}<th><span class="visually-hidden">Remove</span></th></tr></thead>
              <tbody>
                {#each entries as entry (entry.instance)}
                  <tr data-instance={entry.instance}>
                    <td class="mono">{entry.instance}</td>
                    {#each registryAttributes as key (key)}
                      <td>{#if entry.attributes[key] !== undefined}<span class="chip att"><Lock size={10} aria-hidden="true" /> {shown(entry.attributes[key])}</span>{:else}<span class="muted">—</span>{/if}</td>
                    {/each}
                    <td>{#if trust.manage}<button type="button" class="icon-btn" aria-label="Unregister {entry.instance}" disabled={busy} onclick={() => unregister(name, entry.instance)}><Trash2 size={13} /></button>{/if}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="muted small">Nothing registered yet: a {name} a writer names still counts, but nothing is attested about it.</p>
          {/if}
          {#if trust.manage}
            <div class="inline-add register">
              <input class="mono" aria-label="Instance to register" placeholder="e.g. notion://payments-architecture" bind:value={registering.instance} />
              {#each registryAttributes as key (key)}
                {@const declared = source.attributes?.[key]}
                {#if declared?.enum?.length}
                  <select aria-label="{key} of the new instance" bind:value={registering.values[key]}>
                    <option value="">{key}…</option>
                    {#each declared.enum as option (option)}<option value={String(option)}>{option}</option>{/each}
                  </select>
                {:else}
                  <input class="mono narrow" aria-label="{key} of the new instance" placeholder={key} bind:value={registering.values[key]} />
                {/if}
              {/each}
              <button type="button" class="button small" disabled={busy} onclick={() => register(name, registryAttributes)}><Plus size={13} aria-hidden="true" /> Register</button>
            </div>
          {/if}
          <p class="muted small foot">Kept in the org's source registry; whoever may change its settings marks what is verified. A writer claiming otherwise is ignored.</p>
        {/if}
      {:else}
        <h3 class="sec">Registry</h3>
        <p class="muted small">
          Not registered: any {name} a writer names counts as one source.{#if attributes.length && attributes.every(([, attribute]) => attribute.setBy === 'reporter')} Its attributes are all claimed.{/if}
        </p>
      {/if}
    </section>

    <aside class="side">
      <section class="card">
        <div class="side-head"><h3>Scored by</h3><span class="label">{scoring.length} {scoring.length === 1 ? 'policy' : 'policies'}</span></div>
        {#if scoring.length}
          <ul class="linkrows">
            {#each scoring as { index, policy } (index)}
              <li>
                <button type="button" class="rule-ref" onclick={() => onpolicy(index)}>
                  {policy.name}
                  <b class:adj={policy.adjust !== undefined} class:neg={(policy.adjust ?? 0) < 0}>{policy.adjust !== undefined ? signed(policy.adjust) : fmt(policy.score)}</b>
                </button>
                {#if policy.when.about}<span class="muted small mono">about {policy.when.about}</span>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted small">No policy names this source, so its observations score the fallback.</p>
        {/if}
        <button type="button" class="button small" onclick={() => ontry(name)}><Info size={13} aria-hidden="true" /> Try one in Policies</button>
      </section>
    </aside>
  {:else}
    <section class="card main"><p class="muted">Add a source type: where facts come from - a person, a codebase, a document.</p></section>
  {/if}
</div>

<style>
  .pane {
    display: grid;
    grid-template-columns: 14rem minmax(0, 1fr) 20rem;
    gap: 16px;
    align-items: start;
  }
  .rail {
    position: sticky;
    top: 64px;
  }
  .rail ul {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .grp {
    margin: 10px 8px 4px;
  }
  .rail ul button {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .rail ul button:hover {
    background: var(--sunk);
  }
  .rail ul button.on {
    background: var(--sunk);
    box-shadow: inset 2px 0 0 var(--signal);
  }
  .src-ico {
    display: grid;
    place-items: center;
    width: 30px;
    height: 26px;
    border-radius: 6px;
    background: var(--sunk);
    color: var(--ink-2);
  }
  .rail ul button.on .src-ico {
    background: var(--paper);
  }
  .name {
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .count {
    font: 11px var(--font-mono);
    color: var(--mute);
  }
  .add {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }
  .add .button {
    justify-self: start;
  }
  .main {
    padding: 18px 20px;
    min-width: 0;
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
  }
  .grow {
    flex: 1;
    min-width: 12rem;
  }
  label {
    display: grid;
    gap: 4px;
  }
  .title-in {
    width: 100%;
    font: 400 30px/1.1 var(--font-serif);
    border: 0;
    border-bottom: 1px solid var(--rule);
    border-radius: 0;
    background: transparent;
    padding: 2px 0;
  }
  .title-in:focus {
    border-bottom-color: var(--ink);
    outline: none;
  }
  .note {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--info-soft);
    font-size: 13.5px;
  }
  .note.warn {
    background: var(--warn-soft);
  }
  .note :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  table.grid input,
  table.grid select {
    width: 100%;
    min-width: 0;
  }
  .setby-sel.claimed {
    color: var(--info);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 4px 0 0;
    color: var(--ink-2);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
  }
  .dot.att {
    background: var(--ok);
  }
  .dot.clm {
    background: var(--info);
  }
  .inline-add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .inline-add input {
    flex: 1;
    min-width: 12rem;
  }
  .inline-add input.narrow {
    flex: 0 1 9rem;
    min-width: 6rem;
  }
  .foot {
    margin: 2px 0 0;
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--mute);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--sunk);
    color: var(--ink);
  }
  .side {
    position: sticky;
    top: 64px;
  }
  .side .card {
    padding: 14px 16px;
  }
  .side-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .side h3 {
    margin: 0 0 8px;
    font: 600 14px var(--font-sans);
  }
  .linkrows {
    list-style: none;
    margin: 8px 0 12px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .linkrows li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .rule-ref {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
    padding: 2px 8px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
    color: inherit;
    font: 12.5px var(--font-sans);
    text-align: left;
    cursor: pointer;
  }
  .rule-ref b {
    font: 600 11.5px var(--font-mono);
  }
  .rule-ref b.adj {
    color: var(--info);
  }
  .rule-ref b.neg {
    color: var(--signal);
  }
  .small {
    font-size: 13px;
  }
  .problem {
    margin: 0;
    font-size: 13px;
    color: var(--signal);
  }
  .none {
    font-size: 13px;
  }
  @media (max-width: 1400px) {
    .pane {
      grid-template-columns: 13rem minmax(0, 1fr);
    }
    .side {
      grid-column: 1 / -1;
      position: static;
    }
  }
  @media (max-width: 800px) {
    .pane {
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      position: static;
    }
    table.grid {
      display: block;
      overflow-x: auto;
    }
  }
</style>
