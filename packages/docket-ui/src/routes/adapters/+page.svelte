<script lang="ts">
  import AdaptersView from '$lib/components/adapters-view.svelte'
  import type { UiGraph } from '$lib/types.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'

  const workspace = getWorkspace()
  // The layout renders routes only once the graph has loaded.
  const graph = $derived(workspace.graph as UiGraph)
</script>

<AdaptersView {graph} />
