<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import CircleCheck from '@lucide/svelte/icons/circle-check'
  import CircleDashed from '@lucide/svelte/icons/circle-dashed'
  import FolderX from '@lucide/svelte/icons/folder-x'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Plus from '@lucide/svelte/icons/plus'
  import { Button } from '$lib/components/ui/button/index.js'
  import { describeDocket, VIEWER, type PluginHost } from './host.js'
  import { added, casebookHref, isProjectsData, type Added, type DocketProject } from './projects.js'

  /**
   * The Docket page in Wheelhouse's menu: every project, those with a docket
   * linked to their Docket tab, and Add Docket for the rest. Add Docket starts
   * the project's viewer, as the casebook's Launch does; for a project with no
   * docket the plugin starts it as `docket open --init`, which adds docket to
   * the clone first. Wheelhouse opens docket's own page in a new tab once it
   * answers.
   */
  interface Props {
    host: PluginHost | null
    data: unknown
    /** Wheelhouse's dark theme is on. */
    dark: boolean
  }

  let { host, data, dark }: Props = $props()

  const value = $derived(isProjectsData(data) ? data : null)
  /** Projects given a docket here, until the provider's next value says so too. */
  let given = $state<Record<string, true>>({})
  let adding = $state<Record<string, true>>({})
  let failures = $state<Record<string, Extract<Added, { ok: false }>>>({})

  const stateOf = (project: DocketProject): DocketProject['state'] => (given[project.id] ? 'docket' : project.state)
  const withDocket = $derived(value ? value.projects.filter((p) => stateOf(p) === 'docket') : [])
  const without = $derived(value ? value.projects.filter((p) => stateOf(p) !== 'docket') : [])
  const docket = $derived(value ? describeDocket(value.docket) : null)
  const pluginId = $derived(host?.pluginId ?? 'docket')

  function add(project: DocketProject): void {
    if (!host || adding[project.id]) return
    adding = { ...adding, [project.id]: true }
    const { [project.id]: _, ...rest } = failures
    failures = rest
    // Called before anything awaits: Wheelhouse opens the new tab in this click.
    void host
      .launch(VIEWER, { project: project.id })
      .then(added, (cause: unknown) => ({
        ok: false as const,
        reason: cause instanceof Error ? cause.message : String(cause),
        log: null,
        hint: null
      }))
      .then((result) => {
        if (result.ok) given = { ...given, [project.id]: true }
        else failures = { ...failures, [project.id]: result }
      })
      .finally(() => {
        const { [project.id]: _, ...still } = adding
        adding = still
      })
  }
</script>

<div class="flex min-h-0 flex-1 flex-col text-foreground {dark ? 'dark' : ''}">
  {#if !value}
    <div class="text-muted-foreground grid flex-1 place-items-center p-6 text-sm">
      Wheelhouse has not said which projects there are.
    </div>
  {:else}
    <!-- Wheelhouse titles the page Docket already. -->
    <div class="flex w-full max-w-3xl flex-col gap-6">
      <p class="text-muted-foreground text-sm">
        {withDocket.length} of {value.projects.length}
        {value.projects.length === 1 ? 'project keeps' : 'projects keep'} a docket. Add Docket starts one in a project’s clone, as
        <code class="font-mono text-xs">docket init</code> does, and opens it.
      </p>

      {#if value.problem}
        <div class="border-destructive/40 bg-destructive/5 flex gap-2 rounded-lg border p-3 text-sm" role="alert">
          <CircleAlert class="text-destructive mt-0.5 size-4 shrink-0" />
          <p class="break-words">{value.problem}</p>
        </div>
      {/if}

      {#if value.projects.length === 0}
        <p class="text-muted-foreground text-sm">There are no projects for docket here.</p>
      {/if}

      {#if withDocket.length > 0}
        <section class="flex flex-col gap-2" aria-label="Projects with a docket">
          <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">With a docket</h2>
          <ul class="bg-card divide-y rounded-lg border">
            {#each withDocket as project (project.id)}
              <li class="flex flex-wrap items-center gap-3 p-3" data-project={project.id}>
                <CircleCheck class="text-(--success) size-4 shrink-0" />
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate font-medium">{project.name}</span>
                  {#if project.description}<span class="text-muted-foreground truncate text-sm">{project.description}</span>{/if}
                  {#if project.root}<span class="text-muted-foreground truncate font-mono text-xs" title={project.root}>{project.root}</span>{/if}
                </div>
                {#if given[project.id]}<span class="text-muted-foreground text-xs">Added</span>{/if}
                <Button variant="outline" size="sm" href={casebookHref(pluginId, project.id)}>
                  Open <ArrowRight />
                </Button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if without.length > 0}
        <section class="flex flex-col gap-2" aria-label="Projects without a docket">
          <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Without a docket</h2>
          <ul class="bg-card divide-y rounded-lg border">
            {#each without as project (project.id)}
              {@const failure = failures[project.id]}
              <li class="flex flex-col gap-2 p-3" data-project={project.id}>
                <div class="flex flex-wrap items-center gap-3">
                  {#if project.state === 'no-clone'}
                    <FolderX class="text-muted-foreground size-4 shrink-0" />
                  {:else}
                    <CircleDashed class="text-muted-foreground size-4 shrink-0" />
                  {/if}
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate font-medium">{project.name}</span>
                    {#if project.description}<span class="text-muted-foreground truncate text-sm">{project.description}</span>{/if}
                    {#if project.state === 'no-clone'}
                      <span class="text-muted-foreground text-xs">Firstmate has not recorded a clone to add docket to.</span>
                    {:else if project.root}
                      <span class="text-muted-foreground truncate font-mono text-xs" title={project.root}>{project.root}</span>
                    {/if}
                  </div>
                  {#if project.state === 'none'}
                    <Button size="sm" onclick={() => add(project)} disabled={!host || !!value.problem || !!adding[project.id]}>
                      {#if adding[project.id]}<LoaderCircle class="animate-spin" />{:else}<Plus />{/if}
                      {adding[project.id] ? 'Adding…' : 'Add Docket'}
                    </Button>
                  {/if}
                </div>
                {#if failure}
                  <div class="flex flex-col gap-2 pl-7">
                    <p class="text-destructive text-sm break-words">{failure.reason}</p>
                    {#if failure.log}
                      <pre class="bg-muted max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">{failure.log}</pre>
                    {/if}
                    {#if failure.hint}
                      <span class="text-muted-foreground text-xs">To add it by hand:</span>
                      <code class="bg-muted rounded-md px-2 py-1.5 font-mono text-xs break-all select-all">{failure.hint}</code>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <footer class="text-muted-foreground flex flex-col gap-1 text-xs">
        <p>Add Docket opens docket’s own page in a new tab once its viewer answers; the project’s Docket tab opens from here.</p>
        <p>Projects docket is turned off for in Settings → Plugins are not listed.</p>
        {#if docket}<p class="break-words">{docket}</p>{/if}
      </footer>
    </div>
  {/if}
</div>
