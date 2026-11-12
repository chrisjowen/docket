import { readFile } from 'node:fs/promises'

import { evidenceFor, hash32, random, sample, slug, type Corpus, type CorpusEntity, type EvalQuery } from '../corpus.js'
import { absentNames, dataFile, whoIsQuery, type QueryBudget } from './common.js'

/*
 * LoCoMo (Maharana et al., 2024, "Evaluating Very Long-Term Conversational
 * Memory of LLM Agents"; the benchmark mem0's own paper reports on) as
 * personal knowledge: each speaker a person, each session a conversation,
 * each observation the benchmark extracted a note about its speaker, each
 * event summary an event. A question's relevant entities are the notes taken
 * from the dialogue turns its evidence cites (grade 2) and the session they
 * were said in (grade 1).
 *
 * Conversations conv-43 and conv-47 are left out: their speaker John shares a
 * first name with conv-41's, and a question about "John" could not say whose.
 * Category 5 (adversarial) questions are left out too: they ask about the
 * wrong speaker, so the records are relevant even though the answer is not.
 * No-answer questions are answerable ones with the speaker swapped for a name
 * the corpus never mentions, and "who is <name>".
 */

interface Turn {
  speaker: string
  dia_id: string
  text: string
}

interface Conversation {
  sample_id: string
  conversation: Record<string, string | Turn[]>
  observation: Record<string, Record<string, [string, string | string[]][]>>
  event_summary: Record<string, Record<string, string[] | string>>
  session_summary: Record<string, string>
  qa: { question: string; answer?: unknown; evidence: string[]; category: number }[]
}

const SKIPPED = new Set(['conv-43', 'conv-47'])

const CATEGORY: Record<number, string> = { 1: 'multi-hop', 2: 'temporal', 3: 'open-domain', 4: 'single-hop' }

const EVIDENCE = [
  { source: 'conversation', note: 'Said in the recorded conversation.' },
  { source: 'message', key: 'locomo' },
  { source: 'journal', path: 'journal/locomo.md' },
  { source: 'inferred', note: 'Summarised from the conversation by the benchmark.' }
]

const short = (text: string, max = 90): string => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`)

export const loadLocomo = async (budget: QueryBudget): Promise<Corpus> => {
  const data = JSON.parse(await readFile(dataFile('locomo10.json'), 'utf8')) as Conversation[]
  const entities: CorpusEntity[] = []
  /** Note ids by `<sample>/<dia_id>`. */
  const notesByTurn = new Map<string, string[]>()
  const candidates: (EvalQuery & { speakers: string[] })[] = []

  for (const conversation of data.filter((item) => !SKIPPED.has(item.sample_id))) {
    const sampleId = conversation.sample_id
    const speakers = [conversation.conversation.speaker_a, conversation.conversation.speaker_b] as string[]
    const personId = (name: string): string => `person.${slug(name)}`
    const sessionId = (n: number): string => `conversation.${sampleId}-session-${n}`
    const personLinks: Record<string, { rel: string; target: string }[]> = Object.fromEntries(speakers.map((name) => [name, []]))
    const other = (name: string): string => speakers.find((speaker) => speaker !== name) as string

    for (const [key, summary] of Object.entries(conversation.session_summary)) {
      const n = Number(/session_(\d+)_summary/.exec(key)?.[1])
      const date = String(conversation.conversation[`session_${n}_date_time`] ?? '')
      entities.push({
        id: sessionId(n),
        type: 'conversation',
        title: `${speakers.join(' and ')}, session ${n} (${date})`,
        body: summary,
        attributes: { date },
        evidence: evidenceFor(sessionId(n), EVIDENCE)
      })
      for (const name of speakers) personLinks[name]?.push({ rel: 'participant_in', target: sessionId(n) })
    }

    for (const [key, bySpeaker] of Object.entries(conversation.observation)) {
      const n = Number(/session_(\d+)_observation/.exec(key)?.[1])
      for (const [speaker, observations] of Object.entries(bySpeaker)) {
        observations.forEach(([text, turns], index) => {
          const id = `note.${sampleId}-s${n}-${slug(speaker)}-${index + 1}`
          entities.push({
            id,
            type: 'note',
            title: short(text),
            body: text,
            attributes: { date: String(conversation.conversation[`session_${n}_date_time`] ?? '') },
            links: [
              { rel: 'about', target: personId(speaker) },
              { rel: 'recorded_in', target: sessionId(n) }
            ],
            evidence: evidenceFor(id, EVIDENCE)
          })
          for (const turn of Array.isArray(turns) ? turns : [turns]) {
            for (const dia of String(turn).split(/[;,\s]+/).filter(Boolean)) {
              const at = `${sampleId}/${dia}`
              notesByTurn.set(at, [...(notesByTurn.get(at) ?? []), id])
            }
          }
        })
      }
    }

    for (const [key, summary] of Object.entries(conversation.event_summary)) {
      const n = Number(/events_session_(\d+)/.exec(key)?.[1])
      const date = typeof summary.date === 'string' ? summary.date : ''
      for (const name of speakers) {
        const events = summary[name]
        if (!Array.isArray(events)) continue
        events.forEach((text, index) => {
          if (!text.trim()) return
          const id = `event.${sampleId}-s${n}-${slug(name)}-${index + 1}`
          entities.push({
            id,
            type: 'event',
            title: short(text),
            body: `${text}\n\nOn ${date}.`,
            attributes: { date },
            links: [{ rel: 'recorded_in', target: sessionId(n) }],
            evidence: evidenceFor(id, EVIDENCE)
          })
          personLinks[name]?.push({ rel: 'participant_in', target: id })
        })
      }
    }

    for (const name of speakers) {
      entities.push({
        id: personId(name),
        type: 'person',
        title: name,
        body: `${name} talks with ${other(name)} over ${Object.keys(conversation.session_summary).length} recorded sessions.`,
        links: [{ rel: 'knows', target: personId(other(name)) }, ...(personLinks[name] ?? [])],
        evidence: evidenceFor(personId(name), EVIDENCE)
      })
    }

    conversation.qa.forEach((qa, index) => {
      const category = CATEGORY[qa.category]
      if (!category) return
      const relevant: Record<string, number> = {}
      for (const dia of qa.evidence.flatMap((item) => item.split(/[;,\s]+/)).filter(Boolean)) {
        const session = /^D(\d+):/.exec(dia)?.[1]
        if (session) relevant[sessionId(Number(session))] = Math.max(relevant[sessionId(Number(session))] ?? 0, 1)
        for (const note of notesByTurn.get(`${sampleId}/${dia}`) ?? []) relevant[note] = 2
      }
      // A session is the answer itself when no note was taken from the turn.
      if (!Object.values(relevant).includes(2)) for (const id of Object.keys(relevant)) relevant[id] = 2
      if (Object.keys(relevant).length === 0) return
      candidates.push({ id: `${sampleId}-q${index + 1}`, text: qa.question, kind: 'answerable', category, relevant, speakers })
    })
  }

  const known = new Set(entities.map((entity) => entity.id))
  for (const candidate of candidates) {
    for (const id of Object.keys(candidate.relevant)) if (!known.has(id)) delete candidate.relevant[id]
  }

  const next = random(hash32('locomo'))
  const usable = candidates.filter((query) => Object.keys(query.relevant).length > 0)
  const answerable = sample(usable, budget.answerable, next)
  const chosen = new Set(answerable.map((query) => query.id))
  const names = absentNames(entities)
  const swappable = sample(
    // Exactly one speaker named: a question naming both would still be half answerable.
    usable.filter((query) => !chosen.has(query.id) && query.speakers.filter((name) => new RegExp(`\\b${name}\\b`).test(query.text)).length === 1),
    Math.max(0, budget.noAnswer - 1),
    next
  )
  const noAnswer: EvalQuery[] = swappable.map((query, index) => {
    const name = names[(index % (names.length - 1)) + 1] as string
    const speaker = query.speakers.find((who) => new RegExp(`\\b${who}\\b`).test(query.text)) as string
    return {
      id: `${query.id}-as-${name.toLowerCase()}`,
      text: query.text.replace(new RegExp(`\\b${speaker}\\b`, 'g'), name),
      kind: 'no-answer',
      category: 'swapped-name',
      relevant: {}
    }
  })

  return {
    name: 'locomo',
    domain: 'personal knowledge',
    source: 'LoCoMo (snap-research/locomo, CC BY-NC 4.0): 8 of 10 long conversations',
    template: 'personal-knowledge',
    entities,
    queries: [...answerable.map(({ speakers: _, ...query }) => query), whoIsQuery(names[0] as string), ...noAnswer]
  }
}
