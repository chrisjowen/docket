import { createHash } from 'node:crypto'

/**
 * `sha256:<hex>` over the raw file contents (spec §24).
 * Hashing the raw bytes - not the parsed model - keeps the hash cheap to compute
 * and lets the reconciler skip re-projection before it ever parses the file.
 */
export const hashContent = (raw: string): string =>
  `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`
