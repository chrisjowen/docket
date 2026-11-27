// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which dockets Ask asks: its scope. A docket's own Chat tab asks that docket
 * alone; the casebook's Ask asks the dockets its address names, else an open
 * chat's, else the ones last chosen (remembered in a cookie), else all of them.
 * The scope reads as a chip: all dockets, one, or several.
 */

/** The cookie holding the casebook's last Ask scope, set on its `/o/{org}` path. */
export const ASK_SCOPE_COOKIE = 'ask_scope'

/** What the cookie holds when every docket was chosen, so dockets opened later join in. */
const EVERY = 'all'

/** How the scope reads: every docket, one, several, or none chosen yet. */
export type ScopeKind = 'all' | 'one' | 'several' | 'none'

/** The slugs of `all` named in `slugs`, in the casebook's order; unknown slugs are dropped. */
const known = (all: readonly string[], slugs: readonly string[]) => {
  const wanted = new Set(slugs)
  return all.filter((slug) => wanted.has(slug))
}

/**
 * The dockets asked, from every docket the member reaches (`all`, in order):
 * the docket a Chat tab is fixed to; else those the address names (`?ws=`);
 * else an open chat's; else the remembered ones; else all. A source naming
 * none the member reaches falls through to the next.
 */
export function askScope(input: { all: readonly string[]; docket?: string | null; named?: readonly string[]; chat?: readonly string[]; remembered?: string | null }): string[] {
  const { all } = input
  if (input.docket) return known(all, [input.docket])
  for (const source of [input.named ?? [], input.chat ?? [], recalled(all, input.remembered)]) {
    const chosen = known(all, source)
    if (chosen.length) return chosen
  }
  return [...all]
}

/** The remembered dockets the cookie's `value` names, of `all`. */
export function recalled(all: readonly string[], value: string | null | undefined): string[] {
  if (!value) return []
  if (value === EVERY) return [...all]
  return known(
    all,
    value.split(',').map((slug) => decodeURIComponent(slug)),
  )
}

/** The cookie value remembering `selected` of `all`: every docket, or the chosen ones. Null when none is chosen. */
export function remember(all: readonly string[], selected: readonly string[]): string | null {
  const chosen = known(all, selected)
  if (!chosen.length) return null
  if (chosen.length === all.length) return EVERY
  return chosen.map((slug) => encodeURIComponent(slug)).join(',')
}

/** How `selected` of `all` reads. */
export function scopeKind(all: readonly string[], selected: readonly string[]): ScopeKind {
  const chosen = known(all, selected)
  if (!chosen.length) return 'none'
  if (chosen.length === all.length) return all.length === 1 ? 'one' : 'all'
  return chosen.length === 1 ? 'one' : 'several'
}

/** The chip's words for `selected` of `all`, naming a lone docket by `name`. */
export function scopeLabel(all: readonly string[], selected: readonly string[], name: (slug: string) => string): string {
  const chosen = known(all, selected)
  switch (scopeKind(all, selected)) {
    case 'all':
      return `All ${all.length} dockets`
    case 'one':
      return name(chosen[0] ?? '')
    case 'several':
      return `${chosen.length} dockets`
    default:
      return 'Choose dockets'
  }
}
