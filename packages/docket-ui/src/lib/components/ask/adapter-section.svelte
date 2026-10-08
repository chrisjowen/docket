<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import Info from '@lucide/svelte/icons/info'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import type { ShownResult } from '$lib/ask/outcome.js'
  import type { BoardScope } from '$lib/workspace.svelte.js'
  import ResultBlock from './result-block.svelte'

  /** One adapter's part of the answer: how it read the question, how much it covered, and what it returned. */
  let { result, onboard }: { result: ShownResult; onboard: (scope: BoardScope) => void } = $props()

  const range = (from: string, to: string): string => {
    const day = (value: string) => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: 'medium' })
    }
    return `${day(from)} – ${day(to)}`
  }
</script>

<article id="adapter-{result.adapter}" class="bg-background flex scroll-mt-4 flex-col gap-3 rounded-lg border p-4">
  <header class="flex flex-col gap-1.5">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="font-mono text-sm font-semibold">{result.adapter}</h3>
      {#if result.state === 'failed'}
        <Badge variant="destructive" class="text-[10px]">{result.error.code === 'invalid-answer' ? 'invalid answer' : 'no answer'}</Badge>
      {:else}
        {@const coverage = result.answer.coverage}
        <Badge variant="outline" class="text-[10px]" title="Scope {coverage.scope}{coverage.checkpoint ? `, checkpoint ${coverage.checkpoint}` : ''}">
          {coverage.mode === 'exhaustive' ? 'exhaustive' : coverage.mode === 'top-k' ? 'top matches' : 'coverage unknown'}{coverage.truncated
            ? ' · truncated'
            : ''}
        </Badge>
        {#if coverage.checkpoint}<span class="text-muted-foreground font-mono text-[10px]">at {coverage.checkpoint}</span>{/if}
      {/if}
      {#if result.durationMs !== undefined}
        <span class="text-muted-foreground ml-auto text-xs tabular-nums">{(result.durationMs / 1000).toFixed(result.durationMs < 1000 ? 2 : 1)}s</span>
      {/if}
    </div>

    {#if result.state === 'answered'}
      {@const interpretation = result.answer.interpretation}
      {#if interpretation.description}<p class="text-sm">{interpretation.description}</p>{/if}
      {#if interpretation.timeRange}
        <p class="text-muted-foreground text-xs">Time range: {range(interpretation.timeRange.from, interpretation.timeRange.to)}</p>
      {/if}
      {#if interpretation.assumptions.length > 0}
        <ul class="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-xs">
          {#each interpretation.assumptions as assumption, index (index)}<li>Assumed: {assumption}</li>{/each}
        </ul>
      {/if}
      {#if interpretation.nativeQuery}
        <details>
          <summary class="text-muted-foreground cursor-pointer text-xs">The native query it ran</summary>
          <pre class="bg-muted mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap">{interpretation.nativeQuery}</pre>
        </details>
      {/if}
    {/if}
  </header>

  {#if result.state === 'failed'}
    <div class="border-destructive/40 flex gap-2 rounded-md border p-3 text-sm">
      <CircleAlert class="text-destructive mt-0.5 size-4 shrink-0" />
      <div class="flex min-w-0 flex-col gap-1">
        <span class="break-words">{result.error.message}</span>
        {#if result.error.retryable}<span class="text-muted-foreground text-xs">It may answer if asked again.</span>{/if}
        {#if result.issues && result.issues.length > 0}
          <ul class="text-muted-foreground flex flex-col gap-0.5 font-mono text-[11px]">
            {#each result.issues as issue, index (index)}<li class="break-words">{issue}</li>{/each}
          </ul>
        {/if}
      </div>
    </div>
  {:else}
    {#each result.answer.diagnostics as diagnostic, index (index)}
      <p class="flex items-start gap-1.5 text-xs {diagnostic.severity === 'error' ? 'text-destructive' : diagnostic.severity === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}">
        {#if diagnostic.severity === 'info'}<Info class="mt-px size-3.5 shrink-0" />{:else}<TriangleAlert class="mt-px size-3.5 shrink-0" />{/if}
        <span class="break-words">{diagnostic.message}</span>
      </p>
    {/each}
    {#if result.blocks.length === 0}
      <p class="text-muted-foreground text-sm">Nothing found.</p>
    {/if}
    {#each result.blocks as shown (shown.block.id)}
      <ResultBlock {shown} {result} {onboard} />
    {/each}
  {/if}
</article>
