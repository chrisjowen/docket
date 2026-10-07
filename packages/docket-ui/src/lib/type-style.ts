import { getContext, setContext } from 'svelte'
import type { ICONS } from './icons.js'

/** How a resource type is drawn everywhere: its colour and its icon. */
export interface TypeStyle {
  colour: (type: string) => string
  icon: (type: string) => (typeof ICONS)[keyof typeof ICONS]
}

const KEY = Symbol('type-style')

/** The page sets it once; every type mark below reads it. */
export const setTypeStyle = (style: TypeStyle): void => {
  setContext(KEY, style)
}

export const getTypeStyle = (): TypeStyle => getContext<TypeStyle>(KEY)
