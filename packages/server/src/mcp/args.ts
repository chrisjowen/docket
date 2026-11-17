import { InvalidArgumentsError } from '../docket.js'

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The arguments as an object with only `allowed` keys, or an invalid-params error naming the rest. */
export function argumentsOf(name: string, raw: unknown, allowed: readonly string[], shape: string): Record<string, unknown> {
  const args = raw === undefined ? {} : raw
  if (!isObject(args)) throw new InvalidArgumentsError(`${name} takes ${shape}.`)
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new InvalidArgumentsError(`${name} does not take ${unknown.map((key) => `"${key}"`).join(', ')}.`)
  return args
}
