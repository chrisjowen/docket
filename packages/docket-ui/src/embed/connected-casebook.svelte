<script lang="ts">
  import AdaptersView from '$lib/components/adapters-view.svelte'
  import AskWorkspace from '$lib/components/ask/ask-workspace.svelte'
  import BrowseView from '$lib/components/browse/browse-view.svelte'
  import Casebook from '$lib/components/casebook.svelte'
  import { apiAt } from '$lib/api.js'
  import { MemoryNavigator, setNav } from '$lib/nav.svelte.js'
  import type { UiGraph } from '$lib/types.js'
  import { setWorkspace, Workspace } from '$lib/workspace.svelte.js'

  /**
   * The whole casebook, as docket open draws it, read from and asked of the
   * project's viewer at `url`. Its views have no addresses of their own here:
   * the page's address is Wheelhouse's.
   */
  let { url }: { url: string } = $props()

  // Made once: the parent draws a new one for another address.
  // svelte-ignore state_referenced_locally
  const workspace = setWorkspace(new Workspace(apiAt(url)))
  const nav = setNav(new MemoryNavigator())
  // The casebook draws its view only once the graph has loaded.
  const graph = $derived(workspace.graph as UiGraph)
</script>

<Casebook {workspace} {nav} class="min-h-0 flex-1">
  {#if nav.route === 'ask'}
    <AskWorkspace {graph} />
  {:else if nav.route === 'adapters'}
    <AdaptersView {graph} />
  {:else}
    <BrowseView />
  {/if}
</Casebook>
