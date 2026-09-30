/**
 * Coalesce a burst of filesystem events per path (spec §35).
 *
 * One logical save arrives as several events: editors write a temporary file,
 * unlink the original and rename over it. Each `schedule` restarts that key's
 * timer, so a burst produces exactly one reconciliation once the key goes quiet.
 */
export interface Debouncer {
  /** (Re)start the timer for `key`, discarding any pending one. */
  schedule(key: string): void
  /** Drop every pending timer without running it. */
  cancel(): void
}

export const createDebouncer = (
  delayMs: number,
  run: (key: string) => void
): Debouncer => {
  const timers = new Map<string, NodeJS.Timeout>()

  return {
    schedule(key) {
      clearTimeout(timers.get(key))
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          run(key)
        }, delayMs)
      )
    },

    cancel() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }
}
