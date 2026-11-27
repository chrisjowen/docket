<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import { Check, GitPullRequestArrow, ShieldCheck, X } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import Why from '$lib/components/trust/why.svelte'
  import { typeCode } from '$lib/docket'
  import type { loadProposals } from '$lib/server/proposals'

  /**
   * Replacements awaiting proof (trust design §6.3): the queue of supersede
   * proposals, and one beside it - the two records, why, how far its evidence
   * has got and what would carry it, the decisions, its evidence explained,
   * what search and the agent are told meanwhile, and its history.
   */
  type Loaded = Awaited<ReturnType<typeof loadProposals>>
  interface Props {
    data: Loaded & {
      org: { slug: string }
      workspace: { slug: string; name: string }
      user: { login: string } | null
      csrf: string | null
    }
    form: { decision?: string; problem?: string; flash?: string } | null
  }
  let { data, form }: Props = $props()

  const ws = $derived({ org: data.org.slug, ws: data.workspace.slug })
  const detail = $derived(data.detail)
  const FILTERS = [
    { status: 'pending', label: 'Pending' },
    { status: 'accepted', label: 'Accepted' },
    { status: 'rejected', label: 'Rejected' },
    { status: 'all', label: 'All' },
  ] as const
  const STAMP = { pending: 'pending', accepted: 'ok', rejected: 'red' } as const
  const fmt = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toFixed(2))
  const short = (id: string) => id.slice(0, 8)
  const ago = (at: string) => {
    const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days}d ago` : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const day = (at: string | null | undefined) =>
    at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : ''

  /** Hovering a way to carry it ghosts the gauge to where that would reach. */
  let ghost = $state<number | null>(null)
  const need = $derived(detail && detail.score !== null && detail.threshold !== null ? Math.max(0, detail.threshold - detail.score) : 0)
  const gaugeTone = $derived(detail?.status === 'accepted' ? 'ok' : detail?.status === 'rejected' ? 'red' : 'warn')
  let rejecting = $state(false)
  let overriding = $state(false)

  /** What the queue's timeline says happened, oldest first. */
  const timeline = $derived.by(() => {
    if (!detail) return []
    const events: { at: string; tone: 'ok' | 'red' | 'warn' | 'info'; text: string }[] = [
      { at: detail.recordedAt, tone: 'info', text: `Proposed by ${detail.recordedBy}${detail.source === 'consolidation' ? ' (consolidation)' : ''}` },
    ]
    for (const entry of detail.evidence) {
      const at = typeof entry.observedAt === 'string' ? entry.observedAt : null
      if (at && at !== detail.recordedAt) events.push({ at, tone: 'info', text: `Evidence from ${typeof entry.observedBy === 'string' ? entry.observedBy : 'someone'}${typeof entry.note === 'string' && entry.note ? `: “${entry.note}”` : ''}` })
    }
    if (detail.decidedAt) {
      events.push({
        at: detail.decidedAt,
        tone: detail.status === 'accepted' ? 'ok' : 'red',
        text:
          detail.status === 'rejected'
            ? `Rejected by ${detail.decidedBy ?? 'someone'}${detail.rejection ? `: ${detail.rejection}` : ''}`
            : detail.override
              ? `Accepted regardless by ${detail.decidedBy ?? 'someone'}: ${detail.override}`
              : `Crossed ${fmt(detail.threshold)}: accepted. ${detail.resource} is now out of date`,
      })
    }
    return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  })
</script>

<svelte:head>
  <title>Proposals · {data.workspace.name}</title>
</svelte:head>

<div class="head">
  <div>
    <h1>Replacements <em>awaiting proof</em></h1>
    <p class="muted lede">
      An agent, or consolidation, says a newer record replaces an older one. It stays a proposal until its evidence clears the bar the policies set; until then the
      older record is still the answer.
    </p>
  </div>
</div>

<nav class="filters seg" aria-label="Proposals by status">
  {#each FILTERS as filter (filter.status)}
    <a href="{resolve('/o/[org]/w/[ws]/proposals', ws)}?status={filter.status}" aria-current={data.status === filter.status ? 'page' : undefined}
      >{filter.label} <span class="count">{data.counts[filter.status]}</span></a
    >
  {/each}
</nav>

<div class="grid">
  <ul class="queue card" aria-label="Proposals" data-testid="proposal-queue">
    {#each data.queue as item (item.id)}
      <li>
        <a
          href="{resolve('/o/[org]/w/[ws]/proposals/[id]', { ...ws, id: item.id })}?status={data.status}"
          aria-current={detail?.id === item.id ? 'page' : undefined}
          data-proposal={item.id}
        >
          <span class="row"
            ><span class="docket-no">{short(item.id)}</span><span class="stamp {STAMP[item.status]}">{item.status === 'pending' ? `Pending · ${fmt(item.score)}` : item.status}</span></span
          >
          <b>{item.byTitle ?? item.by}</b>
          <span class="muted small">replaces {item.resourceTitle ?? item.resource} · {ago(item.recordedAt)}</span>
        </a>
      </li>
    {:else}
      <li class="none muted small">
        {data.status === 'pending' ? 'Nothing awaiting proof: every proposal has been carried or decided.' : `No ${data.status === 'all' ? '' : data.status} proposals.`}
      </li>
    {/each}
  </ul>

  {#if detail}
    <article class="detail" aria-labelledby="proposal-title" data-testid="proposal" data-status={detail.status}>
      <header>
        <p class="row"><GitPullRequestArrow size={15} aria-hidden="true" /><span class="docket-no" title={detail.id}>{short(detail.id)}</span><span class="stamp {STAMP[detail.status]}" data-testid="proposal-status">{detail.status}</span>{#if detail.stale}<span class="stamp red" title="Nothing has happened to it for a while">Stale</span>{/if}</p>
        <h2 id="proposal-title">{detail.new?.title ?? detail.by} <em>replaces</em> {detail.old?.title ?? detail.resource}</h2>
      </header>

      <div class="versus">
        <div class="side old" class:struck={detail.status === 'accepted'}>
          <p class="row">
            {#if detail.old}<span class="code" title={detail.old.type}>{typeCode(detail.old.type)}</span>{/if}
            <a class="mono small" href="{resolve('/o/[org]/w/[ws]/graph', ws)}?focus={encodeURIComponent(detail.resource)}">{detail.resource}</a>
            {#if detail.status === 'accepted'}<span class="stamp red">Out of date</span>{:else}<span class="stamp ok">Current fact</span>{/if}
          </p>
          <p class="t">{detail.old?.title ?? detail.resource}</p>
          <p class="small muted">{detail.status === 'accepted' ? 'Kept on file as history.' : 'Stays current until the proposal is accepted.'}</p>
        </div>
        <span class="arrow" aria-hidden="true">→</span>
        <div class="side new">
          <p class="row">
            {#if detail.new}<span class="code" title={detail.new.type}>{typeCode(detail.new.type)}</span>{/if}
            <a class="mono small" href="{resolve('/o/[org]/w/[ws]/graph', ws)}?focus={encodeURIComponent(detail.by)}">{detail.by}</a>
            <span class="stamp {STAMP[detail.status]}">{detail.status === 'pending' ? 'Not yet fact' : detail.status === 'accepted' ? 'Current fact' : 'Rejected'}</span>
          </p>
          <p class="t">{detail.new?.title ?? detail.by}</p>
          <p class="small muted">Filed {day(detail.recordedAt)} by {detail.recordedBy}</p>
        </div>
      </div>

      {#if detail.reason}<blockquote class="reason">{detail.reason}</blockquote>{/if}

      {#if detail.score !== null && detail.threshold !== null}
        <section aria-labelledby="gauge-title">
          <h3 class="label" id="gauge-title"><span>{detail.status === 'pending' ? 'How far it has got' : 'Where it ended'}</span></h3>
          <div class="gauge {gaugeTone}" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow={detail.score} aria-label="Score {fmt(detail.score)} of the {fmt(detail.threshold)} it needs" data-testid="gauge">
            {#if ghost !== null}<i class="ghost" style="width: {ghost * 100}%"></i>{/if}
            <i class="fill" style="width: {detail.score * 100}%"></i>
            <span class="bar" style="left: {detail.threshold * 100}%" title="Needs {fmt(detail.threshold)}"></span>
          </div>
          <p class="gauge-legend mono small">
            <span>0</span>
            <span><b>{fmt(detail.score)}</b> now{#if detail.status === 'pending'} · needs {fmt(need)} more to reach {fmt(detail.threshold)}{/if}</span>
            <span>1</span>
          </p>
        </section>
      {/if}

      {#if detail.status === 'pending'}
        {#if detail.carry.length}
          <section aria-labelledby="carry-title">
            <h3 class="label" id="carry-title"><span>What would carry it</span></h3>
            <ul class="carry" data-testid="carry">
              {#each detail.carry as way (`${way.policy}:${way.source}`)}
                <li onpointerenter={() => (ghost = way.reaches)} onpointerleave={() => (ghost = null)}>
                  <span><b>{way.policy}</b> <span class="muted small">· a {way.source}</span></span>
                  <span class="mono">→ {fmt(way.reaches)}</span>
                  {#if way.reaches >= (detail.threshold ?? 1) - 1e-9}<span class="stamp ok">Clears it</span>{:else}<span class="stamp warn">Not enough</span>{/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
        {#if data.canDecide}
          <section class="decide" aria-label="Decide">
            <form method="POST" action="?/confirm" use:enhance>
              <Csrf token={data.csrf} />
              <label class="grow"><span class="visually-hidden">Note</span><input name="note" placeholder="What you know first-hand (optional)" maxlength="1000" /></label>
              <button class="button" type="submit" onpointerenter={() => (ghost = detail.confirmed)} onpointerleave={() => (ghost = null)}>
                <Check size={15} aria-hidden="true" /> Confirm as {data.user?.login ?? 'you'}
              </button>
              {#if detail.confirmed !== null}
                <span class="small muted" data-testid="confirm-worth">Your confirmation would make it <b class="mono">{fmt(detail.confirmed)}</b>{detail.confirmed >= (detail.threshold ?? 1) - 1e-9 ? ': enough to carry it.' : '.'}</span>
              {/if}
            </form>
            <div class="row">
              <button type="button" class="button ghost" aria-expanded={rejecting} onclick={() => ((rejecting = !rejecting), (overriding = false))}><X size={15} aria-hidden="true" /> Reject</button>
              {#if data.canOverride}
                <button type="button" class="button ghost" aria-expanded={overriding} onclick={() => ((overriding = !overriding), (rejecting = false))}><ShieldCheck size={15} aria-hidden="true" /> Accept regardless</button>
              {/if}
            </div>
            {#if rejecting}
              <form method="POST" action="?/reject" use:enhance>
                <Csrf token={data.csrf} />
                <label class="grow"><span class="visually-hidden">Why reject it</span><input name="reason" placeholder="Why it is wrong" required maxlength="1000" /></label>
                <button class="button danger" type="submit">Reject it</button>
              </form>
            {/if}
            {#if overriding}
              <form method="POST" action="?/accept" use:enhance>
                <Csrf token={data.csrf} />
                <label class="grow"><span class="visually-hidden">Why accept it regardless</span><input name="reason" placeholder="Why it is right without the evidence" required maxlength="1000" /></label>
                <button class="button" type="submit">Accept regardless</button>
              </form>
              <p class="small muted">Recorded as an override, with your name and reason. Owners and admins only.</p>
            {/if}
          </section>
        {/if}
      {/if}
      {#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}

      <section aria-labelledby="evidence-title">
        <h3 class="label" id="evidence-title"><span>Evidence so far</span><span>{detail.evidence.length}</span></h3>
        {#if detail.explained.groups.length}
          <Why explained={detail.explained} label="Score" />
        {:else}
          <p class="muted small">No evidence on file: it scores the fallback until someone gives some.</p>
        {/if}
      </section>

      <section aria-labelledby="ask-title">
        <h3 class="label" id="ask-title"><span>How Ask answers now</span></h3>
        <div class="ask" data-testid="ask-now">
          {#if detail.status === 'accepted'}
            <p class="a">{detail.new?.title ?? detail.by} (<span class="mono">{detail.by}</span>). It replaced “{detail.old?.title ?? detail.resource}”.</p>
            <p class="caveat ok">Accepted{detail.override ? ' regardless' : ` at ${fmt(detail.score)}`}: the older record is shown as history, not as current.</p>
          {:else if detail.status === 'pending'}
            <p class="a">{detail.old?.title ?? detail.resource} (<span class="mono">{detail.resource}</span>), the current record.</p>
            <p class="caveat">A pending proposal ({short(detail.id)}, {fmt(detail.score)} of {fmt(detail.threshold)}) says it was replaced by “{detail.new?.title ?? detail.by}”. It has not been proven.</p>
          {:else}
            <p class="a">{detail.old?.title ?? detail.resource} (<span class="mono">{detail.resource}</span>).</p>
            <p class="caveat ok">A proposal to replace it was rejected by {detail.decidedBy ?? 'a member'}.</p>
          {/if}
        </div>
      </section>

      {#if detail.answer}
        <section aria-labelledby="agent-title">
          <h3 class="label" id="agent-title"><span>What the agent gets back</span></h3>
          <p class="small muted">docket_supersede answers at once and the agent moves on; this is its answer with the proposal as it stands now.</p>
          <pre class="mcp" data-testid="agent-answer">{detail.answer.text}

{JSON.stringify(detail.answer.structured, null, 2)}</pre>
        </section>
      {/if}

      <section aria-labelledby="timeline-title">
        <h3 class="label" id="timeline-title"><span>History</span></h3>
        <ol class="timeline">
          {#each timeline as event, at (at)}
            <li class={event.tone}><span>{event.text}</span><span class="muted small">{day(event.at)}</span></li>
          {/each}
        </ol>
      </section>
    </article>
  {:else}
    <div class="detail empty card">
      <p class="muted">Choose a proposal to see its evidence and decide on it.</p>
    </div>
  {/if}
</div>

<style>
  .head {
    margin-bottom: 14px;
  }
  h3.label {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin: 0 0 10px;
  }
  .lede {
    max-width: 62ch;
  }
  .filters {
    display: inline-flex;
    gap: 2px;
    margin-bottom: 16px;
    padding: 3px;
    border-radius: 9px;
    background: var(--sunk);
  }
  .filters a {
    padding: 6px 12px;
    border-radius: 7px;
    color: var(--ink-2);
    font-size: 13px;
    text-decoration: none;
  }
  .filters a[aria-current='page'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-1);
  }
  .count {
    margin-left: 4px;
    color: var(--mute);
    font: 500 11px var(--font-mono);
  }
  .grid {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .queue {
    display: grid;
    margin: 0;
    padding: 6px;
    list-style: none;
  }
  .queue a {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
  }
  .queue a:hover {
    background: var(--sunk);
  }
  .queue a[aria-current='page'] {
    background: var(--sunk);
    box-shadow: inset 3px 0 0 var(--signal);
  }
  .queue .none {
    padding: 12px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
  }
  .detail {
    display: grid;
    gap: 22px;
    min-width: 0;
  }
  .detail.empty {
    padding: 28px;
  }
  h2 {
    margin: 8px 0 0;
    font-size: 30px;
    line-height: 1.08;
  }
  .versus {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 12px;
    align-items: stretch;
  }
  .side {
    display: grid;
    gap: 6px;
    padding: 14px;
    border: 1px solid var(--rule);
    border-radius: 12px;
    background: var(--paper);
  }
  .side p {
    margin: 0;
  }
  .side .t {
    font: 400 20px/1.2 var(--font-serif);
  }
  .side.struck .t {
    color: var(--mute);
    text-decoration: line-through;
  }
  .side.new {
    border-style: dashed;
  }
  .arrow {
    align-self: center;
    color: var(--mute);
    font-size: 20px;
  }
  .reason {
    margin: 0;
    padding: 4px 0 4px 14px;
    border-left: 3px solid var(--rule-2);
    font: 400 18px/1.4 var(--font-serif);
  }
  .gauge {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: var(--sunk);
  }
  .gauge i {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 6px;
    transition: width 0.3s var(--ease-out);
  }
  .gauge .fill {
    background: var(--warn);
  }
  .gauge.ok .fill {
    background: var(--ok);
  }
  .gauge.red .fill {
    background: var(--signal);
  }
  .gauge .ghost {
    background: repeating-linear-gradient(135deg, color-mix(in oklab, var(--ok) 35%, transparent) 0 4px, transparent 4px 8px);
  }
  .gauge .bar {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    background: var(--ink);
  }
  .gauge-legend {
    display: flex;
    justify-content: space-between;
    margin: 6px 0 0;
    color: var(--mute);
  }
  .carry {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .carry li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    padding: 8px 10px;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }
  .carry li:hover {
    border-color: var(--rule-2);
    background: var(--sunk);
  }
  .decide {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--rule);
    border-radius: 12px;
    background: var(--paper);
  }
  .decide form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1 1 16rem;
  }
  .grow input {
    width: 100%;
  }
  .ask {
    padding: 14px;
    border-radius: 12px;
    background: var(--sunk);
  }
  .ask p {
    margin: 0;
  }
  .ask .a {
    font: 400 18px/1.35 var(--font-serif);
  }
  .caveat {
    margin-top: 8px !important;
    padding: 6px 10px;
    border-radius: 7px;
    background: var(--warn-soft);
    font-size: 13px;
  }
  .caveat.ok {
    background: var(--ok-soft);
  }
  .mcp {
    max-height: 22rem;
    margin: 6px 0 0;
    padding: 12px 14px;
    overflow: auto;
    border-radius: 10px;
    background: var(--code-bg);
    color: var(--code-fg);
    font: 12px/1.5 var(--font-mono);
    white-space: pre-wrap;
  }
  .timeline {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0 0 0 14px;
    list-style: none;
    border-left: 2px solid var(--rule);
  }
  .timeline li {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    font-size: 13px;
  }
  .timeline li::before {
    content: '';
    position: absolute;
    top: 6px;
    left: -19px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--info);
  }
  .timeline li.ok::before {
    background: var(--ok);
  }
  .timeline li.red::before {
    background: var(--signal);
  }
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .versus {
      grid-template-columns: minmax(0, 1fr);
    }
    .arrow {
      transform: rotate(90deg);
      justify-self: center;
    }
  }
</style>
