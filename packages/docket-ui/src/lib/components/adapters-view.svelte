<script lang="ts">
  import { onMount } from 'svelte'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import Plug from '@lucide/svelte/icons/plug'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import type { AdapterInstance } from '$lib/ask/wire.js'
  import type { UiGraph } from '$lib/types.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'

  /**
   * Every configured adapter instance: roles, connection health and how far
   * its index lags the files. Read-only - viewing it never starts, stops or
   * pulls anything - and it never shows configuration, which can hold secrets.
   */
  let { graph }: { graph: UiGraph } = $props()

  const workspace = getWorkspace()
  let refreshing = $state(false)

  onMount(() => {
    void workspace.loadAdapters()
  })

  async function refresh(): Promise<void> {
    refreshing = true
    await workspace.loadAdapters(true)
    refreshing = false
  }

  const listing = $derived(workspace.adapters)

  const HEALTH: Record<string, string> = {
    connected: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
    ready: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
    degraded: 'border-amber-600/50 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    unavailable: 'border-destructive/50 bg-destructive/10 text-destructive'
  }

  const freshness = (adapter: AdapterInstance): { label: string; tone: string } => {
    const fresh = adapter.freshness
    if (!fresh || fresh.state === 'unknown') return { label: 'freshness unknown', tone: 'text-muted-foreground' }
    if (fresh.state === 'current') return { label: 'up to date with the files', tone: 'text-emerald-700 dark:text-emerald-400' }
    const behind = fresh.behind === undefined ? 'behind the files' : `${fresh.behind} ${fresh.behind === 1 ? 'change' : 'changes'} behind the files`
    return { label: behind, tone: 'text-amber-700 dark:text-amber-400' }
  }
</script>

<div class="h-full min-h-0 overflow-y-auto">
  <div class="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6">
    <header class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <h1 class="font-serif text-xl font-semibold">Adapters</h1>
        <p class="text-muted-foreground text-sm">
          The memory engines configured in <code class="font-mono">.docket.yaml</code>: what each is enabled for, whether it can be reached,
          and how far its index lags the files. A healthy connection does not mean a fresh index.
        </p>
      </div>
      <Button variant="outline" size="sm" class="ml-auto" onclick={refresh} disabled={refreshing}>
        <RefreshCw class={refreshing ? 'animate-spin' : ''} /> Check again
      </Button>
    </header>

    {#if listing === null}
      <p class="text-muted-foreground font-serif italic">Reading adapter status…</p>
    {:else if listing.state === 'unavailable' || listing.state === 'failed'}
      <div class="flex flex-col gap-3 rounded-lg border border-dashed p-5 text-sm">
        <p class="flex items-center gap-2 font-medium">
          <CircleAlert class="size-4 {listing.state === 'failed' ? 'text-destructive' : 'text-amber-600'}" />
          {listing.state === 'failed' ? 'Could not read adapter status' : 'Adapter status is not available'}
        </p>
        <p class="text-muted-foreground break-words">{listing.message}</p>
        <p class="text-muted-foreground text-xs">
          Search still works through the configured projections. Their index, as the casebook reports it:
          {#if !graph.index.synced}
            not synced - run <code class="font-mono">docket sync</code>.
          {:else if graph.index.behind > 0}
            {graph.index.behind} {graph.index.behind === 1 ? 'file' : 'files'} behind - run <code class="font-mono">docket sync</code>.
          {:else}
            up to date with the files.
          {/if}
        </p>
      </div>
    {:else if listing.response.adapters.length === 0}
      <div class="flex flex-col gap-2 rounded-lg border border-dashed p-5 text-sm">
        <p class="flex items-center gap-2 font-medium"><Plug class="size-4" /> No adapters configured</p>
        <p class="text-muted-foreground">
          Add an instance under <code class="font-mono">adapters:</code> in <code class="font-mono">.docket.yaml</code> - an installed package
          or a project-relative module - and enable it for <code class="font-mono">projection</code>, <code class="font-mono">query</code> or both.
        </p>
      </div>
    {:else}
      {@const response = listing.response}
      <p class="text-muted-foreground text-xs">
        Ask uses {response.query.defaultAdapters.length === 0 ? 'no adapters' : ''}{#each response.query.defaultAdapters as id, index (id)}<code class="font-mono">{id}</code>{index < response.query.defaultAdapters.length - 1 ? ', ' : ''}{/each}
        by default{response.query.synthesis ? ', and summarises with a model' : ', without a summary'}.
      </p>
      <ul class="grid gap-3 md:grid-cols-2">
        {#each response.adapters as adapter (adapter.id)}
          {@const fresh = freshness(adapter)}
          <li class="bg-card flex min-w-0 flex-col gap-2.5 rounded-lg border p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-mono text-sm font-semibold">{adapter.id}</h2>
              {#if adapter.status}
                <span class="rounded-full border px-2 py-px text-[11px] font-medium {HEALTH[adapter.status.state] ?? ''}">{adapter.status.state}</span>
              {:else}
                <span class="text-muted-foreground rounded-full border border-dashed px-2 py-px text-[11px]">status unknown</span>
              {/if}
              <span class="ml-auto flex gap-1">
                {#each adapter.roles as role (role)}<Badge variant="secondary" class="text-[10px]">{role}</Badge>{/each}
              </span>
            </div>
            <p class="text-muted-foreground truncate font-mono text-xs" title={adapter.module}>
              {adapter.module}{adapter.description ? ` · ${adapter.description.name} ${adapter.description.version}` : ''}
            </p>
            {#if adapter.status?.message}<p class="text-sm break-words">{adapter.status.message}</p>{/if}
            {#if adapter.statusError}
              <p class="text-destructive flex items-start gap-1.5 text-xs break-words"><CircleAlert class="mt-px size-3.5 shrink-0" />{adapter.statusError}</p>
            {/if}
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-muted-foreground">Freshness</dt>
              <dd class={fresh.tone}>{fresh.label}</dd>
              {#if adapter.status?.checkpoint}
                <dt class="text-muted-foreground">Checkpoint</dt>
                <dd class="font-mono">
                  {adapter.status.checkpoint}{adapter.freshness?.canonicalCheckpoint && adapter.freshness.canonicalCheckpoint !== adapter.status.checkpoint
                    ? ` (files at ${adapter.freshness.canonicalCheckpoint})`
                    : ''}
                </dd>
              {/if}
              {#if adapter.status?.pending !== undefined}
                <dt class="text-muted-foreground">Pending</dt>
                <dd class="tabular-nums">{adapter.status.pending} {adapter.status.pending === 1 ? 'record' : 'records'}</dd>
              {/if}
              {#if adapter.status?.engineVersion}
                <dt class="text-muted-foreground">Engine</dt>
                <dd class="font-mono">{adapter.status.engineVersion}</dd>
              {/if}
              {#if adapter.description}
                <dt class="text-muted-foreground">Answers with</dt>
                <dd>{adapter.description.resultKinds.join(', ') || '—'}</dd>
                <dt class="text-muted-foreground">Projects</dt>
                <dd>{adapter.description.inputs.join(', ') || '—'} · rebuild {adapter.description.rebuild}</dd>
              {/if}
              {#if adapter.runtime}
                <dt class="text-muted-foreground">Runtime</dt>
                <dd>
                  <code class="font-mono">{adapter.runtime}</code>
                  <span class="text-muted-foreground">- managed separately: <code class="font-mono">docket runtime status {adapter.runtime}</code></span>
                </dd>
              {/if}
            </dl>
          </li>
        {/each}
      </ul>
      {#each response.diagnostics as diagnostic, index (index)}
        <p class="text-xs {diagnostic.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'}">{diagnostic.message}</p>
      {/each}
    {/if}
  </div>
</div>
