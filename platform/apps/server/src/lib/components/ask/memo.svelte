<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'

  import { citationSegments, type AnswerSource, type WorkspaceAnswer } from '$lib/ask/model'
  import { typeCode } from '$lib/docket'

  /**
   * One docket's part of an answer, as a memorandum: To, Re and what it was
   * drawn from, the model's text in serif with each citation a numbered
   * footnote, then the footnotes - the cited records in the order first cited,
   * with the stores that found them and a Stale stamp where the index answered
   * from an older revision - and the records also consulted.
   */
  interface Props {
    part: WorkspaceAnswer
    question: string
    /** Who asked: the memo's addressee. */
    to: string
    docketNo: string
    org: string
    /** A record type's colour in this docket. */
    colourOf: (type: string) => string
    /** Just written: its words fade in one after another. */
    fresh?: boolean
    /** The source a footnote is pointing at, `<workspace>/<id>`. */
    lit?: string | null
  }

  let { part, question, to, docketNo, org, colourOf, fresh = false, lit = $bindable(null) }: Props = $props()

  const known = $derived(new Set(part.sources.map((source) => source.id)))
  const paragraphs = $derived((part.text ?? '').split(/\n{2,}/).filter((paragraph) => paragraph.trim()))
  const segments = $derived(paragraphs.map((paragraph) => citationSegments(paragraph, known)))
  /** Footnote numbers, in the order the text first cites each source; cited sources the text never names follow. */
  const order = $derived.by(() => {
    const ids: string[] = []
    for (const parts of segments) for (const segment of parts) if ('cite' in segment && !ids.includes(segment.cite)) ids.push(segment.cite)
    for (const source of part.sources) if (source.cited && !ids.includes(source.id)) ids.push(source.id)
    return ids
  })
  const byId = $derived(new Map(part.sources.map((source) => [source.id, source])))
  const cited = $derived(order.flatMap((id) => byId.get(id) ?? []))
  const also = $derived(part.sources.filter((source) => !order.includes(source.id)))
  const titleOf = (id: string) => byId.get(id)?.title ?? id
  const keyOf = (id: string) => `${part.workspace.slug}/${id}`

  type Piece = { cite: string; i: number } | { words: { word: string; i: number }[] }
  /** Each paragraph's words, numbered across the memo so a fresh one reveals in reading order. */
  const words = $derived.by((): Piece[][] => {
    let at = 0
    return segments.map((parts) =>
      parts.map((segment): Piece => ('cite' in segment ? { cite: segment.cite, i: at++ } : { words: segment.text.split(/(\s+)/).map((word) => ({ word, i: word.trim() ? at++ : -1 })) })),
    )
  })
</script>

{#snippet row(source: AnswerSource, no: number | null)}
  <li data-testid="source" data-id={source.id}>
    <a
      class="src"
      class:uncited={no === null}
      class:on={lit === keyOf(source.id)}
      href="{resolve('/a/[org]/d/[ws]/graph', { org, ws: part.workspace.slug })}?focus={encodeURIComponent(source.id)}"
      onmouseenter={() => (lit = keyOf(source.id))}
      onmouseleave={() => (lit = null)}
      onfocus={() => (lit = keyOf(source.id))}
      onblur={() => (lit = null)}
    >
      <span class="n mono">{no ?? '–'}</span>
      <span class="t">
        {#if source.type}<span class="code" style="--c: {colourOf(source.type)}">{typeCode(source.type)}</span>{/if}
        <b>{source.title}</b>
        <span class="mono muted">{source.id}</span>
        {#if source.stale}<span class="stamp warn" title="The index answered from an older revision than the documents hold">Stale</span>{/if}
      </span>
      <span class="by mono">{source.foundBy.join(' · ')}</span>
    </a>
  </li>
{/snippet}

<article class="card memo" class:fresh data-testid="workspace-answer" data-workspace={part.workspace.slug}>
  <div class="memo-head">
    <div class="title"><b>Memorandum</b>{#if docketNo}<span class="docket-no">{docketNo}</span>{/if}</div>
    <span class="label">To</span><span>{to}</span>
    <span class="label">Re</span><span><b>{question}</b></span>
    <span class="label">Drawn from</span>
    <span>{[part.workspace.name, part.error ? null : `${cited.length} ${cited.length === 1 ? 'source' : 'sources'} cited`, part.model].filter(Boolean).join(' · ')}</span>
  </div>
  {#if part.error}
    <p class="alert" role="alert">{part.error}</p>
  {:else}
    {#if words.length}
      <div class="memo-body">
        {#each words as paragraph, index (index)}
          <p>
            {#each paragraph as piece, at (at)}
              {#if 'cite' in piece}<a
                  class="fn"
                  class:w={fresh}
                  class:on={lit === keyOf(piece.cite)}
                  style="--i: {piece.i}"
                  href="{resolve('/a/[org]/d/[ws]/graph', { org, ws: part.workspace.slug })}?focus={encodeURIComponent(piece.cite)}"
                  aria-label="Footnote {order.indexOf(piece.cite) + 1}: {titleOf(piece.cite)}"
                  onmouseenter={() => (lit = keyOf(piece.cite))}
                  onmouseleave={() => (lit = null)}
                  onfocus={() => (lit = keyOf(piece.cite))}
                  onblur={() => (lit = null)}>{order.indexOf(piece.cite) + 1}</a
                >{:else if fresh}{#each piece.words as { word, i }, w (w)}{#if i >= 0}<span class="w" style="--i: {i}">{word}</span>{:else}{word}{/if}{/each}{:else}{piece.words
                  .map(({ word }) => word)
                  .join('')}{/if}
            {/each}
          </p>
        {/each}
      </div>
    {/if}
    {#if part.notice}<p class="notice muted" data-testid="answer-notice">{part.notice}</p>{/if}
    {#each part.unavailable as message (message)}<p class="notice muted small">Unavailable: {message}</p>{/each}
    {#if part.sources.length}
      <ol class="footnotes" data-testid="sources">
        {#if cited.length}
          <li class="label" aria-hidden="true">Footnotes</li>
          {#each cited as source, index (source.id)}{@render row(source, index + 1)}{/each}
        {/if}
        {#if also.length}
          <li class="label" aria-hidden="true">Also consulted</li>
          {#each also as source (source.id)}{@render row(source, null)}{/each}
        {/if}
      </ol>
    {:else}
      <p class="notice muted small">The projections found nothing in this docket for that question.</p>
    {/if}
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
    display: flex;
    justify-content: space-between;
    align-items: center;
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
  .memo-body {
    padding: 18px 24px 6px;
  }
  .memo-body p {
    margin: 0 0 12px;
    max-width: 64ch;
    font: 400 20px/1.55 var(--font-serif);
    overflow-wrap: anywhere;
  }
  .memo-body .w {
    animation: fade 0.5s var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * 18ms);
  }
  .fn {
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    margin: 0 1px 0 2px;
    vertical-align: super;
    border-radius: 4px;
    background: var(--signal-soft);
    color: var(--signal);
    font: 600 10px/1 var(--font-mono);
    text-decoration: none;
    transition:
      background 0.15s,
      box-shadow 0.2s;
  }
  .fn:hover,
  .fn.on {
    background: var(--signal);
    color: var(--signal-ink);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--signal) 22%, transparent);
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
  .src .by {
    font-size: 11px;
    color: var(--mute);
  }
  @media (max-width: 900px) {
    .memo-head,
    .memo-body,
    .footnotes,
    .notice {
      padding-left: 16px;
      padding-right: 16px;
    }
    .memo-body p {
      font-size: 18.5px;
    }
    .src {
      grid-template-columns: 22px minmax(0, 1fr);
    }
    .src .by {
      grid-column: 2;
    }
  }
</style>
