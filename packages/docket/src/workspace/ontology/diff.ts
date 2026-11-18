import type { Ontology } from '../docket.js'

/** One line of a structural diff: "+ type `slo`", "~ relationship `depends_on`: to += `datasource`". */
export interface Change {
  op: '+' | '-' | '~'
  text: string
}

type Attributes = Record<string, { type: string; enum?: (string | number)[]; description?: string }>
type Constraint = '*' | string[]

const code = (name: string) => `\`${name}\``
const list = (items: readonly (string | number)[]) => items.map((item) => code(String(item))).join(', ')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function setDiff<T>(before: readonly T[], after: readonly T[]) {
  return { added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) }
}

function constraintChange(end: 'from' | 'to', before: Constraint, after: Constraint): string[] {
  if (same(before, after)) return []
  if (before === '*' || after === '*') {
    const show = (c: Constraint) => (c === '*' ? '*' : `[${c.join(', ')}]`)
    return [`${end}: ${show(before)} → ${show(after)}`]
  }
  const { added, removed } = setDiff(before, after)
  return [...(added.length ? [`${end} += ${list(added)}`] : []), ...(removed.length ? [`${end} −= ${list(removed)}`] : [])]
}

function attributeChanges(owner: string, before: Attributes = {}, after: Attributes = {}): Change[] {
  const out: Change[] = []
  for (const name of Object.keys(after)) if (!(name in before)) out.push({ op: '+', text: `attribute ${code(`${owner}.${name}`)}` })
  for (const name of Object.keys(before)) if (!(name in after)) out.push({ op: '-', text: `attribute ${code(`${owner}.${name}`)}` })
  for (const [name, was] of Object.entries(before)) {
    const now = after[name]
    if (!now || same(was, now)) continue
    const parts: string[] = []
    if (was.type !== now.type) parts.push(`type ${was.type} → ${now.type}`)
    if (!same(was.enum, now.enum)) {
      if (!was.enum) parts.push('enum added')
      else if (!now.enum) parts.push('enum removed')
      else {
        const { added, removed } = setDiff(was.enum, now.enum)
        if (added.length) parts.push(`enum += ${list(added)}`)
        if (removed.length) parts.push(`enum −= ${list(removed)}`)
      }
    }
    if (was.description !== now.description) parts.push('description')
    out.push({ op: '~', text: `attribute ${code(`${owner}.${name}`)}: ${parts.join(', ')}` })
  }
  return out
}

function fieldsChanged<T extends object>(before: T, after: T, fields: readonly (keyof T & string)[]): string[] {
  return fields.filter((field) => !same(before[field], after[field]))
}

/** What changed from one ontology to the next, types first, then relationships, then evidence. */
export function diffOntologies(before: Ontology | null, after: Ontology): Change[] {
  const was: Ontology = before ?? { version: 1, resourceTypes: {}, relationships: {} }
  const out: Change[] = []

  for (const name of Object.keys(after.resourceTypes)) if (!(name in was.resourceTypes)) out.push({ op: '+', text: `type ${code(name)}` })
  for (const name of Object.keys(was.resourceTypes)) if (!(name in after.resourceTypes)) out.push({ op: '-', text: `type ${code(name)}` })
  for (const [name, then] of Object.entries(was.resourceTypes)) {
    const now = after.resourceTypes[name]
    if (!now) continue
    const fields = fieldsChanged(then, now, ['description', 'icon', 'extraction', 'confidence'])
    if (fields.length) out.push({ op: '~', text: `type ${code(name)}: ${fields.join(', ')}` })
    out.push(...attributeChanges(name, then.attributes, now.attributes))
  }

  for (const name of Object.keys(after.relationships)) if (!(name in was.relationships)) out.push({ op: '+', text: `relationship ${code(name)}` })
  for (const name of Object.keys(was.relationships)) if (!(name in after.relationships)) out.push({ op: '-', text: `relationship ${code(name)}` })
  for (const [name, then] of Object.entries(was.relationships)) {
    const now = after.relationships[name]
    if (!now) continue
    const parts = [
      ...constraintChange('from', then.from, now.from),
      ...constraintChange('to', then.to, now.to),
      ...fieldsChanged(then, now, ['description', 'confidence'])
    ]
    if (parts.length) out.push({ op: '~', text: `relationship ${code(name)}: ${parts.join(', ')}` })
    out.push(...attributeChanges(name, then.attributes, now.attributes))
  }

  const sourcesBefore = was.evidence?.sources ?? {}
  const sourcesAfter = after.evidence?.sources ?? {}
  for (const name of Object.keys(sourcesAfter)) if (!(name in sourcesBefore)) out.push({ op: '+', text: `evidence source ${code(name)}` })
  for (const name of Object.keys(sourcesBefore)) if (!(name in sourcesAfter)) out.push({ op: '-', text: `evidence source ${code(name)}` })
  for (const [name, then] of Object.entries(sourcesBefore)) {
    const now = sourcesAfter[name]
    if (!now || same(then, now)) continue
    const parts: string[] = []
    if (then.confidence !== now.confidence) parts.push(`confidence ${then.confidence} → ${now.confidence}`)
    for (const field of ['requires', 'requiresAny'] as const) {
      const { added, removed } = setDiff(then[field] ?? [], now[field] ?? [])
      if (added.length) parts.push(`${field} += ${list(added)}`)
      if (removed.length) parts.push(`${field} −= ${list(removed)}`)
    }
    if (then.description !== now.description) parts.push('description')
    out.push({ op: '~', text: `evidence source ${code(name)}: ${parts.join(', ')}` })
  }
  const unevidencedBefore = was.evidence?.unevidenced
  const unevidencedAfter = after.evidence?.unevidenced
  if (!before && unevidencedAfter !== undefined) {
    out.push({ op: '+', text: `evidence: unevidenced ${unevidencedAfter}` })
  } else if (unevidencedBefore !== unevidencedAfter) {
    out.push({ op: '~', text: `evidence: unevidenced ${unevidencedBefore ?? 'default'} → ${unevidencedAfter ?? 'default'}` })
  }
  return out
}
