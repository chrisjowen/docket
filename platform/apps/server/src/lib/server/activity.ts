// SPDX-License-Identifier: AGPL-3.0-only
import type { IngestEvent } from '@docket/platform-canonical-store'

import type { ActivityEntry } from '$lib/graph/browse'

/** The newest changes the docket sheet, the evidence trails and search read from the activity log. */
export const ACTIVITY_SHOWN = 300

/**
 * The activity log's changes as the graph tab reads them, actors named as
 * `display` names them. A change to one document is about its resource; a
 * push or sync of many names none.
 */
export function activityEntries(events: readonly IngestEvent[], display: (actor: string, label: string) => string): ActivityEntry[] {
  return events.map((entry) => ({
    id: entry.id,
    at: entry.createdAt.toISOString(),
    channel: entry.channel,
    action: entry.action,
    actorLabel: display(entry.actor, entry.actorLabel),
    outcome: entry.outcome,
    resourceId: entry.detail?.resourceId ?? (entry.documents.length === 1 ? (entry.documents[0]?.resourceId ?? null) : null),
    documents: entry.documents.map((document) => ({
      path: document.path,
      change: document.change,
      ...(document.revision !== undefined ? { revision: document.revision } : {}),
    })),
    evidenceCount: entry.evidenceCount,
    requestId: entry.requestId,
  }))
}
