<script lang="ts">
  import AskWorkspace from '$lib/components/ask/ask-workspace.svelte'
  import type { UiGraph } from '$lib/types.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'

  const workspace = getWorkspace()
  // The layout renders routes only once the graph has loaded.
  const graph = $derived(workspace.graph as UiGraph)
</script>

<AskWorkspace {graph} />
