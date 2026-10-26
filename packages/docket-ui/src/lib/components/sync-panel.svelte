<script lang="ts">
  import { onMount } from 'svelte'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import CircleCheck from '@lucide/svelte/icons/circle-check'
  import CircleX from '@lucide/svelte/icons/circle-x'
  import FolderSync from '@lucide/svelte/icons/folder-sync'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import X from '@lucide/svelte/icons/x'
  import { Button } from '$lib/components/ui/button/index.js'
  import { ago, outOfDateHint, resultLine, runSummary, targetState } from '$lib/sync.js'
  import type { SyncState } from '$lib/sync.svelte.js'

  /**
   * Runs `docket sync` from the page: every adapter enabled for projection,
   * or one of them, with each adapter's result as its pass finishes.
   */
  let { sync, onclose }: { sync: SyncState; onclose: () => void } = $props()

  // Opening it reads the projections again: files may have changed since.
  onMount(() => {
    if (!sync.running) void sync.refresh()
  })

  /** '' syncs every adapter enabled for projection. */
  let choice = $state('')
  // Re-render relative times while open.
  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000)
    return () => clearInterval(timer)
  })

  const status = $derived(sync.status)
  const run = $derived(status?.run ?? null)
  const hint = $derived(status ? outOfDateHint(status) : null)
  const targets = $derived(status?.adapters ?? [])
</script>

<section
  aria-label="Sync"
  class="bg-popover absolute top-3 right-3 z-20 flex max-h-[80%] w-[26rem] max-w-[calc(100%-1.5rem)] flex-col rounded-lg border shadow-lg"
>
  <div class="flex items-center justify-between border-b px-3 py-2">
    <span class="section-title">Sync projections</span>
    <Button variant="ghost" size="icon-xs" aria-label="Close" onclick={onclose}><X /></Button>
  </div>

  <div class="flex flex-col gap-3 overflow-y-auto px-3 py-3 text-sm">
    <p class="text-muted-foreground text-xs">
      Runs <code class="font-mono">docket sync</code>: projects the files changed since the last sync into each adapter's index. Search and
      Ask answer from those indexes.
    </p>

    {#if status === null && sync.failure === null}
      <p class="text-muted-foreground font-serif italic">Reading the projections…</p>
    {:else if status}
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt class="text-muted-foreground">Last synced</dt>
        <dd title={status.lastSyncedAt}>{status.lastSyncedAt ? ago(status.lastSyncedAt, now) : 'never, as far as this docket recorded'}</dd>
        {#each targets as target (target.id)}
          <dt class="font-mono">{target.id}</dt>
          <dd class={target.state === 'current' ? 'text-emerald-700 dark:text-emerald-400' : target.state === 'unknown' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}>
            {targetState(target)}{target.lastSyncedAt ? ` · synced ${ago(target.lastSyncedAt, now)}` : ''}
          </dd>
        {/each}
      </dl>
      {#if targets.length === 0 && !status.error}
        <p class="text-muted-foreground text-xs">No adapter is enabled for projection in <code class="font-mono">.docket.yaml</code>, so a sync has nothing to do.</p>
      {/if}
      {#if hint}
        <p class="flex items-start gap-1.5 rounded-md border border-amber-600/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200" role="status">
          <CircleAlert class="mt-px size-3.5 shrink-0" />{hint}
        </p>
      {/if}
      {#if status.error}
        <p class="text-destructive flex items-start gap-1.5 text-xs break-words"><CircleAlert class="mt-px size-3.5 shrink-0" />{status.error}</p>
      {/if}
    {/if}

    <div class="flex items-center gap-2">
      <label class="sr-only" for="sync-adapter">Adapters to sync</label>
      <select
        id="sync-adapter"
        bind:value={choice}
        disabled={sync.running}
        class="border-input bg-background h-7 min-w-0 flex-1 rounded-md border px-2 text-xs disabled:opacity-50"
      >
        <option value="">Every adapter</option>
        {#each targets as target (target.id)}
          <option value={target.id}>Only {target.id}</option>
        {/each}
      </select>
      <Button size="sm" onclick={() => sync.start(choice === '' ? null : [choice])} disabled={sync.running}>
        {#if sync.running}<LoaderCircle class="animate-spin" /> Syncing…{:else}<FolderSync /> Sync now{/if}
      </Button>
    </div>

    {#if sync.failure}
      <p class="text-destructive flex items-start gap-1.5 text-xs break-words" role="alert"><CircleAlert class="mt-px size-3.5 shrink-0" />{sync.failure}</p>
    {/if}

    {#if run}
      <div class="flex flex-col gap-2 border-t pt-3" aria-live="polite">
        <p class="text-xs font-medium {run.state === 'failed' ? 'text-destructive' : ''}" title={run.finishedAt ?? run.startedAt}>
          {runSummary(run, now)}
          {#if run.adapters}<span class="text-muted-foreground font-normal"> Only {run.adapters.join(', ')}.</span>{/if}
        </p>
        {#if run.error}<p class="text-destructive text-xs break-words">{run.error}</p>{/if}
        {#if run.results.length > 0}
          <ul class="flex flex-col gap-1.5 text-xs">
            {#each run.results as result (result.id)}
              <li class="flex min-w-0 items-start gap-1.5">
                {#if result.state === 'waiting'}
                  <LoaderCircle class="text-muted-foreground mt-px size-3.5 shrink-0 animate-spin" />
                {:else if result.state === 'synced'}
                  <CircleCheck class="mt-px size-3.5 shrink-0 text-emerald-600" />
                {:else}
                  <CircleX class="text-destructive mt-px size-3.5 shrink-0" />
                {/if}
                <span class="flex min-w-0 flex-col">
                  <span><code class="font-mono font-medium">{result.id}</code> <span class="text-muted-foreground">{resultLine(result)}</span></span>
                  {#if result.error}<span class="text-destructive break-words">{result.error}</span>{/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if run.fileErrors > 0}
          <p class="text-muted-foreground text-xs">
            {run.fileErrors === 1 ? '1 file has' : `${run.fileErrors} files have`} errors; adapters keep what those files last projected until they
            are fixed. See the validation findings.
          </p>
        {/if}
      </div>
    {/if}
  </div>
</section>
