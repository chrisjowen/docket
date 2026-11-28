<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Renderer } from '@openuidev/svelte-lang'

  import { resolveRef, sourceKey } from '$lib/ask/agent'
  import type { AgentAnswer, AnswerSource } from '$lib/ask/model'
  import { typeCode } from '$lib/docket'

  import { setAnswerContext } from './answer/context'
  import { answerLibrary } from './answer/library'
  import Steps from './steps.svelte'

  /**
   * The agent's answer, as a memorandum: To, Re and what it was drawn from;
   * what it looked up, step by step, folded away; the answer it wrote, drawn
   * with the answer components (prose whose citations are numbered footnotes,
   * record cards, lists and tables linking into the graph); then the footnotes
   * - the records it cites, in the order first cited - and the records it also
   * consulted.
   */
  interface Props {
    agent: AgentAnswer
    question: string
    /** Who asked: the memo's addressee. */
    to: string
    org: string
    /** A record type's colour in a docket. */
    colourOf: (workspace: string, type: string) => string
    /** A docket's name, by slug. */
    docketName: (slug: string) => string
    /** The record a footnote is pointing at, `<workspace>/<id>`. */
    lit?: string | null
  }

  let { agent, question, to, org, colourOf, docketName, lit = $bindable(null) }: Props = $props()

  const cited = $derived(agent.sources.filter((source) => source.cited))
  const also = $derived(agent.sources.filter((source) => !source.cited))
  const many = $derived(agent.workspaces.length > 1)
  /** Records also consulted, shown before "and N more". */
  const ALSO_SHOWN = 8
  let more = $state(false)

  setAnswerContext({
    get org() {
      return org
    },
    resolve: (ref) => resolveRef(ref, agent.sources),
    footnote: (source) => cited.indexOf(source) + 1,
    colourOf: (workspace, type) => colourOf(workspace, type),
    docketName: (slug) => docketName(slug),
    get many() {
      return many
    },
    lit: {
      get key() {
        return lit
      },
      set key(value) {
        lit = value
      },
    },
  })
</script>

{#snippet row(source: AnswerSource, no: number | null)}
  <li data-testid="source" data-id={source.id} data-workspace={source.workspace}>
    <a
      class="src"
      class:uncited={no === null}
      class:on={lit === sourceKey(source)}
      href="{resolve('/a/[org]/d/[ws]/graph', { org, ws: source.workspace })}?focus={encodeURIComponent(source.id)}"
      onmouseenter={() => (lit = sourceKey(source))}
      onmouseleave={() => (lit = null)}
      onfocus={() => (lit = sourceKey(source))}
      onblur={() => (lit = null)}
    >
      <span class="n mono">{no ?? '–'}</span>
      <span class="t">
        {#if source.type}<span class="code" style="--c: {colourOf(source.workspace, source.type)}">{typeCode(source.type)}</span>{/if}
        <b>{source.title}</b>
        <span class="mono muted">{source.id}</span>
        {#if many}<span class="muted">{docketName(source.workspace)}</span>{/if}
        {#if source.stale}<span class="stamp warn" title="The index answered from an older revision than the documents hold">Stale</span>{/if}
      </span>
      <span class="by mono">{source.foundBy.join(' · ')}</span>
    </a>
  </li>
{/snippet}

<article class="card memo" data-testid="agent-answer">
  <div class="memo-head">
    <div class="title"><b>Memorandum</b></div>
    <span class="label">To</span><span>{to}</span>
    <span class="label">Re</span><span><b>{question}</b></span>
    <span class="label">Drawn from</span>
    <span>
      {[
        agent.workspaces.map((workspace) => workspace.name).join(', '),
        agent.error ? null : `${cited.length} ${cited.length === 1 ? 'source' : 'sources'} cited`,
        agent.model,
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  </div>
  {#if agent.steps.length}
    <details class="looked">
      <summary class="label">What I looked up · {agent.steps.length} {agent.steps.length === 1 ? 'step' : 'steps'}</summary>
      <Steps steps={agent.steps} {docketName} {many} />
    </details>
  {/if}
  {#if agent.error}
    <p class="alert" role="alert">{agent.error}</p>
  {:else}
    {#if agent.ui}
      <div class="memo-body"><Renderer response={agent.ui} library={answerLibrary} /></div>
    {/if}
    {#if agent.notice}<p class="notice muted" data-testid="answer-notice">{agent.notice}</p>{/if}
  {/if}
  {#if agent.sources.length}
    <ol class="footnotes" data-testid="sources">
      {#if cited.length}
        <li class="label" aria-hidden="true">Footnotes</li>
        {#each cited as source, index (sourceKey(source))}{@render row(source, index + 1)}{/each}
      {/if}
      {#if also.length}
        <li class="label" aria-hidden="true">Also consulted</li>
        {#each more ? also : also.slice(0, ALSO_SHOWN) as source (sourceKey(source))}{@render row(source, null)}{/each}
        {#if !more && also.length > ALSO_SHOWN}
          <li><button class="link small" type="button" onclick={() => (more = true)}>and {also.length - ALSO_SHOWN} more</button></li>
        {/if}
      {/if}
    </ol>
  {:else if !agent.error}
    <p class="notice muted small">The look-ups found nothing in the record for that question.</p>
  {/if}
</article>

<style>
  .memo {
    padding: 0;
    overflow: hidden;
    min-width: 0;
  }
  .memo-head {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 5px 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--rule);
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }
  .memo-head .title {
    grid-column: 1 / -1;
    margin-bottom: 4px;
  }
  .memo-head .title b {
    font: 600 11.5px var(--font-mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .memo-head .label {
    padding-top: 2px;
  }
  .looked {
    padding: 10px 24px;
    border-bottom: 1px solid var(--rule);
  }
  .looked summary {
    cursor: pointer;
  }
  .looked[open] summary {
    margin-bottom: 6px;
  }
  .memo-body {
    padding: 18px 24px 12px;
  }
  .notice {
    margin: 0;
    padding: 4px 24px 12px;
  }
  .small {
    font-size: 13px;
  }
  .alert {
    margin: 14px 24px;
  }
  .footnotes {
    margin: 0;
    padding: 10px 24px 16px;
    border-top: 1px solid var(--rule);
    list-style: none;
    display: grid;
    gap: 1px;
  }
  .footnotes .label {
    margin: 6px 0 4px;
  }
  .src {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    width: 100%;
    min-height: 42px;
    padding: 7px 8px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
    transition: background 0.15s;
  }
  .src:hover,
  .src.on {
    background: var(--sunk);
  }
  .src .n {
    font-size: 11px;
    font-weight: 600;
    color: var(--signal);
  }
  .src.uncited .n {
    color: var(--mute);
  }
  .src .t {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .src .t .mono {
    font-size: 12px;
  }
  .src .by {
    font-size: 11px;
    color: var(--mute);
  }
  .link {
    padding: 4px 8px;
    border: 0;
    background: none;
    color: var(--signal);
    cursor: pointer;
  }
  @media (max-width: 900px) {
    .memo-head,
    .looked,
    .memo-body,
    .footnotes {
      padding-left: 16px;
      padding-right: 16px;
    }
    .src {
      grid-template-columns: 22px minmax(0, 1fr);
    }
    .src .by {
      grid-column: 2;
    }
  }
</style>
