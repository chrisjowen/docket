<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Explained, PricedBy } from '@docket/platform-canonical-store'
  import { Bot, FileText, Lock, Server, UserRound } from '@lucide/svelte'

  import { BAND_LABELS, BAND_STAMP } from '$lib/trust/bands'

  /**
   * How a confidence was reached, observation by observation: the trust
   * design's "Why 0.93". Each source counts once, at its strongest
   * observation, priced by the policy that names it; what the writer claimed
   * of a source shows apart from what the org attests; who filed it is
   * recorded, never scored.
   */
  interface Props {
    explained: Explained
    /** Where the policies are edited, for the rule chips; none for a reader who cannot. */
    policiesUrl?: string | null
    /** Shown as the score's caption: "Confidence", "Score". */
    label?: string
    /** Leave out the big score, where the page already shows it. */
    scored?: boolean
  }
  let { explained, policiesUrl = null, label = 'Confidence', scored = true }: Props = $props()

  const fmt = (value: number) => value.toFixed(2)
  const signed = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`
  const observations = $derived(explained.groups.reduce((sum, group) => sum + group.observations.length, 0))
  const icon = (source: string) => (/person|human|people|member/.test(source) ? UserRound : /git|code|repo|system|api|runtime|infra/.test(source) ? Server : FileText)
  const ruleHref = (rule: PricedBy) => (policiesUrl ? `${policiesUrl}&rule=${encodeURIComponent(rule.policy)}` : null)
  const ago = (at: string | undefined) => (at ? at.slice(0, 10) : null)
</script>

<div class="why" data-testid="why">
  {#if scored}<div class="scorebox">
    <span class="label">{label}</span>
    <span class="big" data-testid="why-score">{fmt(explained.confidence)}</span>
    <span class="sub">
      <span class="stamp {BAND_STAMP[explained.band]}">{BAND_LABELS[explained.band]}</span>
      <span class="muted">{explained.groups.length} source{explained.groups.length === 1 ? '' : 's'} · {observations} observation{observations === 1 ? '' : 's'}</span>
    </span>
  </div>{/if}

  {#if explained.basis === 'unevidenced'}
    <p class="muted small">No evidence on file: the ontology's default for a record with none.</p>
  {:else if explained.basis === 'stated'}
    <p class="muted small">No evidence on file: the confidence its document states.</p>
  {/if}

  {#each explained.groups as group, g (`${group.source}:${group.instance ?? ''}`)}
    {@const Icon = icon(group.source)}
    <section class="src-group" data-source={group.source} style="--i: {g}">
      <div class="gh">
        <span class="src-ico" aria-hidden="true"><Icon size={14} /></span>
        <div>
          {#if group.source}<b>{group.instance ?? 'Not registered'}</b> <span class="muted">· {group.source}</span>{:else}<b>No source given</b>{/if}
          <div class="attrs">
            {#each group.attributes as attribute (`${attribute.how}:${attribute.name}`)}
              {#if attribute.how === 'attested'}
                <span class="chip att" title="Attested: the directory, a connection or the registry says so"><Lock size={10} aria-hidden="true" /> {attribute.name} {attribute.value}</span>
              {:else if attribute.how === 'claimed'}
                <span class="chip clm" title="Claimed by the writer: the source lets them say so">{attribute.name} {attribute.value}</span>
              {:else}
                <span class="chip ign" title="A claim that does not count: only the directory, a connection or the registry may set it">{attribute.name} {attribute.value}</span>
              {/if}
            {:else}
              <span class="muted small">no attributes</span>
            {/each}
          </div>
        </div>
        <span class="meter"><span class="bar {BAND_STAMP[explained.band]}"><i style="width: {group.best * 100}%"></i></span><b>{fmt(group.best)}</b></span>
      </div>
      {#each group.observations as observation, o (o)}
        <div class="obs" class:dim={!observation.counts} data-counts={observation.counts}>
          {#if observation.note}<p class="q">{observation.note}</p>{/if}
          {#if Object.keys(observation.locator).length}
            <p class="loc">{#each Object.entries(observation.locator) as [field, value] (field)}<span class="chip"><span class="muted">{field}</span> {value}</span> {/each}</p>
          {/if}
          <p class="why-line">
            {#if observation.self}<span class="self"><Bot size={12} aria-hidden="true" /> cited no source, so the person it acts for is the source</span>{/if}
            {#if observation.secondHand}<span class="self">names {observation.secondHand}: counts as the writer's person until they confirm</span>{/if}
            {#if observation.base}
              {@render rule(observation.base)}
            {:else}
              <span class="rule-ref">No policy matches <b>{fmt(observation.score - observation.adjustments.reduce((sum, each) => sum + each.value, 0))}</b></span>
            {/if}
            {#each observation.adjustments as adjustment (adjustment.policy)}{@render rule(adjustment)}{/each}
            <span class="mono">= {fmt(observation.score)}</span>
            {#if !observation.counts}<span class="muted">· same source, a stronger observation counts instead</span>{/if}
          </p>
          {#if observation.beaten.length}
            <p class="beaten muted small">Also matched: {#each observation.beaten as lost, i (lost.policy)}{i ? ', ' : ''}<s>{lost.policy} {fmt(lost.value)}</s>{/each}</p>
          {/if}
          <p class="meta">
            {#if observation.observedBy}<span>Filed by {observation.observedBy}{observation.principal ? ` for ${observation.principal}` : ''}</span>{/if}
            {#if ago(observation.observedAt)}<span>{ago(observation.observedAt)}</span>{/if}
            {#if observation.reportedBy}<span>reported by {observation.reportedBy}</span>{/if}
            <span>not scored: who filed it</span>
          </p>
        </div>
      {/each}
    </section>
  {/each}

  {#if explained.groups.length}
    <div class="formula">
      <span class="label">How they add up</span>
      <p class="eq" data-testid="why-formula">
        1 − {#each explained.groups as group, i (`${group.source}:${group.instance ?? ''}`)}{i ? ' × ' : ''}(1 − {fmt(group.best)}){/each} = <b>{fmt(explained.confidence)}</b>
      </p>
      <p class="muted small">
        Each distinct source counts once, at its strongest observation; separate sources are treated as independent, and nothing goes above {fmt(explained.cap)}.
        {#if observations > explained.groups.length}{observations} observations, {explained.groups.length} sources.{/if}
      </p>
    </div>
  {/if}
</div>

{#snippet rule(priced: PricedBy)}
  {@const href = ruleHref(priced)}
  {#if href}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the schema editor's resolved path, given by the page, with the policy as its query -->
    <a class="rule-ref" class:adj={priced.adjust} class:neg={priced.value < 0} href={href}>{priced.policy} <b>{priced.adjust ? signed(priced.value) : fmt(priced.value)}</b></a>
  {:else}
    <span class="rule-ref" class:adj={priced.adjust} class:neg={priced.value < 0}>{priced.policy} <b>{priced.adjust ? signed(priced.value) : fmt(priced.value)}</b></span>
  {/if}
{/snippet}

<style>
  .why {
    display: grid;
    gap: 6px;
  }
  .scorebox {
    display: grid;
    gap: 4px;
    margin-bottom: 6px;
  }
  .big {
    font: 400 52px/0.9 var(--font-serif);
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .src-group {
    border-top: 1px solid var(--rule);
    padding: 12px 0 4px;
    animation: rise 0.35s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 40ms);
  }
  .src-group:first-of-type {
    border-top: 0;
  }
  .gh {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
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
  .attrs {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 5px;
  }
  .meter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 600 12px var(--font-mono);
  }
  .meter .bar {
    width: 48px;
    height: 4px;
    border-radius: 2px;
    background: var(--sunk);
    overflow: hidden;
  }
  .meter .bar i {
    display: block;
    height: 100%;
    background: var(--ink-2);
  }
  .meter .bar.ok i {
    background: var(--ok);
  }
  .meter .bar.warn i {
    background: var(--warn);
  }
  .meter .bar.red i {
    background: var(--signal);
  }
  .obs {
    margin: 8px 0 4px 40px;
    padding: 9px 11px;
    border: 1px solid var(--rule);
    border-radius: 9px;
    background: var(--bg);
  }
  .obs.dim {
    opacity: 0.62;
  }
  .obs p {
    margin: 0;
  }
  .q {
    font-size: 13.5px;
  }
  .loc,
  .why-line,
  .meta,
  .beaten {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 6px !important;
    font-size: 12.5px;
  }
  .meta {
    gap: 4px 12px;
    color: var(--mute);
  }
  .self {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--info);
    font-size: 12px;
  }
  .rule-ref {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
    color: inherit;
    font-size: 12px;
    text-decoration: none;
  }
  .rule-ref b {
    font: 600 11.5px var(--font-mono);
  }
  .rule-ref.adj b {
    color: var(--info);
  }
  .rule-ref.adj.neg b {
    color: var(--signal);
  }
  .formula {
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--sunk);
  }
  .eq {
    margin: 6px 0;
    font: 500 13px/1.7 var(--font-mono);
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 12.5px;
  }
  @media (max-width: 700px) {
    .obs {
      margin-left: 0;
    }
  }
</style>
