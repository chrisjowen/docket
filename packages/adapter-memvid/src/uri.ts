import type { NativeIdentity } from '@docket/adapter-kit'
import type { InputKind } from '@docket/contracts'

/**
 * Native identity. Every frame docket writes has the URI
 * `mv2://docket/<namespace>/<kind>/<id>/<revision>`, each segment
 * percent-encoded: the URI alone says which canonical input, at which
 * revision, a frame was stored for. memvid keeps the URI on the frame, lists
 * it on the timeline and filters search by its prefix - so the
 * canonical-to-native mapping lives in the engine itself, and survives a
 * crash between a write and any bookkeeping.
 */
const ROOT = 'mv2://docket/'

const KINDS: readonly InputKind[] = ['entity', 'observation', 'document']

/** The prefix every URI in `namespace` starts with - memvid's `--scope`. */
export const namespacePrefix = (namespace: string): string => `${ROOT}${encodeURIComponent(namespace)}/`

export const frameUri = (namespace: string, identity: NativeIdentity): string =>
  `${namespacePrefix(namespace)}${identity.kind}/${encodeURIComponent(identity.id)}/${encodeURIComponent(identity.revision)}`

/** The identity a URI in `namespace` encodes, or undefined for any other URI - a frame docket did not write there. */
export const parseFrameUri = (namespace: string, uri: string): NativeIdentity | undefined => {
  const prefix = namespacePrefix(namespace)
  if (!uri.startsWith(prefix)) return undefined
  const segments = uri.slice(prefix.length).split('/')
  if (segments.length !== 3) return undefined
  const [kind, id, revision] = segments as [string, string, string]
  if (!(KINDS as readonly string[]).includes(kind) || id === '' || revision === '') return undefined
  try {
    return { kind: kind as InputKind, id: decodeURIComponent(id), revision: decodeURIComponent(revision) }
  } catch {
    return undefined
  }
}
