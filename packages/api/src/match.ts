import { OPERATIONS, type Method, type Operation } from './operations.js'

/** An operation's path as a pattern: each `{name}` one path segment. */
function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = []
  const source = path
    .split('/')
    .map((segment) => {
      const name = /^\{(\w+)\}$/.exec(segment)?.[1]
      if (!name) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      names.push(name)
      return '([^/]+)'
    })
    .join('/')
  return { pattern: new RegExp(`^${source}/?$`), names }
}

const COMPILED = OPERATIONS.map((operation: Operation) => ({ operation, ...compile(operation.path) }))

export type Match =
  | { operation: Operation; params: Record<string, string> }
  /** The path is an operation's, but not for this method: the methods it takes. */
  | { allowed: Method[] }
  | null

/**
 * The operation a request is for, and its path parameters (decoded), or the
 * methods its path takes, or null when no operation has that path.
 */
export function matchOperation(method: string, pathname: string): Match {
  const allowed: Method[] = []
  for (const { operation, pattern, names } of COMPILED) {
    const found = pattern.exec(pathname)
    if (!found) continue
    if (operation.method !== method) {
      allowed.push(operation.method)
      continue
    }
    const params: Record<string, string> = {}
    for (const [index, name] of names.entries()) {
      let value: string
      try {
        value = decodeURIComponent(found[index + 1] as string)
      } catch {
        return null
      }
      params[name] = value
    }
    return { operation, params }
  }
  return allowed.length ? { allowed } : null
}

/** An operation's path with its parameters filled in: what a client calls. */
export function pathOf(operation: Pick<Operation, 'path'>, params: Record<string, string>): string {
  return operation.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`${operation.path} needs ${name}`)
    return encodeURIComponent(value)
  })
}
