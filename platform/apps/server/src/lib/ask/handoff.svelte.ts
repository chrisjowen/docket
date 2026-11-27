// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A question the command menu hands to the Ask page to send: the menu opens
 * the page, then sets it, and the page sends it once and clears it.
 */
export const handoff = $state<{ question: string | null }>({ question: null })
