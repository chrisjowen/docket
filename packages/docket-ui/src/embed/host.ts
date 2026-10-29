/*
 * What Wheelhouse hands the casebook's custom element (its plugin contract,
 * version 1: github.com/chrisjowen/wheelhouse, docs/plugins.md), what docket's
 * Wheelhouse plugin's provider says about the project, and how the element
 * works out whether it can draw the casebook from the project's viewer.
 */

/** A companion service as Wheelhouse's page sees it (`GET /api/services`). */
export interface ServiceView {
  state: 'running' | 'stopped' | 'starting' | 'failed' | 'occupied' | 'unavailable'
  url: string | null
  /** Why it is unavailable, failed or cannot be started, in plain words. */
  reason: string | null
  /** The end of the launch log, after a failed start. */
  log?: string
  /** Whether Wheelhouse can start it. */
  launchable: boolean
  /** A command to start it by hand. */
  hint: string | null
}

/** What Wheelhouse lets the element do: read and start its own plugin's services. */
export interface PluginHost {
  readonly pluginId: string
  service(service: string, o?: { project?: string | null }): Promise<ServiceView | null>
  launch(service: string, o?: { project?: string | null; open?: string | null }): Promise<ServiceView | null>
}

/** The slot the element is drawn in. */
export interface SlotEntry {
  key: string
  slot: string
  pluginId: string
  contributionId: string
  title: string
  projectId: string | null
}

export const CASEBOOK_SCHEMA = 'wheelhouse-docket-casebook.v1'

/** The provider's value: the project's docket, and the pages its viewer is started to allow. */
export interface CasebookData {
  schema: typeof CASEBOOK_SCHEMA
  /** `none`: the project has no `.docket.yaml`. */
  state: 'docket' | 'none'
  /** The docket's directory. */
  root: string | null
  /** The root was set in Wheelhouse's plugins file rather than being the project's clone. */
  configuredRoot: boolean
  /** The Wheelhouse pages the viewer is started with `--allow-origin` for. */
  origins: string[]
  /** What stops the viewer working with Wheelhouse, such as a docket too old for it. */
  problem: string | null
}

/** The viewer's service id in docket's Wheelhouse manifest. */
export const VIEWER = 'viewer'

export const isCasebookData = (value: unknown): value is CasebookData =>
  typeof value === 'object' && value !== null && (value as { schema?: unknown }).schema === CASEBOOK_SCHEMA

/** Where the element stands: what it can draw. */
export type Connection =
  | { state: 'checking' }
  /** The viewer answers this page: draw the casebook from it. */
  | { state: 'connected'; url: string }
  /** No docket here, or one this Wheelhouse cannot use: nothing to start. */
  | { state: 'blocked'; title: string; detail: string; hint: string | null }
  /** The viewer is not running (or not for this page): say so, with Launch when Wheelhouse can start it. */
  | { state: 'offline'; title: string; detail: string | null; hint: string | null; launchable: boolean; starting: boolean }

/**
 * Whether an open casebook stays open after Wheelhouse is asked about the
 * viewer again (`view` is undefined when it could not be asked). Only the
 * viewer's service saying it is no longer running, or runs somewhere else,
 * closes it; a refreshed provider value or a lost answer does not.
 */
export const keepsCasebook = (connection: Connection, view: ServiceView | null | undefined): boolean =>
  connection.state === 'connected' && (view === undefined || (view?.state === 'running' && view.url === connection.url))

/** Whether this is `GET /api/health`'s answer, which only a docket open new enough for Wheelhouse gives. */
const isHealth = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && (value as { service?: unknown }).service === 'docket-open'

/**
 * Where the element stands, from the provider's value, the viewer's service
 * and whether the viewer answers this page (`origin`). `probe` reads the
 * viewer's health from the page; it throws when the browser keeps the answer
 * from the page, as it does when the viewer does not allow it.
 */
export const connect = async (
  data: CasebookData | null,
  view: ServiceView | null,
  origin: string,
  probe: (url: string) => Promise<unknown>
): Promise<Connection> => {
  if (!data) {
    return { state: 'blocked', title: 'Not available', detail: 'Wheelhouse has not said where this project’s docket is.', hint: null }
  }
  if (data.state === 'none') {
    return {
      state: 'blocked',
      title: 'No docket here',
      detail: 'This project’s clone has no .docket.yaml. Run docket init in it to start one.',
      hint: null
    }
  }
  if (data.problem) return { state: 'blocked', title: 'docket cannot be shown here', detail: data.problem, hint: view?.hint ?? null }
  if (!data.origins.includes(origin)) {
    return {
      state: 'blocked',
      title: 'This Wheelhouse is not one docket’s viewer allows',
      detail:
        `Wheelhouse is open at ${origin}, but docket’s viewer is started to allow ${data.origins.join(' and ') || 'no other page'}. ` +
        `Add "${origin}" to "origins" in the docket plugin’s settings in Wheelhouse’s plugins.json, then restart the viewer.`,
      hint: null
    }
  }
  if (!view) {
    return { state: 'blocked', title: 'Not available', detail: 'This Wheelhouse has no docket viewer for this project.', hint: null }
  }
  if (view.state === 'running' && view.url) {
    let health: unknown
    try {
      health = await probe(view.url)
    } catch {
      return {
        state: 'offline',
        title: 'docket’s viewer does not answer this page',
        detail:
          `A docket viewer runs at ${view.url}, but not for Wheelhouse: it was started by hand, or by a docket without --allow-origin. ` +
          'Stop it, then launch it from here, or start it with the command below.',
        hint: view.hint,
        launchable: false,
        starting: false
      }
    }
    if (!isHealth(health)) {
      return {
        state: 'offline',
        title: 'docket’s viewer is out of date',
        detail: `The docket viewer at ${view.url} is too old to be shown in Wheelhouse. Update docket, stop the viewer and launch it again.`,
        hint: view.hint,
        launchable: false,
        starting: false
      }
    }
    return { state: 'connected', url: view.url }
  }
  return {
    state: 'offline',
    title:
      view.state === 'starting'
        ? 'docket’s viewer is starting'
        : view.state === 'failed'
          ? 'docket’s viewer did not start'
          : view.state === 'occupied'
            ? 'Something else answers at the viewer’s address'
            : view.state === 'unavailable'
              ? 'docket’s viewer cannot run here'
              : 'docket’s viewer is not running',
    detail:
      view.reason ??
      (view.state === 'stopped'
        ? 'The casebook - Browse, Ask, Adapters, the inspector, chat and sync - is drawn from the project’s docket viewer (docket open). Launch it to open the casebook here.'
        : null),
    hint: view.hint,
    launchable: view.launchable,
    starting: view.state === 'starting'
  }
}
