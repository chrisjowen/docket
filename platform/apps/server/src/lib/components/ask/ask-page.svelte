<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { ArrowRight, Check, ChevronDown, History, Plus, Trash2 } from '@lucide/svelte'
  import { tick } from 'svelte'

  import AgentMemo from '$lib/components/ask/agent-memo.svelte'
  import Memo from '$lib/components/ask/memo.svelte'
  import Steps from '$lib/components/ask/steps.svelte'
  import Results from '$lib/components/ask/results.svelte'
  import CardGraph, { type CardLink, type CardNode } from '$lib/components/graph/card-graph.svelte'
  import Csrf from '$lib/components/csrf.svelte'
  import DocketMark from '$lib/components/shell/docket-mark.svelte'
  import { handoff } from '$lib/ask/handoff.svelte'
  import {
    colourIn,
    isAgentAnswer,
    isAnyAnswer,
    MAX_QUESTION,
    type AgentAnswerBody,
    type AgentStep,
    type AnswerBody,
    type AnswerSource,
    type ChatBody,
    type QuestionBody,
  } from '$lib/ask/model'
  import { ASK_SCOPE_COOKIE, remember, scopeKind, scopeLabel } from '$lib/ask/scope'
  import { typeCode } from '$lib/docket'
  import { layoutCards } from '$lib/graph/cards'

  import type { ActionData, PageData } from '../../../routes/a/[org]/ask/$types'

  /**
   * The Ask page, shared by the casebook's Ask and a docket's Chat tab: the
   * conversation, its saved chats, and the scope chip choosing the dockets
   * asked. On a Chat tab (`data.docket`) the scope is that docket alone.
   */
  let { data, form }: { data: PageData; form: ActionData } = $props()

  /** This page's address: the docket's Chat tab, or the casebook's Ask. */
  const base = $derived(
    data.docket ? resolve('/a/[org]/d/[ws]/ask', { org: data.org.slug, ws: data.docket.slug }) : resolve('/a/[org]/ask', { org: data.org.slug }),
  )

  const me = $derived((page.data.user as { login: string; name: string | null } | null) ?? null)
  const myName = $derived(me ? (me.name ?? me.login) : 'You')
  const dockets = $derived((page.data.dockets as { slug: string; name: string; docketNo: string }[] | undefined) ?? [])
  const docketNos = $derived(new Map(dockets.map((docket) => [docket.slug, docket.docketNo])))
  const names = $derived(new Map(data.workspaces.map((workspace) => [workspace.slug, workspace.name])))

  /** A record type's colour in a docket, as its Record page draws it. */
  const colourOf = (workspace: string, type: string) => colourIn(data.slots, workspace, type)

  const asQuestion = (body: ChatBody) => body as QuestionBody
  const docketName = (slug: string) => names.get(slug) ?? slug

  /** The dockets this conversation is about: an open chat's, else the ones chosen. */
  const about = $derived.by(() => {
    const first = data.chat?.messages.find((message) => !isAnyAnswer(message.body))
    return first ? asQuestion(first.body).workspaces.map((workspace) => workspace.slug) : chosen
  })
  const caption = $derived(
    about.length === 1
      ? `${docketNos.get(about[0] ?? '') ?? ''} · In re ${names.get(about[0] ?? '') ?? about[0]}`
      : `${about.length} dockets · In re ${about.map((slug) => names.get(slug) ?? slug).join(', ')}`,
  )

  /** The dockets the scope chip has chosen: the page's, until the member changes them. */
  let chosen = $derived([...data.selected])
  const allSlugs = $derived(data.workspaces.map((workspace) => workspace.slug))
  const kind = $derived(scopeKind(allSlugs, chosen))
  const scopeText = $derived(scopeLabel(allSlugs, chosen, docketName))
  let picking = $state(false)
  let picker = $state<HTMLDetailsElement>()

  /** Remembers the chosen dockets for the casebook's next Ask, and a search asks them at once. */
  const rescope = async (form?: HTMLFormElement | null) => {
    const value = remember(allSlugs, chosen)
    if (value) document.cookie = `${ASK_SCOPE_COOKIE}=${encodeURIComponent(value)}; path=/a/${data.org.slug}; max-age=31536000; samesite=lax`
    if (data.mode === 'search' && chosen.length) {
      await tick()
      form?.requestSubmit()
    }
  }
  const choose = (slugs: string[], from: HTMLElement) => {
    chosen = slugs
    void rescope(from.closest('form'))
  }

  // A click elsewhere or Escape closes the scope chip's list.
  const closePicker = (event: Event) => {
    if (!picking) return
    if (event instanceof KeyboardEvent ? event.key === 'Escape' : !picker?.contains(event.target as Node)) picking = false
  }

  /** The query string for `params`, keeping the chosen dockets (a Chat tab's is its own). */
  const query = (params: Record<string, string> = {}) => {
    const pairs = [...Object.entries(params), ...(data.docket ? [] : chosen.map((ws) => ['ws', ws]))]
    return pairs.length ? `?${pairs.map(([name, value]) => `${name}=${encodeURIComponent(value ?? '')}`).join('&')}` : ''
  }

  /** The question being answered, and what the agent has looked up so far. */
  let pending = $state<{ text: string; steps: AgentStep[]; writing: boolean } | null>(null)
  let confirming = $state(false)
  /** The answer this visit just asked for: its words fade in. */
  let fresh = $state<number | null>(null)
  /** The source a footnote points at, `<workspace>/<id>`. */
  let lit = $state<string | null>(null)

  const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const dayRule = (iso: string | undefined) => {
    if (!iso) return 'Today'
    const day = new Date(iso)
    return day.toDateString() === new Date().toDateString() ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  }
  const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`)
  const sourcesOf = (body: AnswerBody | AgentAnswerBody) =>
    isAgentAnswer(body) ? body.agent.sources.length : body.answers.reduce((sum, part) => sum + part.sources.length, 0)

  /** The latest memo's cited records, for the Cited panel. */
  const cited = $derived.by((): AnswerSource[] => {
    const last = [...(data.chat?.messages ?? [])].reverse().find((message) => isAnyAnswer(message.body))
    if (!last || !isAnyAnswer(last.body)) return []
    if (isAgentAnswer(last.body)) return last.body.agent.sources.filter((source) => source.cited)
    return last.body.answers.flatMap((part) => part.sources.filter((source) => source.cited))
  })

  // The composer: Enter sends, Shift+Enter breaks the line, and the box grows with what is typed.
  let composer = $state<HTMLFormElement>()
  let box = $state<HTMLTextAreaElement>()
  const grow = () => {
    if (!box) return
    box.style.height = 'auto'
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    if (box?.value.trim()) composer?.requestSubmit()
  }
  /** Puts `text` in the box and sends it. */
  const send = async (text: string) => {
    if (!box || !composer || pending) return
    box.value = text
    grow()
    await tick()
    composer.requestSubmit()
  }

  /** Why the last question streamed got no answer. */
  let problem = $state<string | null>(null)

  /**
   * Asks with the page open: the question goes to `./stream`, each look-up
   * shows as the agent makes it, and the saved chat opens once it answers.
   * Without script the form posts to `?/ask` and the page reloads on the answer.
   */
  async function stream(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    const text = String(form.get('question') ?? '')
    if (!text.trim()) return
    problem = null
    pending = { text, steps: [], writing: false }
    const finish = (why: string | null) => {
      problem = why
      pending = null
    }
    try {
      const response = await fetch(resolve('/a/[org]/ask/stream', { org: data.org.slug }), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': data.csrf ?? '' },
        body: JSON.stringify({ question: text, chat: form.get('chat') ?? '', ws: form.getAll('ws') }),
      })
      if (!response.ok || !response.body) return finish((await response.text()) || 'The question could not be asked just now.')
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffered = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffered += value
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim() || !pending) continue
          const heard = JSON.parse(line) as
            | { type: 'turn'; turn: number }
            | { type: 'step'; index: number; step: AgentStep }
            | { type: 'done'; chat: string }
            | { type: 'problem'; problem: string }
          if (heard.type === 'step') pending.steps[heard.index] = heard.step
          else if (heard.type === 'turn') pending.writing = pending.steps.length > 0 && pending.steps.every((step) => step.state !== 'running')
          else if (heard.type === 'problem') return finish(heard.problem)
          else if (heard.type === 'done') {
            // eslint-disable-next-line svelte/no-navigation-without-resolve -- Ask's resolved path, opening the chat the answer was saved to
            await goto(`${base}?chat=${heard.chat}`, { invalidateAll: true, noScroll: true })
            if (box) box.value = ''
            grow()
            fresh = data.chat?.messages.at(-1)?.seq ?? null
            return finish(null)
          }
        }
      }
      finish('The answer stopped arriving. It may still be saved: look in your chats.')
    } catch {
      finish('The question could not be asked just now. Try again.')
    }
  }

  // The command menu's "Ask: …" lands here with the question to send.
  $effect(() => {
    const question = handoff.question
    if (question === null || data.mode !== 'chat' || !composer) return
    handoff.question = null
    void send(question)
  })

  // The newest turn stays in view: on arrival, as an answer comes in, and when the mode changes.
  let scroller = $state<HTMLDivElement>()
  $effect(() => {
    void data.chat?.messages.length
    void data.search.result
    void data.mode
    void pending
    void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }))
  })

  // On the map: the search's hits and what they link to, as case cards.
  const board = $derived.by(() => {
    const boards = data.search.result?.boards ?? []
    const nodes: CardNode[] = boards.flatMap((one) =>
      one.nodes.map((node) => ({
        id: node.key,
        title: node.title,
        type: node.type,
        ghost: node.ghost,
        code: typeCode(node.type),
        colour: colourOf(node.workspace, node.type),
        weight: node.weight,
        exhibits: node.exhibits,
        flag: node.flag,
        overruled: node.flag === 'Overruled',
        weak: node.flag === 'Uncorroborated',
        recent: false,
      })),
    )
    const links: CardLink[] = boards.flatMap((one) => one.links.map((link) => ({ ...link, weak: false })))
    return { nodes, links, matched: new Set(boards.flatMap((one) => one.matched)), placed: layoutCards(nodes, links) }
  })
  let picked = $state<string | null>(null)
  const pickedNode = $derived.by(() => {
    for (const one of data.search.result?.boards ?? []) {
      const node = one.nodes.find((candidate) => candidate.key === picked)
      if (node) return { node, workspace: one.workspace, match: board.matched.has(node.key) }
    }
    return null
  })

  /** How many results the search found, and in how many of the dockets searched. */
  const tally = $derived.by(() => {
    const result = data.search.result
    if (!result) return { total: 0, dockets: 0 }
    const { notes, memory, exhibits, entries } = result.groups
    const all = [...result.hits, ...notes, ...memory, ...exhibits, ...entries]
    return { total: all.length, dockets: new Set(all.map((item) => item.workspace.slug)).size }
  })
  const filtered = $derived(data.search.filters.types.length > 0 || data.search.filters.tags.length > 0)
  /** In search mode with every docket unchecked, the chip has nothing to search: hide any stale results. */
  const unscoped = $derived(data.mode === 'search' && chosen.length === 0)
  /** Applies a filter or view at once: the search is a GET, so its address can be shared. */
  const apply = (event: Event & { currentTarget: HTMLInputElement }) => event.currentTarget.form?.requestSubmit()

  const PROMPTS = ['Who owns what in this docket?', 'What changed most recently, and why?', 'Which decisions have been overruled?']
</script>

<svelte:head>
  <title>{data.docket ? `Chat · ${data.docket.name}` : 'Chat'} · {data.org.name}</title>
</svelte:head>

<svelte:window onclick={closePicker} onkeydown={closePicker} />

{#snippet botHead(label: string, at?: string)}
  <div class="who">
    <DocketMark size={22} />
    <b>Docket</b>
    {#if at}<time class="mono muted" datetime={at}>{clock(at)}</time>{/if}
    <span class="pill">{label}</span>
  </div>
{/snippet}

{#snippet chatList()}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's resolved path, keeping the scope -->
  <a class="button small new" href="{base}{query()}" data-testid="new-chat"><Plus size={14} aria-hidden="true" /> New chat</a>
  {#if data.chats.length}
    <ul data-testid="chats">
      {#each data.chats as chat (chat.id)}
        <li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's resolved path -->
          <a href="{base}?chat={chat.id}" aria-current={data.chat?.id === chat.id ? 'page' : undefined}>
            <span class="title">{chat.title}</span>
            <time class="mono muted" datetime={chat.updatedAt}>{when(chat.updatedAt)}</time>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted small">Your chats are kept here, for you alone.</p>
  {/if}
{/snippet}

{#snippet scope()}
  {#if data.docket}
    <div class="scope" data-testid="scope" data-kind="one">
      <input type="hidden" name="ws" value={data.docket.slug} />
      <span class="scope-chip fixed">asking <b>{data.docket.name}</b> only</span>
      <a class="widen" href="{resolve('/a/[org]/ask', { org: data.org.slug })}?ws={encodeURIComponent(data.docket.slug)}" data-testid="widen">Chat across dockets</a>
    </div>
  {:else}
    <details class="scope" data-testid="scope" data-kind={kind} bind:open={picking} bind:this={picker}>
      <summary class="scope-chip" aria-label="Dockets asked: {scopeText}">
        across <b>{scopeText}</b>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <fieldset class="card scope-menu" data-testid="workspace-picker">
        <legend class="visually-hidden">Dockets to ask</legend>
        <button type="button" class="scope-row every" aria-pressed={kind === 'all'} onclick={(event) => choose([...allSlugs], event.currentTarget)}>
          <span class="tick" aria-hidden="true">{#if kind === 'all'}<Check size={13} />{/if}</span>
          All dockets
        </button>
        {#each data.workspaces as workspace (workspace.slug)}
          <div class="scope-row">
            <label>
              <input type="checkbox" name="ws" value={workspace.slug} bind:group={chosen} onchange={(event) => rescope(event.currentTarget.form)} />
              <span class="name">{workspace.name}</span>
              {#if docketNos.get(workspace.slug)}<span class="mono muted">{docketNos.get(workspace.slug)}</span>{/if}
            </label>
            <button type="button" class="only" onclick={(event) => choose([workspace.slug], event.currentTarget)} aria-label="Ask {workspace.name} only">only</button>
          </div>
        {/each}
      </fieldset>
    </details>
  {/if}
{/snippet}

{#snippet filters()}
  {#if data.search.facets}
    <details class="filters" open={filtered || data.search.view === 'graph'}>
      <summary>Filter and show records</summary>
      <fieldset>
        <legend>Types</legend>
        {#each data.search.facets.types as type (type.name)}
          <label class="chip"
            ><input type="checkbox" name="type" form="search-form" value={type.name} checked={data.search.filters.types.includes(type.name)} onchange={apply} />
            {type.name} <span class="muted">{type.count}</span></label
          >
        {/each}
      </fieldset>
      {#if data.search.facets.tags.length}
        <fieldset>
          <legend>Tags</legend>
          {#each data.search.facets.tags as tag (tag.name)}
            <label class="chip"
              ><input type="checkbox" name="tag" form="search-form" value={tag.name} checked={data.search.filters.tags.includes(tag.name)} onchange={apply} />
              {tag.name} <span class="muted">{tag.count}</span></label
            >
          {/each}
        </fieldset>
      {/if}
      <fieldset aria-label="Show records">
        <legend>Show</legend>
        <label class="chip"><input type="radio" name="view" form="search-form" value="list" checked={data.search.view === 'list'} onchange={apply} /> List</label>
        <label class="chip"><input type="radio" name="view" form="search-form" value="graph" checked={data.search.view === 'graph'} onchange={apply} /> On the map</label>
      </fieldset>
    </details>
  {/if}
{/snippet}

{#snippet map()}
  <div class="map" data-testid="search-board" data-nodes={board.nodes.length} data-matched={board.matched.size}>
    <CardGraph nodes={board.nodes} links={board.links} placed={board.placed} selected={picked} onselect={(id) => (picked = id)} emptyHint="Nothing matched: try other words or filters." />
  </div>
  {#if pickedNode}
    <p class="picked">
      <span class="code" style="--c: {colourOf(pickedNode.workspace.slug, pickedNode.node.type)}">{typeCode(pickedNode.node.type)}</span>
      <b>{pickedNode.node.title}</b>
      <span class="mono muted">{pickedNode.node.id}</span>
      <span class="muted">{pickedNode.match ? 'matches the search' : 'linked to a match'} · {pickedNode.workspace.name}</span>
      <a href="{resolve('/a/[org]/d/[ws]/graph', { org: data.org.slug, ws: pickedNode.workspace.slug })}?focus={encodeURIComponent(pickedNode.node.id)}"
        >Open the case file <ArrowRight size={13} aria-hidden="true" /></a
      >
    </p>
  {/if}
{/snippet}

{#if data.workspaces.length === 0}
  <section class="card empty">
    <p>This account has no dockets yet, so there is nothing to ask.</p>
  </section>
{:else}
  <div class="ask-layout" class:in-docket={data.docket !== null}>
    <section class="chat" aria-label="Ask the record">
      <header class="chat-head">
        <div class="titles">
          <h1>Ask the <em>record</em></h1>
          <span class="label">{caption}</span>
        </div>
        <div class="tools">
          {#if data.chat}
            {#if confirming}
              <form method="POST" action="?/delete" use:enhance class="confirm">
                <Csrf token={data.csrf} />
                <input type="hidden" name="chat" value={data.chat.id} />
                <span class="small">Delete this chat for good?</span>
                <button class="button small danger" type="submit">Delete</button>
                <button class="button small" type="button" onclick={() => (confirming = false)}>Keep it</button>
              </form>
            {:else}
              <button class="icon-btn" type="button" onclick={() => (confirming = true)} aria-label="Delete chat" title="Delete chat"><Trash2 size={15} aria-hidden="true" /></button>
            {/if}
          {/if}
          <details class="chats-menu">
            <summary class="icon-btn" aria-label="Saved chats" title="Saved chats"><History size={15} aria-hidden="true" /></summary>
            <div class="card menu">{@render chatList()}</div>
          </details>
          <nav class="seg" aria-label="Ask or search">
            <!-- eslint-disable svelte/no-navigation-without-resolve -- this page's resolved path, keeping the scope -->
            <a href="{base}{query()}" aria-current={data.mode === 'chat' ? 'page' : undefined}>Memo · AI</a>
            <a href="{base}{query({ mode: 'search' })}" aria-current={data.mode === 'search' ? 'page' : undefined}
              >Search · no AI</a
            >
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          </nav>
        </div>
      </header>

      <div class="chat-scroll" bind:this={scroller}>
        <div class="chat-col" aria-live="polite">
          {#if data.mode === 'chat'}
            {#if !data.chat && !pending}
              <div class="msg bot">
                {@render botHead('Docket')}
                <div class="bubble soft">
                  Ask anything about {about.length === 1 ? 'this docket' : 'these dockets'}. I look things up in the record, in as many steps as the question needs, and answer with a short
                  <b>memorandum</b> that footnotes every claim to it. <b>Search</b> skips
                  the model and returns notes, memory matches, records, exhibits and docket entries directly. Asking uses {data.org.name}'s AI budget; search
                  does not.
                  <div class="chips">
                    {#each PROMPTS as prompt (prompt)}
                      <button type="button" onclick={() => send(prompt)}>{prompt}</button>
                    {/each}
                  </div>
                </div>
              </div>
            {/if}
            {#if data.chat || pending}<div class="day-rule"><span>{dayRule(data.chat?.messages[0]?.at)}</span></div>{/if}
            <ol class="turns" data-testid="transcript">
              {#each data.chat?.messages ?? [] as message (message.seq)}
                {#if isAnyAnswer(message.body)}
                  {@const answer = message.body}
                  {@const question = data.chat?.messages.find((other) => other.seq === message.seq - 1)}
                  <li class="msg bot" data-testid="answer">
                    {@render botHead('Memo · AI', message.at)}
                    {#if isAgentAnswer(answer)}
                      <AgentMemo
                        agent={answer.agent}
                        question={question ? asQuestion(question.body).text : ''}
                        to={myName}
                        org={data.org.slug}
                        {colourOf}
                        {docketName}
                        bind:lit
                      />
                    {:else}
                      {#each answer.answers as part (part.workspace.slug)}
                        <Memo
                          {part}
                          question={question ? asQuestion(question.body).text : ''}
                          to={myName}
                          docketNo={docketNos.get(part.workspace.slug) ?? ''}
                          org={data.org.slug}
                          colourOf={(type) => colourOf(part.workspace.slug, type)}
                          fresh={fresh === message.seq}
                          bind:lit
                        />
                      {/each}
                    {/if}
                    <p class="worked mono">
                      {isAgentAnswer(answer)
                        ? `Looked up ${answer.agent.steps.length} ${answer.agent.steps.length === 1 ? 'time' : 'times'} across documents, graph and memory`
                        : 'Searched documents, graph and memory'} · {sourcesOf(answer)}
                      {sourcesOf(answer) === 1 ? 'source' : 'sources'}{answer.tookMs !== undefined ? ` · ${seconds(answer.tookMs)}` : ''}
                    </p>
                  </li>
                {:else}
                  {@const question = asQuestion(message.body)}
                  <li class="msg me" data-testid="question">
                    <div class="who"><time class="mono muted" datetime={message.at}>{clock(message.at)}</time><b>You</b></div>
                    <p class="bubble">{question.text}</p>
                    <span class="asked muted">asked of {question.workspaces.map((workspace) => workspace.name).join(', ')}</span>
                  </li>
                {/if}
              {/each}
              {#if pending}
                <li class="msg me">
                  <div class="who"><span class="mono muted">now</span><b>You</b></div>
                  <p class="bubble">{pending.text}</p>
                </li>
                <li class="msg bot" data-testid="asking" role="status">
                  {@render botHead('Memo · AI')}
                  <div class="drafting">
                    <span class="seal-spin" aria-hidden="true"></span>
                    <span class="lines" aria-hidden="true"><i></i><i></i><i></i></span>
                    {pending.writing ? 'Drafting the memo from what I found…' : pending.steps.length ? 'Looking things up in the record…' : 'Reviewing the record…'}
                  </div>
                  {#if pending.steps.length}
                    <details class="card live" open>
                      <summary class="label">What I looked up · {pending.steps.length} {pending.steps.length === 1 ? 'step' : 'steps'}</summary>
                      <Steps steps={pending.steps} {docketName} many={data.selected.length > 1} />
                    </details>
                  {/if}
                </li>
              {/if}
            </ol>
          {:else}
            {#if unscoped}
              <div class="msg bot">
                {@render botHead('Search · no AI')}
                <div class="bubble soft">Choose at least one docket to search.</div>
              </div>
            {:else if !data.search.result}
              <div class="msg bot">
                {@render botHead('Search · no AI')}
                <div class="bubble soft">
                  Search skips the model. It returns <b>notes</b>, <b>memory</b> matches, <b>records</b>, <b>exhibits</b> and <b>docket entries</b> that match
                  your words, and never uses the AI budget. Or list a type of record:
                  {#if data.search.facets?.types.length}
                    <div class="chips">
                      {#each data.search.facets.types.slice(0, 6) as type (type.name)}
                        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's resolved path, keeping the scope -->
                        <a href="{base}{query({ mode: 'search', type: type.name })}">{type.name} · {type.count}</a>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {:else}
              {@const result = data.search.result}
              <div class="day-rule"><span>Today</span></div>
              <div class="msg me">
                <div class="who"><b>You</b></div>
                <p class="bubble">
                  {data.search.query ||
                    `Records filed as ${data.search.filters.types.join(' or ') || 'any type'}${data.search.filters.tags.length ? `, tagged ${data.search.filters.tags.join(' and ')}` : ''}`}
                </p>
              </div>
              <div class="msg bot">
                {@render botHead('Search · no AI')}
                {#each result.notes as note (`${note.workspace.slug}:${note.message}`)}
                  <p class="notice"><span class="ws">{note.workspace.name}</span> {note.message}</p>
                {/each}
                <Results
                  query={data.search.query}
                  hits={result.hits}
                  groups={result.groups}
                  org={data.org.slug}
                  {docketNos}
                  many={data.selected.length > 1}
                  {colourOf}
                  {filters}
                  recordsBody={data.search.view === 'graph' ? map : undefined}
                />
                <p class="worked mono" role="status" data-testid="search-count">
                  Direct search across notes, memory, records, exhibits and the docket, no AI · {tally.total}
                  {tally.total === 1 ? 'result' : 'results'}{data.selected.length > 1 ? ` from ${tally.dockets} of ${data.selected.length} dockets` : ''} · {seconds(
                    result.tookMs,
                  )}
                </p>
              </div>
            {/if}
          {/if}
        </div>
      </div>

      {#if data.mode === 'chat'}
        <form class="chat-composer" method="POST" action="?/ask" bind:this={composer} onsubmit={stream}>
          <Csrf token={data.csrf} />
          {#if data.chat}<input type="hidden" name="chat" value={data.chat.id} />{/if}
          {#if problem ?? form?.problem}<p class="alert" role="alert">{problem ?? form?.problem}</p>{/if}
          <div class="row">
            <label class="grow">
              <span class="visually-hidden">Question</span>
              <textarea
                name="question"
                rows="1"
                maxlength={MAX_QUESTION}
                required
                placeholder="Ask a question · ⌘K to jump"
                value={form?.question ?? ''}
                bind:this={box}
                oninput={grow}
                onkeydown={onKey}
              ></textarea>
            </label>
            <button class="button accent send" type="submit" disabled={pending !== null} aria-label="Ask"><ArrowRight size={17} aria-hidden="true" /></button>
          </div>
          {@render scope()}
        </form>
      {:else}
        <form
          class="chat-composer"
          id="search-form"
          method="GET"
          aria-label="Search the dockets"
          data-sveltekit-keepfocus
          data-sveltekit-noscroll
          onsubmit={(event) => {
            if (chosen.length === 0) event.preventDefault()
          }}
        >
          <input type="hidden" name="mode" value="search" />
          <div class="row">
            <label class="grow">
              <span class="visually-hidden">Search text</span>
              <input type="search" name="q" value={data.search.query} placeholder="Search notes, memory, records, exhibits and docket entries…" />
            </label>
            <button class="button accent send" type="submit" disabled={chosen.length === 0} aria-label="Search"><ArrowRight size={17} aria-hidden="true" /></button>
          </div>
          {@render scope()}
        </form>
      {/if}
    </section>

    <div class="aside">
      <aside class="card chats" aria-label="Saved chats">
        <span class="label">Saved chats</span>
        {@render chatList()}
      </aside>
      {#if data.mode === 'chat' && cited.length}
        <aside class="card cited" aria-label="Cited on the record">
          <span class="label">Cited on the record</span>
          <ul>
            {#each cited as source (`${source.workspace}/${source.id}`)}
              <li>
                <a
                  class="case"
                  class:lit={lit === `${source.workspace}/${source.id}`}
                  class:dim={lit !== null && lit !== `${source.workspace}/${source.id}`}
                  style="--c: {colourOf(source.workspace, source.type)}"
                  href="{resolve('/a/[org]/d/[ws]/graph', { org: data.org.slug, ws: source.workspace })}?focus={encodeURIComponent(source.id)}"
                  onmouseenter={() => (lit = `${source.workspace}/${source.id}`)}
                  onmouseleave={() => (lit = null)}
                >
                  <span class="case-head"><span class="mono">{source.id}</span><span class="mono">{typeCode(source.type)}</span></span>
                  <span class="case-title">{source.title}</span>
                  {#if source.stale}<span class="stamp warn">Stale</span>{/if}
                </a>
              </li>
            {/each}
          </ul>
          <p class="muted small">The records the latest memo relies on. Point at a footnote to find one.</p>
        </aside>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* The chat fills the window under the breadcrumbs: the page itself never scrolls, only the conversation. */
  :global(#content:has(> .ask-layout)) {
    max-width: 1320px;
    padding-top: 18px;
    padding-bottom: 18px;
  }
  .ask-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 16px;
    height: calc(100dvh - 50px - 36px);
  }
  /* On a docket's Chat tab the docket's header sits above: the chat fills what is left of the window. */
  :global(#content:has(.ask-layout.in-docket)) {
    padding-bottom: 18px;
  }
  .ask-layout.in-docket {
    height: max(480px, calc(100dvh - 220px));
  }
  .empty {
    padding: 1.25rem;
  }
  .small {
    font-size: 12.5px;
  }

  .chat {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--paper);
    border-radius: 14px;
    box-shadow: var(--shadow-1);
    overflow: hidden;
    animation: rise 0.45s var(--ease-out) both;
  }
  .chat-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 12px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--rule);
  }
  .titles {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .titles h1 {
    margin: 0;
    font: 400 26px/1 var(--font-serif);
    letter-spacing: -0.01em;
  }
  /* Under a docket's own heading, the chat's keeps its size. */
  .ask-layout.in-docket .titles h1 {
    font-size: 26px;
  }
  .titles .label {
    overflow-wrap: anywhere;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--mute);
    cursor: pointer;
    list-style: none;
  }
  .icon-btn:hover {
    background: var(--sunk);
    color: var(--ink);
  }
  .icon-btn::-webkit-details-marker {
    display: none;
  }
  .chats-menu {
    position: relative;
    display: none;
  }
  .chats-menu .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 30;
    width: min(300px, calc(100vw - 32px));
    max-height: 60vh;
    overflow-y: auto;
    padding: 12px;
    display: grid;
    gap: 8px;
    box-shadow: var(--shadow-2);
  }
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: var(--sunk);
    border-radius: 9px;
  }
  .seg a {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 11px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--mute);
    text-decoration: none;
    white-space: nowrap;
    transition:
      background 0.2s,
      color 0.2s;
  }
  .seg a:hover {
    color: var(--ink);
  }
  .seg a[aria-current='page'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.08),
      0 0 0 1px var(--rule);
  }

  .chat-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }
  .chat-scroll::-webkit-scrollbar {
    display: none;
  }
  .chat-col {
    display: grid;
    gap: 18px;
    max-width: 820px;
    margin: 0 auto;
    padding: 22px 22px 28px;
  }
  .turns {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 18px;
  }
  .msg {
    display: grid;
    gap: 6px;
    min-width: 0;
    animation: rise 0.4s var(--ease-out) both;
  }
  .msg.me {
    justify-items: end;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .bubble {
    max-width: 82%;
    margin: 0;
    padding: 10px 14px;
    border-radius: 14px 14px 4px 14px;
    background: var(--ink);
    color: var(--bg);
    font-size: 15px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .bubble.soft {
    max-width: 100%;
    border-radius: 4px 14px 14px 14px;
    background: var(--bg);
    color: var(--ink-2);
    box-shadow: inset 0 0 0 1px var(--rule);
    line-height: 1.6;
    white-space: normal;
  }
  .asked {
    font-size: 12px;
  }
  .pill {
    padding: 4px 6px;
    border-radius: 5px;
    background: var(--sunk);
    color: var(--mute);
    font: 500 10.5px/1 var(--font-mono);
  }
  .worked {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 11.5px;
    color: var(--mute);
  }
  .worked::after {
    content: '';
    flex: 1;
    min-width: 12px;
    height: 1px;
    background: var(--rule);
  }
  .day-rule {
    display: flex;
    align-items: center;
    gap: 12px;
    font: 500 10.5px var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--mute);
  }
  .day-rule::before,
  .day-rule::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--rule);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .chips > * {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 11px;
    border: 1px solid var(--rule-2);
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-size: 12.5px;
    text-decoration: none;
    cursor: pointer;
    transition:
      border-color 0.15s,
      transform 0.2s var(--ease-out);
  }
  .chips > *:hover {
    border-color: var(--ink-2);
    transform: translateY(-1px);
  }
  .notice {
    margin: 0;
    font-size: 13px;
    color: var(--mute);
  }
  .ws {
    color: var(--signal);
    font-weight: 500;
  }
  .drafting {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 4px;
    font-size: 13.5px;
    color: var(--mute);
  }
  .live {
    margin-top: 8px;
    padding: 10px 16px;
  }
  .live summary {
    margin-bottom: 6px;
    cursor: pointer;
  }
  .seal-spin {
    position: relative;
    width: 28px;
    height: 28px;
    flex: none;
  }
  .seal-spin::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1.5px dashed var(--signal);
    animation: spin 3s linear infinite;
  }
  .seal-spin::after {
    content: '';
    position: absolute;
    inset: 9px;
    border-radius: 50%;
    background: var(--signal);
    animation: breathe 1.4s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      transform: scale(0.7);
      opacity: 0.6;
    }
  }
  .drafting .lines {
    display: grid;
    gap: 5px;
    width: 120px;
  }
  .drafting .lines i {
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--rule) 0%, var(--rule-2) 50%, var(--rule) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  .drafting .lines i:nth-child(2) {
    width: 80%;
  }
  .drafting .lines i:nth-child(3) {
    width: 55%;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  .filters {
    display: grid;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--rule);
    font-size: 13px;
  }
  .filters summary {
    cursor: pointer;
    font-weight: 600;
  }
  .filters fieldset {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .filters legend {
    float: left;
    margin-right: 4px;
    font: 500 10.5px var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--mute);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: 999px;
    background: var(--paper);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
  }
  .chip:has(input:checked) {
    border-color: var(--ink);
  }
  .chip input {
    margin: 0;
    accent-color: var(--ink);
  }
  .map {
    min-width: 0;
  }
  .picked {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 4px 0 0;
    font-size: 13px;
  }
  .picked a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }

  .chat-composer {
    display: grid;
    gap: 6px;
    margin: 0 14px 14px;
    padding: 8px 8px 8px 12px;
    border-radius: 14px;
    background: var(--paper);
    box-shadow:
      0 0 0 1px var(--rule-2),
      0 10px 30px -18px rgb(0 0 0 / 0.4);
  }
  .chat-composer:focus-within {
    box-shadow:
      0 0 0 1.5px var(--ink),
      0 10px 30px -18px rgb(0 0 0 / 0.4);
  }
  .chat-composer .row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .chat-composer .grow {
    flex: 1;
    min-width: 0;
  }
  .chat-composer textarea,
  .chat-composer input[type='search'] {
    display: block;
    width: 100%;
    min-height: 40px;
    max-height: 160px;
    padding: 8px 2px;
    border: 0;
    outline: none;
    background: none;
    box-shadow: none;
    resize: none;
    font-size: 15.5px;
    color: var(--ink);
  }
  .chat-composer .send {
    flex: none;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 50%;
  }
  .chat-composer .alert {
    margin: 4px 0;
  }
  /* The scope chip: the dockets asked, opening upward onto the list that chooses them. */
  .scope {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
    font-size: 12.5px;
    color: var(--mute);
  }
  .scope-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--rule-2);
    border-radius: 999px;
    color: var(--mute);
    cursor: pointer;
    list-style: none;
    white-space: nowrap;
    transition: border-color 0.15s;
  }
  .scope-chip::-webkit-details-marker {
    display: none;
  }
  .scope-chip b {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ink);
    font-weight: 600;
  }
  .scope-chip:hover,
  .scope[open] .scope-chip {
    border-color: var(--ink-2);
  }
  .scope-chip :global(svg) {
    flex: none;
    transition: transform 0.2s var(--ease-out);
  }
  .scope[open] .scope-chip :global(svg) {
    transform: rotate(180deg);
  }
  .scope-chip:focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
  }
  .scope-chip.fixed {
    cursor: default;
    border-color: var(--ink);
  }
  .widen {
    font-size: 12px;
    color: var(--mute);
  }
  .widen:hover {
    color: var(--ink);
  }
  .scope-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    display: grid;
    gap: 1px;
    width: min(320px, calc(100vw - 32px));
    max-height: min(50dvh, 360px);
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    border: 0;
    box-shadow: var(--shadow-2);
    animation: rise 0.2s var(--ease-out) both;
  }
  .scope-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 4px 0 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 13.5px;
    text-align: left;
  }
  .scope-row:hover {
    background: var(--sunk);
  }
  .scope-row label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 36px;
    cursor: pointer;
  }
  .scope-row input {
    margin: 0;
    accent-color: var(--ink);
  }
  .scope-row .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .scope-row .mono {
    font-size: 11px;
  }
  .every {
    cursor: pointer;
    font-weight: 600;
    border-bottom: 1px solid var(--rule);
    border-radius: 6px 6px 0 0;
  }
  .every .tick {
    display: inline-grid;
    place-items: center;
    width: 13px;
  }
  .only {
    flex: none;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--rule);
    border-radius: 999px;
    background: var(--paper);
    color: var(--mute);
    font-size: 11.5px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .scope-row:hover .only,
  .only:focus-visible {
    opacity: 1;
  }
  .only:hover {
    color: var(--ink);
    border-color: var(--ink-2);
  }
  @media (hover: none) {
    .only {
      opacity: 1;
    }
  }

  .aside {
    display: grid;
    align-content: start;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .aside > .card {
    display: grid;
    gap: 8px;
    padding: 12px;
  }
  .chats .new,
  .menu .new {
    justify-self: start;
  }
  .chats ul,
  .menu ul,
  .cited ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .chats li a,
  .menu li a {
    display: grid;
    gap: 2px;
    padding: 7px 8px;
    border-left: 2px solid transparent;
    border-radius: 6px;
    color: inherit;
    font-size: 13.5px;
    text-decoration: none;
  }
  .chats li a:hover,
  .menu li a:hover {
    background: var(--sunk);
  }
  .chats li a[aria-current='page'],
  .menu li a[aria-current='page'] {
    background: var(--sunk);
    border-left-color: var(--signal);
  }
  .chats .title,
  .menu .title {
    overflow-wrap: anywhere;
  }
  .chats time,
  .menu time {
    font-size: 11px;
  }
  .cited ul {
    gap: 8px;
  }
  .case {
    display: grid;
    gap: 4px;
    padding: 0 0 8px;
    border-radius: 8px;
    background: var(--paper);
    box-shadow: 0 0 0 1px var(--rule);
    color: inherit;
    text-decoration: none;
    overflow: hidden;
    transition:
      box-shadow 0.2s,
      opacity 0.2s,
      transform 0.2s var(--ease-out);
  }
  .case-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px;
    background: color-mix(in oklab, var(--c) 14%, var(--paper));
    border-bottom: 2px solid var(--c);
    font-size: 10.5px;
    color: var(--ink-2);
  }
  .case-title {
    padding: 0 8px;
    font: 400 17px/1.15 var(--font-serif);
    overflow-wrap: anywhere;
  }
  .case .stamp {
    margin: 0 8px;
    justify-self: start;
  }
  .case:hover,
  .case.lit {
    box-shadow: 0 0 0 1.5px var(--signal);
    transform: translateX(2px);
  }
  .case.dim {
    opacity: 0.45;
  }

  @media (max-width: 1100px) {
    .ask-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .aside {
      display: none;
    }
    .chats-menu {
      display: block;
    }
  }
  @media (max-width: 900px) {
    :global(#content:has(> .ask-layout)) {
      padding: 0;
    }
    .ask-layout {
      height: calc(100dvh - 50px - var(--tabbar-h, 0px));
      gap: 0;
    }
    :global(#content:has(.ask-layout.in-docket)) {
      padding-bottom: calc(10px + var(--tabbar-h, 0px));
    }
    .ask-layout.in-docket {
      height: max(440px, calc(100dvh - 222px - var(--tabbar-h, 0px)));
    }
    .ask-layout:not(.in-docket) .chat {
      border-radius: 0;
      box-shadow: none;
    }
    .chat-head {
      padding: 10px 14px;
    }
    .titles h1 {
      font-size: 22px;
    }
    .chat-col {
      padding: 16px 14px 20px;
    }
    .chat-composer {
      margin: 0 10px 10px;
    }
    .bubble {
      max-width: 92%;
    }
  }
</style>
