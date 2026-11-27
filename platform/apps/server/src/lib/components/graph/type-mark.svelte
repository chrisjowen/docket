<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { getTypeStyle } from '$lib/graph/type-style'

  interface Props {
    /** The resource type; null for a link target no document defines yet. */
    type: string | null
    size?: 'sm' | 'md' | 'lg'
    dim?: boolean
  }

  let { type, size = 'md', dim = false }: Props = $props()

  const style = getTypeStyle()
  const Icon = $derived(type === null ? null : style.icon(type))
  const box = { sm: 16, md: 20, lg: 28 }
  const glyph = { sm: 10, md: 12, lg: 16 }
</script>

{#if Icon && type !== null}
  <span class="mark" class:dim style="width: {box[size]}px; height: {box[size]}px; background: {style.colour(type)}" title={type}>
    <Icon size={glyph[size]} strokeWidth={2.25} aria-hidden="true" />
  </span>
{:else}
  <span class="mark ghost" class:dim style="width: {box[size]}px; height: {box[size]}px" title="unresolved"></span>
{/if}

<style>
  .mark {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    border-radius: 999px;
    color: #fff;
  }
  .ghost {
    border: 1px dashed var(--graph-other);
  }
  .dim {
    opacity: 0.4;
  }
</style>
