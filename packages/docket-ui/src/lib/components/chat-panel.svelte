<script lang="ts" module>
  import type { UiChatAnswer } from '$lib/types.js'

  /** One question put to the casebook, and what came back. */
  export interface ChatTurn {
    question: string
    reply: UiChatAnswer | null
    error: string | null
  }
</script>

<script lang="ts">
  import { tick } from 'svelte'
  import Archive from '@lucide/svelte/icons/archive'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import Eye from '@lucide/svelte/icons/eye'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import SendHorizontal from '@lucide/svelte/icons/send-horizontal'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import { boardAnswer, citationsAsMentions } from '$lib/model.js'
  import type { UiAnswer, UiGraph } from '$lib/types.js'
  import Notes from './notes.svelte'
  import TypeMark from './type-mark.svelte'

  interface Props {
    graph: UiGraph
    /** The conversation, kept by the page so switching tabs does not lose it. */
    turns: ChatTurn[]
    onselect: (id: string) => void
    /** Put an answer's exhibits, and only those, on the board; `reveal` also goes to the board. */
    onshow: (answer: UiAnswer, options?: { reveal: boolean }) => void
  }

  let { graph, turns = $bindable(), onselect, onshow }: Props = $props()

  let question = $state('')
  let end = $state<HTMLElement | null>(null)
  const pending = $derived(turns.some((turn) => turn.reply === null && turn.error === null))

  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))
  const titleOf = (id: string): string | undefined => byId.get(id)?.title

  /** The exhibits a reply rests on: those its summary cites, else everything search found, best first. */
  const exhibitsOf = (reply: UiChatAnswer) => {
    const documents = new Map(reply.answer.documents.map((document) => [document.id, document]))
    const order = reply.summary?.cited.length
      ? reply.summary.cited
      : [
          ...new Set([
            ...reply.answer.sources.flatMap((source) => source.hits.map((hit) => hit.id)),
            ...reply.answer.documents.map((document) => document.id)
          ])
        ]
    return order.flatMap((id) => {
      const document = documents.get(id)
      return document ? [document] : []
    })
  }

  const when = (iso: string): string => {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const query = question.trim()
    if (!query || pending) return
    question = ''
    const at = turns.length
    turns = [...turns, { question: query, reply: null, error: null }]
    await tick()
    end?.scrollIntoView({ block: 'end' })

    let settled: ChatTurn
    try {
      const response = await fetch(`/api/chat?q=${encodeURIComponent(query)}`)
      const body = (await response.json()) as UiChatAnswer | { error: string }
      if (!response.ok || 'error' in body) throw new Error('error' in body ? body.error : response.statusText)
      settled = { question: query, reply: body, error: null }
      onshow(boardAnswer(body))
    } catch (cause) {
      settled = { question: query, reply: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
    turns = turns.map((turn, index) => (index === at ? settled : turn))
    await tick()
    end?.scrollIntoView({ block: 'end' })
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <ScrollArea class="min-h-0 flex-1">
    <div class="flex flex-col gap-5 p-4">
      {#if turns.length === 0}
        <div class="text-muted-foreground flex flex-col gap-2 text-sm">
          <p class="text-foreground font-serif text-lg">Examine the casebook</p>
          <p>
            Put a question. <code class="font-mono">docket search</code> finds the exhibits, a model summarizes them citing
            each one, and the board shows only the exhibits cited.
          </p>
          <p class="text-xs">
            Answers are kept in <code class="font-mono">.docket/.cache/</code>: asking again returns the same answer until the
            question, one of its exhibits or the relationship paths connecting them change.
          </p>
        </div>
      {/if}

      {#each turns as turn, index (index)}
        <article class="flex flex-col gap-3">
          <div class="flex gap-2.5">
            <span class="text-gilt w-4 shrink-0 font-serif font-semibold">Q.</span>
            <p class="min-w-0 font-serif break-words italic">{turn.question}</p>
          </div>
          <div class="flex gap-2.5">
            <span class="text-gilt w-4 shrink-0 font-serif font-semibold">A.</span>
            <div class="flex min-w-0 flex-1 flex-col gap-3">
              {#if turn.error}
                <div class="border-destructive/40 text-destructive flex gap-2 rounded-md border p-3 text-sm">
                  <CircleAlert class="mt-0.5 size-4 shrink-0" />
                  <span class="break-words">{turn.error}</span>
                </div>
              {:else if !turn.reply}
                <p class="text-muted-foreground flex items-center gap-2 font-serif text-sm italic">
                  <LoaderCircle class="size-4 animate-spin" /> Consulting the casebook…
                </p>
              {:else}
                {@const reply = turn.reply}
                {@const exhibits = exhibitsOf(reply)}
                {#if reply.summary}
                  <Notes content={citationsAsMentions(reply.summary.text, new Set(reply.summary.cited))} {titleOf} {onselect} />
                  <p class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                    Summarized by <code class="font-mono">{reply.summary.model}</code>
                    {#if reply.summary.cached}
                      <Badge variant="outline" class="gap-1 text-[10px]" title="Written {when(reply.summary.createdAt)}">
                        <Archive class="size-3" /> from the cache
                      </Badge>
                    {/if}
                  </p>
                {:else if reply.notice}
                  <div
                    class="flex gap-2 rounded-md border p-3 text-xs {reply.notice.reason === 'failed'
                      ? 'border-destructive/40'
                      : 'border-amber-500/40 bg-amber-500/10'}"
                  >
                    <CircleAlert
                      class="mt-0.5 size-4 shrink-0 {reply.notice.reason === 'failed' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}"
                    />
                    <div class="min-w-0 flex-1"><Notes content={reply.notice.message} {titleOf} {onselect} /></div>
                  </div>
                {/if}

                {#if !reply.answer.index.synced || reply.answer.index.behind > 0}
                  <p class="text-muted-foreground text-xs">
                    The search index is behind the files; run <code class="font-mono">docket sync</code> and ask again to search
                    everything.
                  </p>
                {/if}

                {#if exhibits.length > 0}
                  <section class="flex flex-col gap-1.5">
                    <h3 class="section-title text-sm">
                      {reply.summary?.cited.length ? 'Exhibits cited' : 'Exhibits found'} ({exhibits.length})
                    </h3>
                    <ul class="flex flex-wrap gap-1.5">
                      {#each exhibits as document (document.id)}
                        <li>
                          <button
                            type="button"
                            class="hover:bg-muted flex max-w-64 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs"
                            title={document.id}
                            onclick={() => onselect(document.id)}
                          >
                            <TypeMark type={document.type} size="sm" />
                            <span class="truncate">{document.title}</span>
                          </button>
                        </li>
                      {/each}
                    </ul>
                    <Button variant="ghost" size="xs" class="self-start" onclick={() => onshow(boardAnswer(reply), { reveal: true })}>
                      <Eye /> Show these on the board
                    </Button>
                  </section>
                {/if}
              {/if}
            </div>
          </div>
        </article>
      {/each}
      <div bind:this={end}></div>
    </div>
  </ScrollArea>

  <form class="flex gap-2 border-t p-3" onsubmit={submit}>
    <label for="chat" class="sr-only">Question for the casebook</label>
    <Input id="chat" bind:value={question} placeholder="What does checkout depend on?" autocomplete="off" />
    <Button type="submit" disabled={pending || question.trim() === ''} aria-label="Ask">
      {#if pending}<LoaderCircle class="animate-spin" />{:else}<SendHorizontal />{/if}
    </Button>
  </form>
</div>
