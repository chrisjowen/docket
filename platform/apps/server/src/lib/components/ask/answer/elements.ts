// SPDX-License-Identifier: AGPL-3.0-only
/** The props of each OpenUI element in `value`, an array of parsed child elements; anything else is skipped. */
export function elementProps<P>(value: unknown): P[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const node = item as { type?: unknown; props?: unknown }
    return node.type === 'element' && typeof node.props === 'object' && node.props !== null ? [node.props as P] : []
  })
}
