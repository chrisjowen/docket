// SPDX-License-Identifier: AGPL-3.0-only
export { ADAPTER_VERSION, clearNeo4jScope, closeAll, openProjections, projectionFingerprint } from './adapters.js'
export type { CloudProjection, EmbedderConfig, MemoryAdapter, OpenOptions, StoreAccess } from './adapters.js'
export { askWorkspace } from './ask.js'
export { searchWorkspace } from './search.js'
export type { SearchOutcome } from './search.js'
export {
  COGNEE_ADAPTER_MODULE,
  CogneeUnavailable,
  cogneeCognifying,
  cogneeDataset,
  cogneeFingerprint,
  floorAnswer,
  loadCogneeAdapter,
  maxDistanceOf,
  openCognee,
} from './cognee.js'
export type { CogneeAccess, CogneeLoader, OpenCogneeOptions } from './cognee.js'
