// SPDX-License-Identifier: AGPL-3.0-only
/** What the graph browser's capture forms are shaped by (§14.2), shared by the server and the page. */

export interface CaptureAttribute {
  name: string
  type: string
  enum: (string | number)[] | null
  description: string | null
}

/** What the capture forms offer: the published ontology's types, relationships and evidence sources. */
export interface CaptureVocabulary {
  types: { name: string; description: string | null; attributes: CaptureAttribute[] }[]
  relationships: { name: string; description: string | null; from: '*' | string[]; to: '*' | string[] }[]
  sources: { name: string; description: string | null; requires: string[]; requiresAny: string[] }[]
  locationFields: string[]
}

/** A suggested id for a new resource: `<type>.<slug of the title>`, as docket names them. */
export function suggestId(type: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `${type}.${slug}` : ''
}
