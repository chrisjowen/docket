/** Words too common to say what a question is about. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'did', 'do', 'does', 'for',
  'from', 'has', 'have', 'how', 'in', 'is', 'it', 'its', 'many', 'much', 'of', 'on', 'or', 'our', 'the', 'their',
  'this', 'to', 'use', 'uses', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with'
])

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? []

/** The words of a question worth matching on: lower-cased, without stop words or single letters. */
export const questionTerms = (question: string): string[] => [
  ...new Set(words(question).filter((word) => word.length > 1 && !STOP_WORDS.has(word)))
]

/** How many of `terms` the text holds, a word matching a term it starts with - `upload` finds `uploads`. */
export const termsIn = (text: string, terms: readonly string[]): number => {
  const held = words(text)
  return terms.filter((term) => held.some((word) => word.startsWith(term))).length
}

export interface Excerpt {
  text: string
  /** Some of the text was left out. */
  truncated: boolean
}

const GAP = '\n\n…\n\n'

/** At most `maxChars` of `text`, cut at a word boundary and centred on the first term it holds. */
const window = (text: string, terms: readonly string[], maxChars: number): string => {
  if (text.length <= maxChars) return text
  const lower = text.toLowerCase()
  const first = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0
  let start = Math.max(0, Math.min(first - Math.floor(maxChars / 3), text.length - maxChars))
  let end = start + maxChars
  if (start > 0) start = text.indexOf(' ', start) + 1 || start
  if (end < text.length) end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/**
 * The parts of `text` most relevant to `terms`, within `maxChars`: whole
 * paragraphs ranked by how many of the terms they hold, kept in their own
 * order with a marked gap where any were left out. Text with no matching
 * paragraph gives its beginning. Relevant passages anywhere in a long body
 * survive, where cutting every body at the same length would keep only its
 * opening.
 */
export const relevantExcerpt = (text: string, terms: readonly string[], maxChars: number): Excerpt => {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false }
  if (maxChars <= 0) return { text: '', truncated: trimmed.length > 0 }

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((paragraph, index) => ({ paragraph: paragraph.trim(), index, score: termsIn(paragraph, terms) }))
    .filter(({ paragraph }) => paragraph.length > 0)
  const ranked = [...paragraphs].sort((a, b) => b.score - a.score || a.index - b.index)
  if ((ranked[0]?.score ?? 0) === 0) return { text: window(trimmed, [], maxChars), truncated: true }

  const chosen: typeof paragraphs = []
  let used = 0
  for (const candidate of ranked) {
    if (candidate.score === 0 && chosen.length > 0) break
    const cost = candidate.paragraph.length + (chosen.length > 0 ? GAP.length : 0)
    if (used + cost <= maxChars) {
      chosen.push(candidate)
      used += cost
    } else if (chosen.length === 0) {
      return { text: window(candidate.paragraph, terms, maxChars), truncated: true }
    }
  }

  chosen.sort((a, b) => a.index - b.index)
  let joined = ''
  for (const [position, { paragraph, index }] of chosen.entries()) {
    const previous = chosen[position - 1]
    joined += position === 0 ? (index > 0 ? `…\n\n${paragraph}` : paragraph) : `${previous && index === previous.index + 1 ? '\n\n' : GAP}${paragraph}`
  }
  const last = chosen.at(-1)
  if (last && last.index < (paragraphs.at(-1)?.index ?? 0)) joined += '\n\n…'
  return { text: joined, truncated: true }
}
