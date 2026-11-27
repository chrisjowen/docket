<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import '@fontsource/instrument-serif/latin-400.css'
  import '@fontsource/instrument-serif/latin-400-italic.css'
  import '@fontsource-variable/geist/wght.css'
  import '@fontsource-variable/geist-mono/wght.css'
  import '../app.css'

  import AppShell from '$lib/components/shell/app-shell.svelte'

  let { data, children } = $props()
</script>

{#if data.user}
  <AppShell user={data.user} orgs={data.orgs} csrf={data.csrf} theme={data.theme}>
    {@render children()}
  </AppShell>
{:else}
  {@render children()}
{/if}
