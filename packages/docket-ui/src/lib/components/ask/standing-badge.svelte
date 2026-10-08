<script lang="ts">
  import BadgeCheck from '@lucide/svelte/icons/badge-check'
  import CircleDashed from '@lucide/svelte/icons/circle-dashed'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { STANDING_DETAIL, STANDING_LABEL, type Standing } from '$lib/ask/evidence.js'

  /** Whether evidence is on record, derived, and resolvable - always visible, never only a colour. */
  let { standing }: { standing: Standing } = $props()

  const tone: Record<Standing, string> = {
    canonical: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
    derived: 'border-sky-600/40 bg-sky-600/10 text-sky-800 dark:text-sky-300',
    'derived-unresolved': 'border-dashed border-amber-600/60 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    unresolved: 'border-dashed border-muted-foreground/50 text-muted-foreground'
  }
</script>

<span
  class="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap {tone[standing]}"
  title={STANDING_DETAIL[standing]}
>
  {#if standing === 'canonical'}
    <BadgeCheck class="size-3" aria-hidden="true" />
  {:else if standing === 'unresolved'}
    <CircleDashed class="size-3" aria-hidden="true" />
  {:else}
    <Sparkles class="size-3" aria-hidden="true" />
  {/if}
  {STANDING_LABEL[standing]}
</span>
