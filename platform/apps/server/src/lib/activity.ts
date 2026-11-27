// SPDX-License-Identifier: AGPL-3.0-only
/** How the activity log's channels and actions read wherever a change is shown. */
export const CHANNEL_LABELS: Record<string, string> = { mcp: 'MCP', ui: 'Web', cli: 'CLI', repo: 'Repo', ontology: 'Ontology', enrichment: 'Enrichment' }

export const ACTION_LABELS: Record<string, string> = {
  remember: 'remembered',
  'add-evidence': 'added evidence to',
  retire: 'retired',
  supersede: 'marked as superseded',
  'propose-ontology': 'proposed an ontology change',
  'publish-ontology': 'published the ontology',
  'repo-sync': 'synced from the repo',
  push: 'pushed from a checkout',
  infer: 'inferred something about',
  'retire-inferred': 'retired what an enrichment run inferred about',
}

/** Where a document came from, by its origin. */
export const ORIGIN_LABELS: Record<string, string> = {
  cloud: 'Written in Docket Cloud',
  repo: 'Synced from a repo',
  cli: 'Pushed from a checkout',
}

/** The kind of docket entry each action files, as the docket's overview lists them. */
export const FILING_KINDS: Record<string, string> = {
  remember: 'Record filed',
  'add-evidence': 'Exhibit filed',
  retire: 'Withdrawn',
  supersede: 'Overruled',
  'propose-ontology': 'Motion',
  'publish-ontology': 'Ruling',
  'repo-sync': 'Amendment',
  push: 'Amendment',
  infer: 'Finding',
  'retire-inferred': 'Withdrawn',
}
