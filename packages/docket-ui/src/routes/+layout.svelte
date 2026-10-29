<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'
  import { goto, pushState } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import Casebook from '$lib/components/casebook.svelte'
  import { setNav, type Navigator, type Route } from '$lib/nav.svelte.js'
  import { setWorkspace, Workspace } from '$lib/workspace.svelte.js'

  let { children } = $props()

  const workspace = setWorkspace(new Workspace())
  let dark = $state(false)

  // Each view is a route of its own, so it has an address.
  const paths = { browse: '/', ask: '/ask', adapters: '/adapters' } as const
  const nav: Navigator = setNav({
    get route(): Route {
      const id = page.route.id
      return id === '/ask' ? 'ask' : id === '/adapters' ? 'adapters' : 'browse'
    },
    href: (route) => resolve(paths[route]),
    go: (route) => goto(resolve(paths[route]))
  })

  // The selection lives in the URL hash, so it survives a reload and can be shared.
  const fromHash = (): string | null => {
    try {
      const hash = decodeURIComponent(location.hash.slice(1))
      return hash === '' ? null : hash
    } catch {
      return null
    }
  }
  const initial = fromHash()

  onMount(() => {
    dark = document.documentElement.classList.contains('dark')
    const onhash = () => {
      const id = fromHash()
      if (id) workspace.select(id, { focus: true })
    }
    window.addEventListener('hashchange', onhash)
    return () => window.removeEventListener('hashchange', onhash)
  })

  // Keep the hash in step with the exhibit inspected.
  $effect(() => {
    const id = workspace.selected
    if (id === null) return
    const hash = `#${encodeURIComponent(id)}`
    if (location.hash !== hash) pushState(hash, {})
  })

  function toggleTheme(): void {
    dark = !dark
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('docket-theme', dark ? 'dark' : 'light')
    } catch {
      // Private windows may refuse; the toggle still works for this visit.
    }
  }

  const graph = $derived(workspace.graph)
</script>

<svelte:head>
  <title>{graph ? `${graph.project.name} · docket casebook` : 'docket casebook'}</title>
</svelte:head>

<Casebook
  {workspace}
  {nav}
  {initial}
  theme={{
    get dark() {
      return dark
    },
    toggle: toggleTheme
  }}
>
  {@render children()}
</Casebook>
