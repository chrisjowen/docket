<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { CAPABILITIES, CAPABILITY_INFO, type Capability } from '@docket/platform-tenancy/roles'
  import { untrack } from 'svelte'

  /**
   * A role, and the capabilities one grant adds to it or takes from it
   * (tenancy v2 §3.1). Posts `role`, and once adjusted, `adjusted` with every
   * ticked `cap`: the server works out what is added and removed.
   */
  let {
    roles,
    role = 'reader',
    caps = null,
    id,
  }: {
    roles: { id: string; name: string; caps: string[] }[]
    role?: string
    /** What the grant gives now, when it differs from its role. */
    caps?: string[] | null
    id: string
  } = $props()

  // The form starts from the grant as it is; after that it is the person's to change.
  const initial = untrack(() => {
    const base = roles.find((each) => each.id === role)?.caps ?? []
    return { role, ticked: caps ? [...caps] : [...base], adjusted: caps !== null && base.join() !== caps.join() }
  })
  let chosen = $state(initial.role)
  let ticked = $state<string[]>(initial.ticked)
  let adjusted = $state(initial.adjusted)
  const roleCaps = $derived(roles.find((each) => each.id === chosen)?.caps ?? [])

  function choose(next: string) {
    chosen = next
    if (!adjusted) ticked = [...(roles.find((each) => each.id === next)?.caps ?? [])]
  }
  const toggle = (cap: Capability, on: boolean) => {
    adjusted = true
    ticked = on ? [...ticked, cap] : ticked.filter((each) => each !== cap)
  }
  const extra = $derived(CAPABILITIES.filter((cap) => ticked.includes(cap) !== roleCaps.includes(cap)))
</script>

<label class="role">
  Role
  <select name="role" value={chosen} onchange={(event) => choose((event.currentTarget as HTMLSelectElement).value)} data-testid="role-select">
    {#each roles as each (each.id)}<option value={each.id}>{each.name}</option>{/each}
  </select>
</label>
<details class="adjust" open={adjusted}>
  <summary>
    Adjust capabilities{#if extra.length}<span class="muted"> · {extra.length} changed from {roles.find((each) => each.id === chosen)?.name}</span>{/if}
  </summary>
  {#if adjusted}<input type="hidden" name="adjusted" value="1" />{/if}
  <fieldset>
    <legend class="visually-hidden">Capabilities for this grant</legend>
    {#each CAPABILITIES as cap (cap)}
      <label class="cap" class:changed={ticked.includes(cap) !== roleCaps.includes(cap)} title={CAPABILITY_INFO[cap].help}>
        <input type="checkbox" name="cap" value={cap} id="{id}-{cap}" checked={ticked.includes(cap)} onchange={(event) => toggle(cap, (event.currentTarget as HTMLInputElement).checked)} />
        <span>{CAPABILITY_INFO[cap].label}</span>
        {#if ticked.includes(cap) && !roleCaps.includes(cap)}<span class="tag add">added</span>{:else if !ticked.includes(cap) && roleCaps.includes(cap)}<span class="tag remove">removed</span>{/if}
      </label>
    {/each}
  </fieldset>
  <p class="muted fine">Only this grant changes. The role stays as it is for everyone else who holds it.</p>
</details>

<style>
  .role {
    display: grid;
    gap: 0.25rem;
  }
  .adjust {
    grid-column: 1 / -1;
  }
  .adjust summary {
    cursor: pointer;
    font-size: 0.875rem;
  }
  fieldset {
    border: 0;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.35rem 1rem;
  }
  .cap {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.875rem;
  }
  .cap.changed span:first-of-type {
    font-weight: 600;
  }
  .tag {
    font-size: 0.7rem;
    padding: 0 0.35rem;
    border-radius: 999px;
  }
  .tag.add {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .tag.remove {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .fine {
    font-size: 0.8rem;
    margin: 0.4rem 0 0;
  }
</style>
