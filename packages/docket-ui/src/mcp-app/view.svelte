<script lang="ts">
  import App from './app.svelte'
  import type { AppBridge, ToolResult } from './bridge.js'
  import { cardOf } from './card.js'
  import ResourceCard from './resource-card.svelte'

  /**
   * What the app draws for a result: docket_get's resource as its card, and
   * anything else - docket_search's board, or a result it cannot draw - with
   * the search view. Opening a card from either reads it through docket_get;
   * Back returns to what was shown before.
   */
  interface Props {
    bridge: AppBridge
    displayModes: () => string[]
    displayMode: () => string
    result: () => ToolResult | null
    input: () => Record<string, unknown> | null
    /** Whether there is something to go back to. */
    canGoBack: () => boolean
    onresult: (result: ToolResult) => void
    onback: () => void
    ondisplaymode: (mode: string) => void
  }

  let { bridge, displayModes, displayMode, result, input, canGoBack, onresult, onback, ondisplaymode }: Props = $props()

  const card = $derived(cardOf(result()?.structuredContent))
  /** The id docket_get was called with, while its result is on its way. */
  const reading = $derived.by(() => {
    const id = input()?.id
    return !result() && typeof id === 'string' && input()?.query === undefined ? id : null
  })

  /** Read a resource and show its card; a resource that cannot be read stays where it is, with why. */
  async function openCard(id: string): Promise<void> {
    const read = (await bridge.request('tools/call', { name: 'docket_get', arguments: { id } })) as ToolResult
    if (read.isError || !cardOf(read.structuredContent)) {
      throw new Error(read.content?.find((item) => item.type === 'text')?.text ?? `${id} could not be read.`)
    }
    onresult(read)
  }
</script>

{#if card || reading !== null}
  <ResourceCard
    {bridge}
    {card}
    {reading}
    {displayModes}
    {displayMode}
    {ondisplaymode}
    oncard={openCard}
    onback={canGoBack() ? onback : null}
  />
{:else}
  <App {bridge} {displayModes} {displayMode} {result} {input} {onresult} {ondisplaymode} oncard={openCard} />
{/if}
