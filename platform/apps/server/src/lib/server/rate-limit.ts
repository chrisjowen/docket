// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A fixed-window rate limit per key, in-process (§12: 120 MCP calls a minute
 * per token). Each API replica counts on its own, so with the beta's two a
 * token can make up to twice that when its calls are spread across both; the
 * limit is a guard against a runaway agent, not a quota.
 */
export interface RateLimiter {
  /** Counts one call; false when the key is over its limit, with how long until the window resets. */
  take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number }
  /** Whether the key is over its limit, counting nothing. */
  check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number }
}

export function rateLimiter(options: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = options.now ?? (() => Date.now())
  const windows = new Map<string, { start: number; count: number }>()
  const verdict = (window: { start: number; count: number } | undefined, at: number): ReturnType<RateLimiter['take']> => {
    if (!window || at - window.start >= options.windowMs || window.count <= options.limit) return { ok: true }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + options.windowMs - at) / 1000)) }
  }
  return {
    take(key) {
      const at = now()
      if (windows.size > 10_000) {
        for (const [known, window] of windows) if (at - window.start >= options.windowMs) windows.delete(known)
      }
      const window = windows.get(key)
      if (!window || at - window.start >= options.windowMs) {
        windows.set(key, { start: at, count: 1 })
        return { ok: true }
      }
      window.count += 1
      return verdict(window, at)
    },
    check(key) {
      const window = windows.get(key)
      // The next call is the one that would count: over the limit once the window is full.
      return verdict(window && { start: window.start, count: window.count + 1 }, now())
    },
  }
}
