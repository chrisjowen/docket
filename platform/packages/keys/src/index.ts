// SPDX-License-Identifier: AGPL-3.0-only
export type { KeyService } from './key-service.js'
export { KekError, parseKek, platformKeyService, readKekFile } from './platform-kek.js'
export type { Kek } from './platform-kek.js'
export { EnvelopeError, decrypt, decryptText, encrypt } from './envelope.js'
export type { Sealed } from './envelope.js'
export { DEK_TTL_MS, dekCache } from './dek-cache.js'
