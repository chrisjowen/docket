// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The motion system's script half; app.css holds the rest (fade-ups,
 * staggered reveals, the inked heading word). Every helper here checks
 * `prefers-reduced-motion` and jumps straight to the end state.
 */

export const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Ease out cubic. */
const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * Counts a figure up from zero when it first shows (`use:countUp={{ value, decimals }}`).
 * The server renders the final figure, so the page reads right without script.
 */
export function countUp(node: HTMLElement, options: { value: number; decimals?: number; duration?: number }) {
  let frame = 0
  const run = ({ value, decimals = 0, duration = 900 }: typeof options) => {
    cancelAnimationFrame(frame)
    const format = (figure: number) => figure.toFixed(decimals)
    if (reducedMotion() || value === 0) {
      node.textContent = format(value)
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      node.textContent = format(value * easeOut(t))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }
  run(options)
  return {
    update: run,
    destroy: () => cancelAnimationFrame(frame),
  }
}
