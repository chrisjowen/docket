import type { EntityInput } from '@docket/contracts'

import type { MemoryEntity } from '../model/index.js'

/** The canonical entity input for a merged entity: its hash is its revision. */
export const toEntityInput = (entity: MemoryEntity, scope: string): EntityInput => {
  const { hash, ...rest } = entity
  return { ...rest, kind: 'entity', revision: hash, scope }
}
