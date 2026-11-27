<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { ArrowUpRight, Plus, Trash2, X } from '@lucide/svelte'
  import type { Document } from 'yaml'

  import Attributes from '$lib/components/ontology/attributes.svelte'
  import { typeCode } from '$lib/docket'
  import {
    addRelation,
    detachRelation,
    lineItems,
    nameProblem,
    relationsFrom,
    relationsTo,
    setTargets,
    setValue,
    fmt,
    signed,
    type OntologyModel,
  } from '$lib/ontology/editor'
  import { policiesAbout, policiesForAnything, typeColor } from '$lib/ontology/schema'

  import Neighbourhood from './neighbourhood.svelte'

  interface Props {
    model: OntologyModel
    readonly: boolean
    usage: { types: Record<string, number>; relationships: Record<string, number> }
    vocabulary: { icons: string[]; attributeTypes: string[] }
    selected: string | null
    onselect: (type: string) => void
    apply: (change: (doc: Document) => void, note: string) => void
    /** Renames a type or relationship, moving what documents use with it; false when the name will not do. */
    onrename: (kind: 'type' | 'relationship', from: string, to: string) => boolean
    onaddtype: (name: string) => string | null
    onremovetype: (name: string) => void
    onpolicy: (index: number) => void
  }
  let { model, readonly, usage, vocabulary, selected, onselect, apply, onrename, onaddtype, onremovetype, onpolicy }: Props = $props()

  const types = $derived(Object.keys(model.resourceTypes))
  const current = $derived(selected && model.resourceTypes[selected] ? selected : (types[0] ?? null))
  let adding = $state('')
  let addProblem = $state<string | null>(null)
  let menu = $state<string | null>(null)
  let relName = $state('')
  let relTarget = $state('*')
  let relProblem = $state<string | null>(null)

  $effect(() => {
    void current
    relName = ''
    relTarget = '*'
    relProblem = null
  })

  function addType() {
    addProblem = onaddtype(adding.trim())
    if (!addProblem) adding = ''
  }

  function addRel(type: string) {
    const name = relName.trim().replace(/\s+/g, '_')
    // An existing relationship's name adds this type to it; a new one must be a valid name.
    relProblem = !name ? 'Name the relation first, e.g. reports_to.' : model.relationships[name] ? null : nameProblem(name, [])
    if (relProblem) return
    apply((doc) => addRelation(doc, model, type, name, relTarget), `${type} ${name} → ${relTarget === '*' ? 'any type' : relTarget}`)
    relName = ''
  }

  const lines = (list: string[] | undefined) => (list ?? []).join('\n')
</script>

<svelte:window onclick={(e) => menu && !(e.target as Element | null)?.closest?.('.add-tgt') && (menu = null)} />

<div class="pane">
  <nav class="rail" aria-label="Types">
    <ul>
      {#each types as name, i (name)}
        <li style="--i: {i}">
          <button type="button" class:on={current === name} aria-current={current === name ? 'true' : undefined} onclick={() => onselect(name)}>
            <span class="code" aria-hidden="true" style="--c: {typeColor(name)}">{typeCode(name)}</span>
            <span class="mono name">{name}</span>
            {#if usage.types[name]}<span class="count" title="records of this type">{usage.types[name]}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="muted none">No types yet.</li>
      {/each}
    </ul>
    {#if !readonly}
      <div class="add">
        <input class="mono" aria-label="New type name" placeholder="new type" bind:value={adding} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addType())} />
        <button type="button" class="button small" onclick={addType}><Plus size={13} aria-hidden="true" /> Add type</button>
        {#if addProblem}<p class="problem" role="alert">{addProblem}</p>{/if}
      </div>
    {/if}
  </nav>

  {#if current}
    {@const name = current}
    {@const type = model.resourceTypes[name] ?? {}}
    {@const own = relationsFrom(model, name)}
    {@const incoming = relationsTo(model, name)}
    {@const naming = policiesAbout(model, name)}
    <section class="card main" data-type={name} aria-label="Type {name}">
      <div class="title-row">
        <label class="grow">
          <span class="label">Type name</span>
          <input
            class="title-in"
            value={name}
            disabled={readonly}
            onchange={(e) => {
              if (!onrename('type', name, e.currentTarget.value.trim())) e.currentTarget.value = name
            }}
          />
        </label>
        <label>
          <span class="label">Icon</span>
          <select disabled={readonly} value={type.icon ?? ''} onchange={(e) => {
            const value = e.currentTarget.value
            apply((doc) => setValue(doc, ['resourceTypes', name, 'icon'], value), `${name}: icon`)
          }}>
            <option value="">docket's default</option>
            {#each vocabulary.icons as icon (icon)}<option value={icon}>{icon}</option>{/each}
            {#if type.icon && !vocabulary.icons.includes(type.icon)}<option value={type.icon}>{type.icon} (not bundled)</option>{/if}
          </select>
        </label>
        {#if !readonly}
          <button type="button" class="button small danger" onclick={() => onremovetype(name)}><Trash2 size={13} aria-hidden="true" /> Remove type</button>
        {/if}
      </div>
      <label>
        <span class="label">Definition</span>
        <textarea rows="2" disabled={readonly} value={type.description ?? ''} placeholder="What a {name} is, in a sentence an agent can file by." onchange={(e) => {
          const value = e.currentTarget.value.trim()
          apply((doc) => setValue(doc, ['resourceTypes', name, 'description'], value), `${name}: definition`)
        }}></textarea>
      </label>
      <p class="hint"><b class="mono">{usage.types[name] ?? 0}</b> record{usage.types[name] === 1 ? ' is' : 's are'} filed as {name}.</p>

      <h3 class="sec">Properties</h3>
      <Attributes
        attributes={type.attributes}
        path={['resourceTypes', name, 'attributes']}
        kinds={vocabulary.attributeTypes}
        {readonly}
        onedit={(change) => apply(change, `${name}: properties`)}
        label="Properties of {name}"
      />

      <h3 class="sec">What a {name} can point to</h3>
      <ul class="rels" aria-label="What a {name} can point to">
        {#each own.filter((relation) => !relation.inherited) as relation (relation.name)}
          {@const to = relation.definition.to}
          {@const shared = Array.isArray(relation.definition.from) ? relation.definition.from.filter((each) => each !== name) : []}
          <li class="rel-row" data-relation={relation.name}>
            <input
              class="mono rel-name"
              aria-label="Relation name"
              value={relation.name}
              disabled={readonly}
              onchange={(e) => {
                if (!onrename('relationship', relation.name, e.currentTarget.value.trim().replace(/\s+/g, '_'))) e.currentTarget.value = relation.name
              }}
            />
            <div class="targets">
              {#if to === '*'}
                <span class="tgt"><span class="chip">any type</span>
                  {#if !readonly}<button type="button" class="x" aria-label="Stop {relation.name} pointing to any type" onclick={() => apply((doc) => setTargets(doc, relation.name, []), `${relation.name} no longer points to any type`)}><X size={11} /></button>{/if}
                </span>
              {:else}
                {#each to as target (target)}
                  <span class="tgt">
                    <span class="code" style="--c: {typeColor(target)}">{typeCode(target)}</span>
                    <span class="mono">{target}</span>
                    {#if !readonly}
                      <button type="button" class="x" aria-label="Stop {relation.name} pointing to {target}" onclick={() => apply((doc) => setTargets(doc, relation.name, to.filter((each) => each !== target)), `${relation.name} no longer points to ${target}`)}><X size={11} /></button>
                    {/if}
                  </span>
                {:else}
                  <span class="muted small">points nowhere yet</span>
                {/each}
                {#if !readonly}
                  <span class="add-tgt">
                    <button type="button" class="dashed" aria-haspopup="menu" aria-expanded={menu === relation.name} onclick={() => (menu = menu === relation.name ? null : relation.name)}>+ type</button>
                    {#if menu === relation.name}
                      <span class="menu" role="menu" aria-label="Types {relation.name} can point to">
                        {#each types.filter((each) => !to.includes(each)) as option (option)}
                          <button type="button" role="menuitem" onclick={() => {
                            apply((doc) => setTargets(doc, relation.name, [...to, option]), `${relation.name} can now point to ${option}`)
                            menu = null
                          }}><span class="code" style="--c: {typeColor(option)}">{typeCode(option)}</span> {option}</button>
                        {/each}
                        <button type="button" role="menuitem" onclick={() => {
                          apply((doc) => setTargets(doc, relation.name, '*'), `${relation.name} can now point to any type`)
                          menu = null
                        }}><em>Any type</em></button>
                      </span>
                    {/if}
                  </span>
                {/if}
              {/if}
              {#if shared.length}<span class="muted small shared">also from {shared.join(', ')}</span>{/if}
            </div>
            <span class="muted small links" title="links recorded">{usage.relationships[relation.name] ?? 0}</span>
            {#if !readonly}
              <button type="button" class="icon-btn" aria-label="Remove {relation.name} from {name}" onclick={() => apply((doc) => detachRelation(doc, model, name, relation.name), `removed ${relation.name} from ${name}`)}><Trash2 size={13} /></button>
            {/if}
          </li>
        {/each}
        {#each own.filter((relation) => relation.inherited) as relation (relation.name)}
          {@const to = relation.definition.to}
          <li class="rel-row incoming" data-relation={relation.name}>
            <span class="mono rel-name">{relation.name}</span>
            <div class="targets">
              {#if to === '*'}<span class="chip">any type</span>{:else}{#each to as target (target)}<span class="tgt"><span class="code" style="--c: {typeColor(target)}">{typeCode(target)}</span><span class="mono">{target}</span></span>{/each}{/if}
              <span class="chip">every type</span>
            </div>
            <span class="muted small links">{usage.relationships[relation.name] ?? 0}</span>
            <span></span>
          </li>
        {/each}
        {#if !own.length}<li class="muted none">Nothing yet.</li>{/if}
      </ul>
      {#if !readonly}
        <div class="rel-add">
          <input class="mono" aria-label="New relation name" placeholder="relation name, e.g. reports_to" bind:value={relName} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addRel(name))} />
          <select aria-label="Points to" bind:value={relTarget}>
            {#each types as option (option)}<option value={option}>→ {option}</option>{/each}
            <option value="*">→ any type</option>
          </select>
          <button type="button" class="button small" onclick={() => addRel(name)}><Plus size={13} aria-hidden="true" /> Add relation</button>
          {#if relProblem}<p class="problem" role="alert">{relProblem}</p>{/if}
        </div>
      {/if}

      <h3 class="sec">Points to a {name}</h3>
      <ul class="rels" aria-label="What points to a {name}">
        {#each incoming as relation (relation.name)}
          {#each relation.from as from (from)}
            <li class="rel-row incoming">
              <span class="mono rel-name">{relation.name}</span>
              <div class="targets">
                <span class="tgt"><span class="code" style="--c: {typeColor(from)}">{typeCode(from)}</span><span class="mono">{from}</span></span>
                <span class="muted">→ {name}</span>
              </div>
              <span class="muted small links">{usage.relationships[relation.name] ?? 0}</span>
              <button type="button" class="icon-btn" aria-label="Edit on {from}" onclick={() => onselect(from)}><ArrowUpRight size={14} /></button>
            </li>
          {/each}
        {:else}
          <li class="muted none">Nothing points here yet.</li>
        {/each}
      </ul>

      <details class="guidance">
        <summary class="sec">Guidance for agents</summary>
        <label>
          Instructions
          <textarea rows="3" disabled={readonly} value={type.extraction?.instructions ?? ''} onchange={(e) => {
            const value = e.currentTarget.value.trim()
            apply((doc) => setValue(doc, ['resourceTypes', name, 'extraction', 'instructions'], value), `${name}: instructions for agents`)
          }}></textarea>
        </label>
        <div class="pair">
          <label>
            Clues, one per line
            <textarea rows="3" disabled={readonly} value={lines(type.extraction?.clues)} onchange={(e) => {
              const value = lineItems(e.currentTarget.value)
              apply((doc) => setValue(doc, ['resourceTypes', name, 'extraction', 'clues'], value), `${name}: clues`)
            }}></textarea>
          </label>
          <label>
            Do not confuse with, one per line
            <textarea rows="3" disabled={readonly} value={lines(type.extraction?.doNotConfuseWith)} onchange={(e) => {
              const value = lineItems(e.currentTarget.value)
              apply((doc) => setValue(doc, ['resourceTypes', name, 'extraction', 'doNotConfuseWith'], value), `${name}: do not confuse with`)
            }}></textarea>
          </label>
        </div>
      </details>
    </section>

    <aside class="side">
      <section class="card">
        <div class="side-head"><h3>Neighbourhood</h3><span class="label">Live</span></div>
        <div class="hood-wrap"><Neighbourhood {model} type={name} /></div>
        <p class="muted small">Solid: what it points to. Dashed: what points to it.</p>
      </section>
      <section class="card">
        <div class="side-head"><h3>Confidence</h3></div>
        <p class="small">
          Set by policies, not on the type.
          {#if naming.length}<b>{naming.length}</b> {naming.length === 1 ? 'policy names' : 'policies name'} {name};{:else}No policy names {name};{/if}
          {policiesForAnything(model)} apply to anything.
        </p>
        {#if type.confidence}
          <p class="note warn small">This type still carries confidence numbers of its own, the old way. Convert the schema on the Policies tab to move them into policies; every score stays the same.</p>
        {/if}
        <ul class="linkrows">
          {#each naming as { index, policy } (index)}
            <li>
              <button type="button" class="rule-ref" onclick={() => onpolicy(index)}>
                {policy.name}
                <b class:adj={policy.adjust !== undefined} class:neg={(policy.adjust ?? 0) < 0}>{policy.adjust !== undefined ? signed(policy.adjust) : fmt(policy.score)}</b>
              </button>
            </li>
          {/each}
        </ul>
        <button type="button" class="button small" onclick={() => onpolicy(-1)}>Open policies</button>
      </section>
    </aside>
  {:else}
    <section class="card main"><p class="muted">Add a type to start: the kinds of record this docket keeps.</p></section>
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
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .rail li {
    animation: rise 0.35s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 25ms);
  }
  .rail ul button {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
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
  .rail .name {
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
  label {
    display: grid;
    gap: 4px;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--mute);
  }
  .sec {
    margin-bottom: 4px;
  }
  .rels {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rel-row {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr) 34px 30px;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--rule);
  }
  .rel-row:first-child {
    border-top: 0;
  }
  .rel-row.incoming {
    color: var(--ink-2);
  }
  .rel-name {
    font-size: 12.5px;
    min-width: 0;
  }
  input.rel-name {
    height: 30px;
  }
  .targets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .tgt {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 4px 2px 3px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
    font-size: 12px;
  }
  .x,
  .icon-btn {
    display: inline-grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--mute);
    cursor: pointer;
    border-radius: 4px;
  }
  .x {
    width: 16px;
    height: 16px;
  }
  .icon-btn {
    width: 28px;
    height: 28px;
  }
  .x:hover,
  .icon-btn:hover {
    background: var(--sunk);
    color: var(--ink);
  }
  .add-tgt {
    position: relative;
  }
  .dashed {
    height: 24px;
    padding: 0 8px;
    border: 1px dashed var(--rule-2);
    border-radius: 6px;
    background: transparent;
    color: var(--mute);
    font: 500 11.5px var(--font-mono);
    cursor: pointer;
  }
  .menu {
    position: absolute;
    z-index: 5;
    top: calc(100% + 4px);
    left: 0;
    display: grid;
    min-width: 190px;
    max-height: 18rem;
    overflow-y: auto;
    padding: 4px;
    border-radius: 8px;
    background: var(--paper);
    box-shadow: var(--shadow-2);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font: 13px var(--font-sans);
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--sunk);
  }
  .shared {
    margin-left: 4px;
  }
  .links {
    text-align: right;
  }
  .rel-add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px dashed var(--rule-2);
  }
  .rel-add input {
    flex: 1;
    min-width: 12rem;
  }
  .guidance summary {
    cursor: pointer;
    list-style: none;
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 10px;
    margin-top: 10px;
  }
  .side {
    display: grid;
    gap: 14px;
    position: sticky;
    top: 64px;
  }
  .side .card {
    padding: 14px 16px;
  }
  .hood-wrap {
    overflow-x: auto;
    margin: 0 -6px;
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
  .small {
    font-size: 13px;
  }
  .note {
    padding: 8px 10px;
    border-radius: 7px;
    background: var(--info-soft);
  }
  .note.warn {
    background: var(--warn-soft);
  }
  .linkrows {
    list-style: none;
    margin: 8px 0 10px;
    padding: 0;
    display: grid;
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
  .problem {
    margin: 0;
    font-size: 13px;
    color: var(--signal);
  }
  .none {
    padding: 6px 0;
    font-size: 13px;
  }
  @media (max-width: 1400px) {
    .pane {
      grid-template-columns: 13rem minmax(0, 1fr);
    }
    .side {
      grid-column: 1 / -1;
      position: static;
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    }
  }
  @media (max-width: 800px) {
    .pane {
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      position: static;
    }
    .rel-row {
      grid-template-columns: minmax(0, 1fr) 30px;
    }
    .rel-row .targets {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .rel-row .links {
      display: none;
    }
  }
</style>
