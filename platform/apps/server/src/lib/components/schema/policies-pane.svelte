<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { DraftCheck } from '@docket/platform-ontology-service'
  import { Info, Lock, Plus, Trash2, TriangleAlert, X } from '@lucide/svelte'
  import { onDestroy, untrack } from 'svelte'
  import { stringify, type Document } from 'yaml'

  import { typeCode } from '$lib/docket'
  import {
    OPERATORS,
    OPERATOR_LABELS,
    TRUST_DEFAULTS,
    conditionsOf,
    conditionText,
    fmt,
    joinCondition,
    policiesOf,
    sentence,
    setPolicies,
    setTrust,
    signed,
    specificity,
    splitCondition,
    type ConditionModel,
    type OntologyModel,
    type Operator,
    type PolicyModel,
  } from '$lib/ontology/editor'
  import { BAND_LABELS, BAND_STAMP, SETTER_LABELS, conditionFields, typeColor, unknownConditions } from '$lib/ontology/schema'
  import type { TrustData } from '$lib/ontology/schema'

  interface Props {
    model: OntologyModel
    text: string
    readonly: boolean
    apply: (change: (doc: Document) => void, note: string) => void
    selected: number | null
    onselect: (index: number | null) => void
    trySource: string | null
    check: DraftCheck | null
    trust: TrustData & { records: { id: string; title: string; type: string; confidence: number }[] }
    scoreUrl: string
    csrf: string | null
    head: number
  }
  let { model, text, readonly, apply, selected, onselect, trySource, check, trust, scoreUrl, csrf, head }: Props = $props()

  const policies = $derived(policiesOf(model))
  const base = $derived(policies.map((policy, index) => ({ policy, index })).filter(({ policy }) => policy.adjust === undefined))
  const adjustments = $derived(policies.map((policy, index) => ({ policy, index })).filter(({ policy }) => policy.adjust !== undefined))
  const sources = $derived(Object.keys(model.sources ?? {}))
  const types = $derived(Object.keys(model.resourceTypes))
  const relationships = $derived(Object.keys(model.relationships))
  const trustSettings = $derived(model.trust ?? {})
  const accept = $derived(trustSettings.accept ?? {})
  const editing = $derived(selected !== null && policies[selected] ? selected : null)
  let view = $state<'rules' | 'yaml'>('rules')

  /** Writes the policy list with one policy changed (or removed, or added). */
  function change(next: PolicyModel[], note: string) {
    apply((doc) => setPolicies(doc, next), note)
  }
  const update = (index: number, patch: Partial<PolicyModel>, note: string) =>
    change(
      policies.map((policy, i) => (i === index ? ({ ...policy, ...patch } as PolicyModel) : policy)),
      note,
    )
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
  const number = (raw: string): number | undefined => (raw.trim() === '' || Number.isNaN(Number(raw)) ? undefined : Number(raw))

  function addPolicy() {
    const source = trySample.source || sources[0]
    if (!source) return
    const name = (() => {
      for (let n = 1; ; n += 1) {
        const candidate = n === 1 ? `${source} evidence` : `${source} evidence ${n}`
        if (!policies.some((policy) => policy.name === candidate)) return candidate
      }
    })()
    change([...policies, { name, when: { source }, score: 0.6 }], `added “${name}”`)
    onselect(policies.length)
  }

  function setWhen(index: number, when: PolicyModel['when'], note: string) {
    update(index, { when }, note)
  }

  // --- The sample observation: what would this evidence score? ------------------

  type Sample = { about: string; source: string; instance: string; claims: Record<string, string>; locator: Record<string, string>; record: string }
  let trySample = $state<Sample>(untrack(() => ({ about: '', source: trySource ?? Object.keys(model.sources ?? {})[0] ?? '', instance: '', claims: {}, locator: {}, record: '' })))
  $effect(() => {
    if (trySource && trySource !== untrack(() => trySample.source)) trySample = { ...trySample, source: trySource, instance: '', claims: {}, locator: {} }
  })
  const sampleSource = $derived(model.sources?.[trySample.source])
  const instances = $derived.by(() => {
    const definition = sampleSource
    if (!definition) return []
    if (definition.kind === 'identity') return trust.people.map((person) => ({ value: person.login, label: person.name ? `${person.name} (@${person.login})` : `@${person.login}` }))
    const setters = Object.values(definition.attributes ?? {}).map((attribute) => attribute.setBy)
    return [
      ...(setters.includes('registry') ? trust.registered.filter((entry) => entry.source === trySample.source).map((entry) => ({ value: entry.instance, label: entry.instance })) : []),
      ...(setters.includes('connection') ? trust.repositories.map((repository) => ({ value: repository.fullName, label: repository.fullName })) : []),
    ]
  })

  type Verdict = {
    ok: true
    score: number
    band: keyof typeof BAND_LABELS
    clamped: boolean
    fallback: number
    cap: number
    source: { source: string; instance: string; attributes: Record<string, unknown>; attested: string[]; claimed: string[]; ignored: string[]; secondHand?: string }
    base: { policy: string; score?: number } | null
    beaten: { policy: string; score?: number }[]
    adjustments: { policy: string; adjust?: number }[]
    record: { id: string; title: string; before: number; after: number; sameInstance: boolean } | null
  }
  let verdict = $state<Verdict | { ok: false; problem: string } | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  $effect(() => {
    const body = { yaml: text, ...$state.snapshot(trySample) }
    if (!body.source) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const mine = ++sequence
      try {
        const response = await fetch(scoreUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' }, body: JSON.stringify(body) })
        if (mine !== sequence) return
        verdict = response.ok ? await response.json() : { ok: false, problem: `The preview failed (${response.status}).` }
      } catch {
        if (mine === sequence) verdict = { ok: false, problem: 'The preview could not reach the server.' }
      }
    }, 180)
  })
  onDestroy(() => clearTimeout(timer))
  const scored = $derived(verdict && verdict.ok ? verdict : null)
  const rowState = (policy: PolicyModel) =>
    !scored
      ? ''
      : scored.base?.policy === policy.name
        ? 'hit'
        : scored.adjustments.some((each) => each.policy === policy.name)
          ? 'hit-adj'
          : scored.beaten.some((each) => each.policy === policy.name)
            ? 'lost'
            : ''

  /** The options a sample attribute's box offers: its declared values, else free text. */
  const optionsOf = (attribute: string) => (sampleSource?.attributes?.[attribute]?.enum ?? []).map(String)

  // --- The re-score against the record ---------------------------------------------

  const bandChanges = $derived(check ? check.rescored.filter((each) => each.bandBefore !== each.bandAfter) : [])
  const quietChanges = $derived(check ? check.rescored.filter((each) => each.bandBefore === each.bandAfter) : [])

  const yamlOf = $derived(stringify({ sources: model.sources ?? {}, trust: model.trust ?? {} }, { lineWidth: 0 }))

  /** An object without one of its keys. */
  const without = <T extends object>(value: T, key: string): T => Object.fromEntries(Object.entries(value).filter(([each]) => each !== key)) as T
</script>

<div class="thresholds card" aria-label="Thresholds">
  {#each [
    { label: 'Accepted as fact at', path: ['accept', 'default'], value: accept.default, fallback: TRUST_DEFAULTS.accept, note: Object.entries(accept).filter(([key]) => key !== 'default').map(([key, value]) => `${key} ${fmt(value)}`).join(' · ') || 'for every type' },
    { label: 'Established at', path: ['bands', 'established'], value: trustSettings.bands?.established, fallback: TRUST_DEFAULTS.established, note: 'shown without a caveat' },
    { label: 'Probable at', path: ['bands', 'probable'], value: trustSettings.bands?.probable, fallback: TRUST_DEFAULTS.probable, note: 'Ask hedges below this' },
    { label: 'No policy matches', path: ['fallback'], value: trustSettings.fallback, fallback: TRUST_DEFAULTS.fallback, note: 'the fallback' },
  ] as cell (cell.label)}
    <div class="cell">
      <span class="label">{cell.label}</span>
      {#if readonly}
        <b class="big">{fmt(cell.value ?? cell.fallback)}</b>
      {:else}
        <input class="big" type="number" min="0" max="1" step="0.05" aria-label={cell.label} value={cell.value ?? cell.fallback} onchange={(e) => {
          const value = number(e.currentTarget.value)
          apply((doc) => setTrust(doc, cell.path, value === undefined ? undefined : clamp(value, 0, 1)), `${cell.label.toLowerCase()} ${value ?? 'default'}`)
        }} />
      {/if}
      <span class="muted small">{cell.note}</span>
    </div>
  {/each}
</div>
<p class="muted small fine">
  A record with no evidence at all is {fmt(trustSettings.unevidenced ?? TRUST_DEFAULTS.unevidenced)}; nothing goes above {fmt(trustSettings.cap ?? TRUST_DEFAULTS.cap)}.
</p>

<div class="pol-grid">
  <div class="left">
    <section class="card rules" aria-label="Policies">
      <div class="rules-head">
        <div class="seg" role="group" aria-label="Show policies as">
          <button type="button" aria-pressed={view === 'rules'} onclick={() => (view = 'rules')}>Rules</button>
          <button type="button" aria-pressed={view === 'yaml'} onclick={() => (view = 'yaml')}>YAML</button>
        </div>
        {#if !readonly}<button type="button" class="button small" onclick={addPolicy} disabled={!sources.length}><Plus size={13} aria-hidden="true" /> Add policy</button>{/if}
      </div>
      {#if view === 'yaml'}
        <pre class="yaml" aria-label="Sources and policies as YAML">{yamlOf}</pre>
      {:else}
        {#each [{ title: 'Base scores · the most specific match sets the score', rows: base, adjust: false }, { title: 'Adjustments · every match applies', rows: adjustments, adjust: true }] as table (table.title)}
          <h3 class="sec">{table.title}</h3>
          {#if table.rows.length}
            <table class="pol-table" aria-label={table.adjust ? 'Adjustments' : 'Base scores'}>
              <thead><tr><th>Policy</th><th>About</th><th>Found in</th><th>Only when</th><th class="num">{table.adjust ? 'Adjust' : 'Score'}</th></tr></thead>
              <tbody>
                {#each table.rows as { policy, index } (index)}
                  <tr class="{rowState(policy)}" class:sel={editing === index} data-policy={policy.name} onclick={(e) => {
                    if ((e.target as Element).closest('input')) return
                    onselect(index)
                  }}>
                    <td><b>{policy.name}</b></td>
                    <td>{#if policy.when.about}<span class="code" style="--c: {typeColor(policy.when.about)}">{typeCode(policy.when.about)}</span> {policy.when.about}{:else}<span class="muted">anything</span>{/if}</td>
                    <td class="mono">{policy.when.source}</td>
                    <td>
                      {#each conditionsOf(policy) as [field, condition] (field)}<span class="chip">{conditionText(field, condition)}</span> {/each}
                      {#if !conditionsOf(policy).length}<span class="muted">always</span>{/if}
                    </td>
                    <td class="num">
                      {#if readonly}
                        <span class="mono" class:up={(policy.adjust ?? 0) > 0} class:down={(policy.adjust ?? 0) < 0}>{policy.adjust !== undefined ? signed(policy.adjust) : fmt(policy.score)}</span>
                      {:else}
                        <input
                          class="score-in mono"
                          class:up={(policy.adjust ?? 0) > 0}
                          class:down={(policy.adjust ?? 0) < 0}
                          type="number"
                          step="0.05"
                          min={table.adjust ? -1 : 0}
                          max="1"
                          aria-label="{table.adjust ? 'Adjustment' : 'Score'} of {policy.name}"
                          value={policy.adjust ?? policy.score}
                          onchange={(e) => {
                            const value = number(e.currentTarget.value)
                            if (value === undefined) return
                            const next = clamp(value, table.adjust ? -1 : 0, 1)
                            update(index, table.adjust ? { adjust: next } : { score: next }, `“${policy.name}” → ${table.adjust ? signed(next) : fmt(next)}`)
                          }}
                        />
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="muted small">{table.adjust ? 'No adjustments.' : 'No base scores: every observation scores the fallback.'}</p>
          {/if}
        {/each}
        <p class="legend small">
          <span class="chip hit">green</span> sets the sample's score
          <span class="chip hit-adj">blue</span> adjusts it
          <span class="chip lost">grey</span> matched, but a more specific rule won. Ties go to the lower score.
        </p>
      {/if}
    </section>

    {#if editing !== null && view === 'rules'}
      {@const index = editing}
      {@const policy = policies[index] as PolicyModel}
      {@const conditions = conditionsOf(policy)}
      {@const fields = conditionFields(model, policy.when.source)}
      {@const unknown = unknownConditions(model, policy)}
      <section class="card editor" aria-label="Edit policy">
        <div class="editor-head">
          <h3>Edit policy</h3>
          {#if !readonly}
            <button type="button" class="button small danger" onclick={() => {
              change(policies.filter((_, i) => i !== index), `removed “${policy.name}”`)
              onselect(null)
            }}><Trash2 size={13} aria-hidden="true" /> Remove</button>
          {/if}
        </div>
        <label>
          <span class="label">Name</span>
          <input value={policy.name} disabled={readonly} onchange={(e) => {
            const value = e.currentTarget.value.trim()
            if (!value || policies.some((other, i) => i !== index && other.name === value)) return (e.currentTarget.value = policy.name)
            update(index, { name: value }, `renamed a policy to “${value}”`)
          }} />
        </label>
        <div class="pair">
          <label>
            <span class="label">About</span>
            <select disabled={readonly} value={policy.when.about ?? ''} onchange={(e) => {
              const rest = without(policy.when, 'about')
              const value = e.currentTarget.value
              setWhen(index, value ? { ...rest, about: value } : rest, `“${policy.name}” now about ${value || 'anything'}`)
            }}>
              <option value="">Anything</option>
              <optgroup label="Types">{#each types as type (type)}<option value={type}>{type}</option>{/each}</optgroup>
              <optgroup label="Relationships">{#each relationships as rel (rel)}<option value={rel}>{rel}</option>{/each}</optgroup>
              <option value="supersedes">supersedes (a proposal)</option>
            </select>
          </label>
          <label>
            <span class="label">Found in · source</span>
            <select disabled={readonly} value={policy.when.source} onchange={(e) => {
              const value = e.currentTarget.value
              setWhen(index, { ...(policy.when.about ? { about: policy.when.about } : {}), source: value }, `“${policy.name}” now found in ${value}`)
            }}>
              {#each sources as source (source)}<option value={source}>{source}</option>{/each}
              {#if !sources.includes(policy.when.source)}<option value={policy.when.source}>{policy.when.source} (not a source)</option>{/if}
            </select>
          </label>
        </div>
        <span class="label">Only when</span>
        {#each conditions as [field, condition], c (field)}
          {@const parts = splitCondition(condition)}
          <div class="cond">
            <select aria-label="Condition {c + 1} field" disabled={readonly} value={field} onchange={(e) => {
              const next = e.currentTarget.value
              const entries = Object.entries(policy.when).map(([key, value]) => (key === field ? [next, value] : [key, value]))
              setWhen(index, Object.fromEntries(entries) as PolicyModel['when'], `“${policy.name}”: tests ${next}`)
            }}>
              {#each [...new Set([...fields, field])] as option (option)}<option value={option}>{option.startsWith('@') ? `pointer: ${option.slice(1)}` : option}</option>{/each}
            </select>
            <select aria-label="Condition {c + 1} operator" disabled={readonly} value={parts.op} onchange={(e) => {
              const op = e.currentTarget.value as Operator
              setWhen(index, { ...policy.when, [field]: joinCondition(op, parts.value) as ConditionModel }, `“${policy.name}”: ${field} ${OPERATOR_LABELS[op]}`)
            }}>
              {#each OPERATORS as op (op)}<option value={op}>{OPERATOR_LABELS[op]}</option>{/each}
            </select>
            <input class="mono" aria-label="Condition {c + 1} value" disabled={readonly} value={parts.value} onchange={(e) => {
              const value = e.currentTarget.value
              setWhen(index, { ...policy.when, [field]: joinCondition(parts.op, value) as ConditionModel }, `“${policy.name}”: ${field} ${OPERATOR_LABELS[parts.op]} ${value}`)
            }} />
            {#if !readonly}
              <button type="button" class="icon-btn" aria-label="Remove condition {c + 1}" onclick={() => {
                setWhen(index, without(policy.when, field), `“${policy.name}”: removed a condition`)
              }}><X size={13} /></button>
            {/if}
          </div>
        {/each}
        {#if unknown.length}
          <p class="warn small"><TriangleAlert size={13} aria-hidden="true" /> {policy.when.source} declares no {unknown.join(', ')}: this condition never holds.</p>
        {/if}
        {#if !readonly}
          <div>
            <button type="button" class="button small" disabled={!fields.some((option) => !(option in policy.when))} onclick={() => {
              const field = fields.find((option) => !(option in policy.when))
              if (field) setWhen(index, { ...policy.when, [field]: '' }, `“${policy.name}”: added a condition`)
            }}><Plus size={13} aria-hidden="true" /> Condition</button>
          </div>
        {/if}
        <div class="effect">
          <div class="seg" role="group" aria-label="Effect">
            <button type="button" disabled={readonly} aria-pressed={policy.adjust === undefined} onclick={() => {
              if (policy.adjust === undefined) return
              change(policies.map((each, i) => (i === index ? { ...without(policy, 'adjust'), score: 0.6 } : each)), `“${policy.name}” sets a score`)
            }}>Set score</button>
            <button type="button" disabled={readonly} aria-pressed={policy.adjust !== undefined} onclick={() => {
              if (policy.adjust !== undefined) return
              change(policies.map((each, i) => (i === index ? { ...without(policy, 'score'), adjust: 0.05 } : each)), `“${policy.name}” adjusts`)
            }}>Adjust by</button>
          </div>
          <input class="mono" type="number" step="0.05" min={policy.adjust !== undefined ? -1 : 0} max="1" aria-label="Value of {policy.name}" disabled={readonly} value={policy.adjust ?? policy.score} onchange={(e) => {
            const value = number(e.currentTarget.value)
            if (value === undefined) return
            update(index, policy.adjust !== undefined ? { adjust: clamp(value, -1, 1) } : { score: clamp(value, 0, 1) }, `“${policy.name}” → ${value}`)
          }} />
        </div>
        <p class="sentence" data-testid="policy-sentence">{sentence(policy)}</p>
        <p class="muted small">Specificity {specificity(policy)}: naming what it is about counts one, and so does each condition. The most specific matching score wins.</p>
      </section>
    {/if}

    {#if check && !readonly}
      <section class="card impact" aria-label="Re-score against the record" id="impact">
        <div class="editor-head"><h3>Re-score against the record</h3><span class="label">Draft vs v{head}</span></div>
        {#if check.rescored.length || check.proposals.length}
          <ul>
            {#each bandChanges as each (`${each.resourceId} ${each.link?.rel ?? ''} ${each.link?.target ?? ''}`)}
              <li>
                <span class="mono">{each.resourceId}{each.link ? ` ${each.link.rel} → ${each.link.target}` : ''}</span>
                <span class="mono">{fmt(each.before)} → {fmt(each.after)}</span>
                <span class="stamp {BAND_STAMP[each.bandAfter]}">now {BAND_LABELS[each.bandAfter]}</span>
              </li>
            {/each}
            {#if quietChanges.length}
              <li class="muted">{quietChanges.length} more record{quietChanges.length === 1 ? '' : 's'} and link{quietChanges.length === 1 ? '' : 's'} move within their band.</li>
            {/if}
            {#each check.proposals as each (each.proposal)}
              <li>
                <span class="mono">proposal on {each.resource}</span>
                <span class="mono">{fmt(each.before)} → {fmt(each.after)} of {fmt(each.threshold)}</span>
                {#if each.change === 'would-accept'}<span class="stamp ok">would be accepted</span>{:else}<span class="stamp warn">would no longer pass</span>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted small">No record or pending proposal in this docket changes score.</p>
        {/if}
        <p class="muted small">Publishing a policy change is a <b>re-score</b>, not a "safe" change: the check lists every band that moves and every pending proposal that would cross its bar. Accepted proposals stay accepted.</p>
      </section>
    {/if}
  </div>

  <aside class="card try" aria-label="What would this evidence score?" aria-live="polite">
    <h3>What would this evidence score?</h3>
    <div class="pair">
      <label>
        <span class="label">About a</span>
        <select bind:value={trySample.about}>
          <option value="">anything</option>
          <optgroup label="Types">{#each types as type (type)}<option value={type}>{type}</option>{/each}</optgroup>
          <optgroup label="Relationships">{#each relationships as rel (rel)}<option value={rel}>{rel}</option>{/each}</optgroup>
        </select>
      </label>
      <label>
        <span class="label">Found in</span>
        <select value={trySample.source} onchange={(e) => (trySample = { ...trySample, source: e.currentTarget.value, instance: '', claims: {}, locator: {} })}>
          {#each sources as source (source)}<option value={source}>{source}</option>{/each}
        </select>
      </label>
    </div>
    <label>
      <span class="label">Which one</span>
      <select bind:value={trySample.instance}>
        <option value="">Not registered (named by the writer)</option>
        {#each instances as instance (instance.value)}<option value={instance.value}>{instance.label}</option>{/each}
      </select>
    </label>
    {#if Object.keys(sampleSource?.attributes ?? {}).length}
      <span class="label">Attributes</span>
      <div class="pills">
        {#each Object.entries(sampleSource?.attributes ?? {}) as [key, attribute] (key)}
          {@const attested = scored?.source.attested.includes(key)}
          <div class="attr-pill" data-attribute={key}>
            <span class="mono key">{key}{attribute.setBy === 'reporter' ? ' · claimed' : attested ? '' : ` · ${SETTER_LABELS[attribute.setBy].toLowerCase()} only`}</span>
            {#if attested}
              <span class="chip att"><Lock size={10} aria-hidden="true" /> {String(scored?.source.attributes[key])}</span>
            {:else}
              {#if scored?.source.ignored.includes(key)}<span class="chip ign">ignored</span>{/if}
              {#if optionsOf(key).length}
                <select aria-label="Claim {key}" bind:value={trySample.claims[key]}>
                  <option value="">—</option>
                  {#each optionsOf(key) as option (option)}<option value={option}>{option}</option>{/each}
                </select>
              {:else}
                <input class="mono" aria-label="Claim {key}" placeholder={attribute.type} bind:value={trySample.claims[key]} />
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if Object.keys(sampleSource?.locator ?? {}).length}
      <span class="label">Points to</span>
      <div class="pair">
        {#each Object.entries(sampleSource?.locator ?? {}) as [field, locator] (field)}
          <input class="mono" aria-label="Pointer {field}" placeholder="{field}{locator.required ? ' *' : ''}" bind:value={trySample.locator[field]} />
        {/each}
      </div>
    {/if}

    {#if verdict && !verdict.ok}
      <p class="muted small">{verdict.problem}</p>
    {:else if scored}
      <div class="verdict" data-testid="verdict">
        <div class="verdict-head">
          <span class="big" data-testid="verdict-score">{fmt(scored.score)}</span>
          <span class="stamp {BAND_STAMP[scored.band]}">{BAND_LABELS[scored.band]}</span>
        </div>
        <ol class="steps">
          <li><span>1</span><span>Source: {scored.source.source} · {scored.source.instance.includes(':') ? scored.source.instance.slice(scored.source.source.length + 1) : 'not registered'}</span><span></span></li>
          {#if scored.source.secondHand}<li><span>!</span><span>Names {scored.source.secondHand}: counts as the writer's person until they confirm</span><span></span></li>{/if}
          {#each scored.source.ignored as key (key)}
            <li><span>!</span><span>Ignored the writer's <code>{key} = {trySample.claims[key]}</code>: only the {SETTER_LABELS[sampleSource?.attributes?.[key]?.setBy ?? 'registry'].toLowerCase()} may set it</span><span></span></li>
          {/each}
          {#if scored.base}
            <li><span>2</span><span>{scored.base.policy} · most specific</span><span>{fmt(scored.base.score)}</span></li>
          {:else}
            <li><span>2</span><span>No policy matches: the fallback</span><span>{fmt(scored.fallback)}</span></li>
          {/if}
          {#each scored.beaten as lost (lost.policy)}
            <li class="lost"><span></span><span>{lost.policy}</span><span>{fmt(lost.score)}</span></li>
          {/each}
          {#each scored.adjustments as each (each.policy)}
            <li><span>+</span><span>{each.policy}</span><span>{signed(each.adjust ?? 0)}</span></li>
          {/each}
          {#if scored.clamped}<li><span>=</span><span>Kept within 0 to {fmt(scored.cap)}</span><span></span></li>{/if}
        </ol>
        <div class="combo">
          <label>
            Add it to
            <select bind:value={trySample.record} aria-label="Add it to a record">
              <option value="">no record</option>
              {#each trust.records as record (record.id)}<option value={record.id}>{record.title}</option>{/each}
            </select>
          </label>
          {#if scored.record}
            <p>
              {scored.record.title}: <b>{fmt(scored.record.before)}</b> → <b>{fmt(scored.record.after)}</b>
              {#if scored.record.sameInstance}<span> · it already cites this source, so only the stronger observation counts</span>{:else if scored.record.after === scored.record.before && scored.record.before >= scored.cap}<span> · already at the cap</span>{/if}
            </p>
          {/if}
        </div>
      </div>
    {:else if !sources.length}
      <p class="muted small"><Info size={13} aria-hidden="true" /> Add a source type first.</p>
    {/if}
  </aside>
</div>

<style>
  .thresholds {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 0;
    overflow: hidden;
  }
  .cell {
    display: grid;
    gap: 4px;
    padding: 14px 18px;
    border-left: 1px solid var(--rule);
  }
  .cell:first-child {
    border-left: 0;
  }
  .big {
    font: 400 34px/1 var(--font-serif);
  }
  input.big {
    width: 6.5rem;
    height: auto;
    padding: 0;
    border: 0;
    border-bottom: 1px dashed var(--rule-2);
    border-radius: 0;
    background: transparent;
  }
  .fine {
    margin: 8px 2px 16px;
  }
  .pol-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    gap: 16px;
    align-items: start;
  }
  .left {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .rules,
  .editor,
  .impact,
  .try {
    padding: 16px 18px;
    min-width: 0;
  }
  .rules-head,
  .editor-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .editor-head h3,
  .try h3 {
    margin: 0;
    font: 600 14px var(--font-sans);
  }
  .pol-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .pol-table th {
    padding: 6px 8px;
    text-align: left;
    font: 500 10.5px/1.2 var(--font-mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--mute);
    border-bottom: 1px solid var(--rule);
  }
  .pol-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--rule);
    vertical-align: middle;
  }
  .pol-table tr {
    cursor: pointer;
  }
  .pol-table tr:hover {
    background: var(--sunk);
  }
  .pol-table tr.hit {
    background: color-mix(in oklab, var(--ok-soft) 70%, transparent);
  }
  .pol-table tr.hit-adj {
    background: color-mix(in oklab, var(--info-soft) 70%, transparent);
  }
  .pol-table tr.lost {
    background: color-mix(in oklab, var(--sunk) 70%, transparent);
    color: var(--mute);
  }
  .pol-table tr.sel {
    box-shadow: inset 0 1px 0 var(--ink), inset 0 -1px 0 var(--ink);
  }
  .num {
    text-align: right;
  }
  .score-in {
    width: 66px;
    height: 28px;
    text-align: right;
  }
  .up {
    color: var(--ok);
  }
  .down {
    color: var(--signal);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 12px 0 0;
    color: var(--ink-2);
  }
  .chip.hit {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .chip.hit-adj {
    color: var(--info);
    background: var(--info-soft);
  }
  .chip.lost {
    color: var(--mute);
  }
  .yaml {
    margin: 12px 0 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--sunk);
    font: 12.5px/1.5 var(--font-mono);
    white-space: pre-wrap;
    max-height: 36rem;
    overflow: auto;
  }
  .editor {
    display: grid;
    gap: 10px;
  }
  label {
    display: grid;
    gap: 4px;
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 10px;
  }
  .cond {
    display: grid;
    grid-template-columns: 1.2fr 90px 1fr 34px;
    gap: 8px;
    align-items: center;
  }
  .effect {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .effect input {
    width: 7rem;
  }
  .sentence {
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--sunk);
    font-size: 14px;
  }
  .warn {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--warn);
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
  .impact ul {
    list-style: none;
    margin: 10px 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .impact li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .try {
    position: sticky;
    top: 64px;
    display: grid;
    gap: 10px;
  }
  .pills {
    display: grid;
    gap: 6px;
  }
  .attr-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 6px 4px 10px;
    border: 1px solid var(--rule);
    border-radius: 7px;
    background: var(--bg);
  }
  .attr-pill .key {
    font-size: 12px;
    color: var(--ink-2);
  }
  .attr-pill input,
  .attr-pill select {
    width: 8rem;
    height: 28px;
  }
  .verdict {
    padding: 14px 16px;
    border-radius: 10px;
    background: var(--ink);
    color: var(--bg);
  }
  .verdict-head {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .verdict .big {
    font-size: 46px;
  }
  .verdict .stamp {
    transform: none;
    background: transparent;
  }
  .verdict .stamp.ok {
    color: #7fe0ae;
  }
  .verdict .stamp.warn {
    color: #f8b86a;
  }
  .verdict .stamp.red {
    color: #ff8a7a;
  }
  .steps {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 13px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    gap: 8px;
  }
  .steps li > span:first-child {
    font-family: var(--font-mono);
    opacity: 0.55;
  }
  .steps li > span:last-child {
    font-family: var(--font-mono);
  }
  .steps li.lost {
    opacity: 0.5;
    text-decoration: line-through;
  }
  .steps code {
    font-size: 12px;
  }
  .combo {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in oklab, var(--bg) 25%, transparent);
    font-size: 13px;
  }
  .combo label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .combo select {
    flex: 1;
    min-width: 0;
    height: 30px;
  }
  .combo p {
    margin: 8px 0 0;
  }
  .small {
    font-size: 13px;
  }
  @media (max-width: 1400px) {
    .pol-grid {
      grid-template-columns: minmax(0, 1fr) 360px;
    }
  }
  @media (max-width: 1100px) {
    .pol-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .try {
      position: static;
    }
  }
  @media (max-width: 700px) {
    .thresholds {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .cell:nth-child(3) {
      border-left: 0;
    }
    .pol-table {
      display: block;
      overflow-x: auto;
    }
  }
</style>
