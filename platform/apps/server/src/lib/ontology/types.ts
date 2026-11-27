// SPDX-License-Identifier: AGPL-3.0-only
import type { DraftCheck } from '@docket/platform-ontology-service'

/** What the editor's change-check panel shows: the last dry run's answer. */
export type CheckState =
  | { status: 'checking' | 'idle' }
  | { status: 'ok'; check: DraftCheck }
  | { status: 'invalid'; diagnostics: { message: string }[] }
  | { status: 'migration'; problems: string[] }
  | { status: 'error'; message: string }
