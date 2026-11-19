import { Document, isMap, isScalar, isSeq, parseDocument, visit, type Node, type Pair, type YAMLMap } from 'yaml'

import { builtinOntology } from '../evidence/confidence.js'
import { convertLegacyTrust, hasLegacyTrust, usesTrustSettings, type TrustSection } from '../evidence/legacy.js'
import { type Ontology, ontologySchema } from '../model/index.js'

export interface ConvertedOntology {
  /** The ontology's text in the current form, comments elsewhere kept. */
  yaml: string
  /** False when the text was already in the current form. */
  changed: boolean
}

const keyOf = (pair: Pair): unknown => (isScalar(pair.key) ? pair.key.value : pair.key)

/** Where a pair's text starts (its line) and ends (after its value), to cut it out whole. */
const span = (raw: string, pair: Pair): [number, number] => {
  const key = pair.key as Node
  const value = pair.value as Node | null
  const from = raw.lastIndexOf('\n', (key.range?.[0] ?? 0) - 1) + 1
  return [from, value?.range?.[2] ?? key.range?.[2] ?? from]
}

/** Cuts `[from, to)` out of the text, along with a blank line the cut leaves doubled. */
const cut = (text: string, from: number, to: number): string => {
  let end = to
  if (text.slice(0, from).endsWith('\n\n') && text[end] === '\n') end += 1
  return text.slice(0, from) + text.slice(end)
}

/** A section as YAML, maps and lists inside `flat` keys written on one line. */
const yamlOf = (value: unknown, flat: (key: string) => boolean): string => {
  const document = new Document(value)
  visit(document, {
    Pair: (_, pair) => {
      if (isScalar(pair.key) && flat(String(pair.key.value)) && (isMap(pair.value) || isSeq(pair.value))) pair.value.flow = true
    }
  })
  return document.toString()
}

/** The converted sections as text: sources apart, then the trust settings. */
const render = (section: TrustSection, locatorFields: ReadonlySet<string>): string => {
  const sources = Object.entries(section.sources).map(([name, definition]) =>
    yamlOf({ [name]: definition }, (key) => key === 'identifiedBy' || key === 'requiresAny' || locatorFields.has(key))
      .replace(/^(?=.)/gm, '  ')
      .trimEnd()
  )
  return [
    '# Sources and confidence policies, converted from legacy evidence settings by',
    '# `docket ontology convert`; they score exactly as those did.',
    `sources:${sources.length ? `\n${sources.join('\n\n')}` : ' {}'}`,
    '',
    yamlOf({ trust: section.trust }, (key) => key === 'when')
  ].join('\n')
}

/**
 * Rewrites an ontology's legacy evidence settings as `sources:` and `trust:`,
 * scoring exactly as before (see `convertLegacyTrust`): the `evidence:` block
 * becomes both sections, in its place, and every `confidence:` rule on a type
 * or relationship moves into `trust.policies`. Every other line of the file
 * is left as it was. An ontology already in the current form only loses any
 * legacy settings left beside it, which are not read.
 *
 * Throws when the text is not an ontology.
 */
export const convertOntologyText = (raw: string, defaults: Ontology = builtinOntology()): ConvertedOntology => {
  const document = parseDocument(raw)
  const parsed = ontologySchema.parse(document.toJS())
  const current = usesTrustSettings(parsed)
  if (current && !hasLegacyTrust(parsed)) return { yaml: raw, changed: false }

  const root = document.contents as YAMLMap
  const cuts: [number, number][] = []
  const empties: [number, number][] = []
  for (const section of ['resourceTypes', 'relationships']) {
    const definitions = root.get(section, true)
    if (!isMap(definitions)) continue
    for (const pair of definitions.items) {
      if (!isMap(pair.value)) continue
      const rules = pair.value.items.find((item) => keyOf(item) === 'confidence')
      if (!rules) continue
      if (pair.value.items.length > 1) cuts.push(span(raw, rules))
      // Its only key: the definition stays, empty.
      else empties.push([(pair.key as Node).range?.[1] ?? 0, span(raw, rules)[1]])
    }
  }
  const evidence = root.items.find((pair) => keyOf(pair) === 'evidence')
  const version = root.items.find((pair) => keyOf(pair) === 'version')
  const insertAt = evidence ? span(raw, evidence)[0] : version ? span(raw, version)[1] : raw.length
  if (evidence) cuts.push(span(raw, evidence))

  let text = raw
  const edits = [...cuts.map(([from, to]) => ({ from, to, empty: false })), ...empties.map(([from, to]) => ({ from, to, empty: true }))]
  for (const { from, to, empty } of edits.sort((a, b) => b.from - a.from)) {
    if (empty) text = `${text.slice(0, text.indexOf(':', from) + 1)} {}\n${text.slice(to)}`
    else text = from === insertAt && !current ? text.slice(0, from) + text.slice(to) : cut(text, from, to)
  }
  if (current) return { yaml: text, changed: true }

  const converted = convertLegacyTrust(parsed, defaults)
  const before = text.slice(0, insertAt)
  const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const rest = text.slice(insertAt).replace(/^\n*/, '')
  return { yaml: `${before}${lead}${render(converted, new Set(Object.values(converted.sources).flatMap((source) => Object.keys(source.locator ?? {}))))}${rest ? `\n${rest}` : ''}`, changed: true }
}
