<script lang="ts">
  import { getTypeStyle } from '$lib/type-style.js'

  interface Props {
    /** The resource type; null for a link target no file defines yet. */
    type: string | null
    size?: 'sm' | 'md' | 'lg'
    class?: string
  }

  let { type, size = 'md', class: className = '' }: Props = $props()

  const style = getTypeStyle()
  const Icon = $derived(type === null ? null : style.icon(type))
  const box = { sm: 'size-4', md: 'size-5', lg: 'size-7' }
  const glyph = { sm: 'size-2.5', md: 'size-3', lg: 'size-4' }
</script>

{#if Icon && type !== null}
  <span
    class="inline-grid shrink-0 place-items-center rounded-full text-white {box[size]} {className}"
    style="background: {style.colour(type)}"
    title={type}
  >
    <Icon class={glyph[size]} strokeWidth={2.25} aria-hidden="true" />
  </span>
{:else}
  <span
    class="inline-block shrink-0 rounded-full border border-dashed {box[size]} {className}"
    style="border-color: var(--graph-other)"
    title="unresolved"
  ></span>
{/if}
