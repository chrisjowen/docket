// SPDX-License-Identifier: AGPL-3.0-only

/**
 * An address in the product by its route pattern and parameters, whichever
 * app draws it: a page this server renders, or one the web UI
 * (`packages/docket-ui/cloud`) serves, whose routes this app's typed
 * `resolve` does not know. Neither app has a base path.
 */
export function href(route: string, params: Record<string, string> = {}): string {
  return route.replace(/\[(\w+)\]/g, (_, name: string) => encodeURIComponent(params[name] ?? ''))
}
