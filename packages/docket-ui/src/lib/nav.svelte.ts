import { getContext, setContext } from 'svelte'

/*
 * Moving between the casebook's three views. Served by docket open, each is a
 * route with its own address; drawn inside another page - Wheelhouse's - the
 * page's address is not the casebook's, so the view is kept in memory.
 */

export type Route = 'browse' | 'ask' | 'adapters'

export const ROUTES: readonly { id: Route; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'ask', label: 'Ask' },
  { id: 'adapters', label: 'Adapters' }
]

export interface Navigator {
  /** The view showing. */
  readonly route: Route
  /** The view's own address, when views have addresses; null draws its link as a button. */
  href(route: Route): string | null
  go(route: Route): Promise<void>
}

/** Views without addresses: the casebook inside another page. */
export class MemoryNavigator implements Navigator {
  route = $state<Route>('browse')

  constructor(route: Route = 'browse') {
    this.route = route
  }

  href(): null {
    return null
  }

  async go(route: Route): Promise<void> {
    this.route = route
  }
}

const KEY = Symbol('nav')

export const setNav = (nav: Navigator): Navigator => setContext(KEY, nav)

export const getNav = (): Navigator => getContext<Navigator>(KEY)
