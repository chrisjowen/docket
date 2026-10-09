/**
 * The programmatic API: open a project's docket, with adapters loaded by
 * module reference or registered directly (docs/adapter-spec.md §4, §12).
 */
export {
  createDocket,
  openDocket,
  DEFAULT_SCOPE,
  type AdapterModuleReference,
  type AdapterRegistration,
  type AdapterSlot,
  type CreateDocketOptions,
  type Docket,
  type OpenDocketOptions
} from './adapters/docket.js'
export { loadAdapterDefinition } from './adapters/loader.js'
export { AskCancelledError, AskRequestError, type AskInput } from './query/ask.js'
export type * from './query/wire.js'
export type { AdapterDistribution, TypeScriptRunner } from './adapters/resolve-module.js'
export type * from '@docket/contracts'
