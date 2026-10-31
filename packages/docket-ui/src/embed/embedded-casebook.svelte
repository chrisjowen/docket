<script lang="ts">
  import { onMount } from 'svelte'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Play from '@lucide/svelte/icons/play'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { Button } from '$lib/components/ui/button/index.js'
  import ConnectedCasebook from './connected-casebook.svelte'
  import { connect, describeDocket, isCasebookData, keepsCasebook, VIEWER, type Connection, type PluginHost, type ServiceView } from './host.js'

  /**
   * The casebook inside Wheelhouse. It is drawn from the project's docket
   * viewer (docket open), which Wheelhouse starts as the plugin's `viewer`
   * service, so everything docket open's own page does works here too. Until
   * the viewer answers this page it says why, with Launch when Wheelhouse can
   * start it and the command that starts it by hand.
   */
  interface Props {
    host: PluginHost | null
    data: unknown
    /** Wheelhouse's dark theme is on. */
    dark: boolean
    /** Wheelhouse's own origin, which the viewer must allow. */
    origin: string
  }

  let { host, data, dark, origin }: Props = $props()

  /** How often a viewer that is not answering is looked at again. */
  const RECHECK_MS = 5_000

  let connection = $state<Connection>({ state: 'checking' })
  let launching = $state(false)
  let launchFailure = $state<string | null>(null)
  let log = $state<string | null>(null)
  const docket = $derived(isCasebookData(data) ? describeDocket(data.docket) : null)

  const probe = async (url: string): Promise<unknown> => {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { cache: 'no-store' })
    return response.ok ? response.json() : null
  }

  let checks = 0
  async function check(): Promise<void> {
    const at = ++checks
    let view: ServiceView | null | undefined
    try {
      view = host ? await host.service(VIEWER) : null
    } catch {
      view = undefined
    }
    if (at !== checks || keepsCasebook(connection, view)) return
    const next = await connect(isCasebookData(data) ? data : null, view ?? null, origin, probe)
    if (at !== checks) return
    connection = next
    log = view?.log ?? null
  }

  async function launch(): Promise<void> {
    if (!host) return
    launching = true
    launchFailure = null
    try {
      const view = await host.launch(VIEWER)
      if (view?.state === 'failed' || view?.state === 'unavailable') launchFailure = view.reason ?? 'Wheelhouse could not start it.'
    } catch (cause) {
      launchFailure = cause instanceof Error ? cause.message : String(cause)
    } finally {
      launching = false
    }
    await check()
  }

  onMount(() => {
    void check()
    const timer = setInterval(() => {
      if (connection.state !== 'connected' && !launching) void check()
    }, RECHECK_MS)
    return () => clearInterval(timer)
  })

  // A new provider value can change what the element can do.
  $effect(() => {
    void data
    void check()
  })
</script>

<div class="flex min-h-0 flex-1 flex-col text-foreground {dark ? 'dark' : ''}">
  {#if connection.state === 'connected'}
    {#key connection.url}
      <ConnectedCasebook url={connection.url} />
    {/key}
  {:else if connection.state === 'checking'}
    <div class="text-muted-foreground grid flex-1 place-items-center font-serif italic">Opening the casebook…</div>
  {:else}
    <div class="grid flex-1 place-items-center p-6">
      <div class="bg-card flex w-full max-w-xl flex-col gap-3 rounded-lg border p-5" role="status">
        <div class="flex items-center gap-2 font-serif text-lg">
          {#if connection.state === 'offline' && connection.starting}
            <LoaderCircle class="text-muted-foreground size-4 animate-spin" />
          {:else}
            <CircleAlert class="text-muted-foreground size-4" />
          {/if}
          {connection.title}
        </div>
        {#if connection.detail}<p class="text-muted-foreground text-sm break-words">{connection.detail}</p>{/if}
        {#if launchFailure}<p class="text-destructive text-sm break-words">{launchFailure}</p>{/if}
        {#if log}
          <pre class="bg-muted max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">{log}</pre>
        {/if}
        {#if connection.hint}
          <div class="flex flex-col gap-1">
            <span class="text-muted-foreground text-xs">To start it by hand:</span>
            <code class="bg-muted rounded-md px-2 py-1.5 font-mono text-xs break-all select-all">{connection.hint}</code>
          </div>
        {/if}
        <div class="flex flex-wrap items-center gap-2">
          {#if connection.state === 'offline' && connection.launchable}
            <Button onclick={launch} disabled={launching || connection.starting}>
              {#if launching}<LoaderCircle class="animate-spin" />{:else}<Play />{/if}
              {launching ? 'Starting…' : 'Launch'}
            </Button>
          {/if}
          <Button variant="outline" onclick={() => check()} disabled={launching}><RefreshCw /> Check again</Button>
        </div>
        {#if connection.state === 'offline' && connection.launchable}
          <p class="text-muted-foreground text-xs">Wheelhouse opens docket’s own page in a new tab once the viewer answers; the casebook opens here too.</p>
        {/if}
        {#if docket}<p class="text-muted-foreground text-xs break-words">{docket}</p>{/if}
      </div>
    </div>
  {/if}
</div>
