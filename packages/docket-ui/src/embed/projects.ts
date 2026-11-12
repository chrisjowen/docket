/*
 * What docket's Wheelhouse plugin says about every project for its Docket
 * page (the `projects` provider in wheelhouse/src/server.ts), and how the
 * page's Add Docket reads the viewer's service once Wheelhouse has started it.
 */

import type { DocketCli, ServiceView } from './host.js'

export const PROJECTS_SCHEMA = 'wheelhouse-docket-projects.v1'

/** One of Wheelhouse's projects as the Docket page lists it. */
export interface DocketProject {
  id: string
  name: string
  description: string | null
  /** `docket`: it has one; `none`: its clone has no `.docket.yaml`; `no-clone`: Firstmate recorded no clone to add one to. */
  state: 'docket' | 'none' | 'no-clone'
  /** The docket's directory, or the clone docket would be added to. */
  root: string | null
  configuredRoot: boolean
}

/** The provider's value. */
export interface ProjectsData {
  schema: typeof PROJECTS_SCHEMA
  projects: DocketProject[]
  /** What stops Add Docket working, such as a docket CLI too old to start a docket. */
  problem: string | null
  /** The docket the viewers run; null when no project has a clone to ask it in. */
  docket: DocketCli | null
}

export const isProjectsData = (value: unknown): value is ProjectsData =>
  typeof value === 'object' &&
  value !== null &&
  (value as { schema?: unknown }).schema === PROJECTS_SCHEMA &&
  Array.isArray((value as { projects?: unknown }).projects)

/** Wheelhouse's address of a project's Docket tab: `/projects/<project>/<plugin>/casebook`. */
export const casebookHref = (pluginId: string, projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(pluginId)}/casebook`

/** How Add Docket went, from the viewer's service once Wheelhouse was asked to start it. */
export type Added =
  | { ok: true }
  | { ok: false; reason: string; log: string | null; hint: string | null }

export const added = (view: ServiceView | null): Added => {
  if (view?.state === 'running' || view?.state === 'starting') return { ok: true }
  if (!view) return { ok: false, reason: 'This Wheelhouse has no docket viewer for this project.', log: null, hint: null }
  return {
    ok: false,
    reason:
      view.reason ??
      (view.state === 'occupied' ? 'Something else answers at the viewer’s address.' : 'Wheelhouse could not start docket’s viewer.'),
    log: view.log ?? null,
    hint: view.hint
  }
}
