// SPDX-License-Identifier: AGPL-3.0-only
import { getContext, setContext, type Component } from 'svelte'

/** How a resource type is drawn everywhere on the page: its colour and its icon (docket-ui's `type-style.ts`). */
export interface TypeStyle {
  colour: (type: string) => string
  icon: (type: string) => Component<Record<string, unknown>>
}

const KEY = Symbol('type-style')

/** The page sets it once; every type mark below reads it. */
export const setTypeStyle = (style: TypeStyle): void => {
  setContext(KEY, style)
}

export const getTypeStyle = (): TypeStyle => getContext<TypeStyle>(KEY)
