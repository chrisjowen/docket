// SPDX-License-Identifier: AGPL-3.0-only
import { validate } from '@chrisjowen/docket'
import type { AskOutcome } from '@chrisjowen/docket/query/ask'
import type { ValidateResult } from '@docket/platform-canonical-store'
import { FIXTURE_ROOT } from '@docket/platform-canonical-store/fixture'
import { describe, expect, it } from 'vitest'

import { changesFound, MAX_RERANKED, parseSearch, POOL_PER_SOURCE, QueryFailure, rankCandidates, searchBoard, searchCandidates, searchDepth, type Asked, type BoardOptions, type Ranked } from './query.js'
import { Vocabulary } from './relevance.js'
import type { Reranker } from './reranker.js'

const NOW = new Date('2026-11-12T00:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

interface Entity {
  id: string
  type: string
  title: string
  path: string
  content: string
  attributes: Record<string, unknown>
  confidence: number
  basis: 'evidence' | 'stated' | 'unevidenced'
  evidenceCount: number
  evidence: { source: string; observedAt?: string }[]
  links: { rel: string; target: string; evidenceCount?: number }[]
}

const entity = (id: string, overrides: Partial<Entity> = {}): Entity => ({
  id,
  type: id.split('.')[0] ?? '',
  title: id,
  path: `.docket/resources/${id}.md`,
  content: `${id} is described here.`,
  attributes: {},
  confidence: 0.9,
  basis: 'evidence',
  evidenceCount: 1,
  evidence: [{ source: 'code', observedAt: NOW.toISOString() }],
  links: [],
  ...overrides,
})

interface Source {
  name: string
  hits: string[]
  /** Each hit's own score, in order. */
  scores?: number[]
  graph?: { nodes: string[]; edges?: { source: string; rel: string; target: string }[]; paths?: string[][] }
}

/** What `ask` read and the projections answered: each source's hits, and the subgraph it returned. */
function asked(entities: readonly { id: string }[], sources: Source[]): Asked {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const outcome = {
    answer: {
      question: 'q',
      results: sources.map((source) => ({
        state: 'answered',
        adapter: source.name,
        answer: {
          interpretation: {},
          evidence: [],
          blocks: [
            { kind: 'entities', entities: source.hits.map((id, index) => ({ ref: { kind: 'entity', id }, ...(source.scores ? { score: source.scores[index] } : {}) })) },
            ...(source.graph
              ? [
                  {
                    kind: 'graph',
                    nodes: source.graph.nodes.map((id) => ({ id, label: id, ref: { kind: 'entity', id } })),
                    edges: source.graph.edges ?? [],
                    paths: source.graph.paths ?? [],
                  },
                ]
              : []),
          ],
        },
      })),
    },
    snapshot: { entity: (id: string) => byId.get(id), documents: [] },
    rejected: new Map(),
  }
  return {
    outcome: outcome as unknown as AskOutcome,
    read: { entities, documents: [] } as unknown as ValidateResult,
    index: { synced: true, behind: 0 },
    project: { name: 'Platform', root: 'platform' },
  }
}

const event = (resourceId: string): NonNullable<BoardOptions['timeline']>[number] => ({
  documents: [{ path: `.docket/resources/${resourceId}.md`, resourceId, change: 'updated' }],
})

const quiet = { info: () => undefined, error: () => undefined }

/** A re-ranker that scores each text with `score`, and remembers what it was asked. */
function fakeReranker(score: (text: string) => number): Reranker & { asked: [string, readonly string[]][] } {
  const asked: [string, readonly string[]][] = []
  return {
    model: 'cross-encoder/ms-marco-MiniLM-L6-v2@int8-vnni',
    asked,
    score: async (query, texts) => {
      asked.push([query, texts])
      return texts.map(score)
    },
  }
}

/** A ranking that keeps `ids`, most relevant first. */
const keep = (...ids: string[]): Ranked => ({ relevance: new Map(ids.map((id, index) => [id, 0.9 - index * 0.1])) })
const everything = (read: Asked, options: BoardOptions = {}): Ranked => keep(...searchCandidates('q', read, new Vocabulary([]), options).map((candidate) => candidate.id))
const candidates = (query: string, read: Asked, options: BoardOptions = {}) => searchCandidates(query, read, new Vocabulary(read.read.entities), options).map((candidate) => candidate.id)

describe('the workspace search board', () => {
  it('collapses a resource found as a fact, in a graph and on the timeline into one match, tagged with all three', () => {
    const alice = entity('person.alice-hong', { title: 'Alice Hong', content: 'Alice sent Chris an email about Q3 planning.', links: [{ rel: 'sent', target: 'email.q3' }] })
    const email = entity('email.q3', { title: 'Q3 planning', content: 'The Q3 roadmap, agreed in October.' })
    const found = searchBoard(
      'alice',
      asked(
        [alice, email],
        [
          { name: 'neo4j', hits: [alice.id], graph: { nodes: [alice.id, email.id], edges: [{ source: alice.id, rel: 'sent', target: email.id }] } },
          { name: 'mem0', hits: [alice.id] },
        ],
      ),
      keep(alice.id),
      { timeline: [event(alice.id), event(email.id)] },
    )
    expect(found.matches.map((match) => [match.id, match.foundIn, match.foundBy])).toEqual([['person.alice-hong', ['facts', 'graph', 'timeline'], ['neo4j', 'mem0']]])
    expect(found.nodes.map((node) => [node.id, node.match])).toEqual([
      ['person.alice-hong', true],
      ['email.q3', false],
    ])
    expect(found.links).toHaveLength(1)
  })

  it('never decides on confidence: a low-confidence or unevidenced resource is a candidate like any other, shown with its confidence; an untitled one never is', () => {
    const good = entity('service.good', { links: [{ rel: 'depends_on', target: 'service.shaky' }, { rel: 'depends_on', target: 'service.bare' }] })
    const shaky = entity('service.shaky', { confidence: 0.1 })
    const bare = entity('service.bare', { confidence: 0.5, basis: 'unevidenced', evidenceCount: 0, evidence: [] })
    const blank = entity('service.blank', { title: ' ', content: '' })
    const read = asked([good, shaky, bare, blank], [{ name: 'neo4j', hits: [good.id, shaky.id, bare.id, blank.id] }])
    expect(candidates('service', read)).toEqual(['service.good', 'service.shaky', 'service.bare'])
    const found = searchBoard('service', read, keep(shaky.id, good.id))
    expect(found.matches.map((match) => [match.id, match.confidence])).toEqual([
      ['service.shaky', 0.1],
      ['service.good', 0.9],
    ])
    expect(found.nodes.map((node) => [node.id, node.match])).toEqual([
      ['service.shaky', true],
      ['service.good', true],
      ['service.bare', false],
    ])
  })

  it("never takes notes that barely go past the resource's name, with nothing else behind them, for a candidate, but keeps them on the board as context", () => {
    const stated: Partial<Entity> = { basis: 'stated', evidenceCount: 0, evidence: [] }
    const named = entity('person.alice-hong', { ...stated, title: 'Alice Hong', content: 'Alice Hong.' })
    const linked = entity('person.bob', { ...stated, title: 'Bob', content: '', links: [{ rel: 'emailed', target: named.id, evidenceCount: 1 }] })
    const read = asked([named, linked], [{ name: 'neo4j', hits: [named.id, linked.id] }])
    expect(candidates('alice', read)).toEqual(['person.bob'])
    const found = searchBoard('alice', read, keep(named.id, linked.id))
    expect(found.matches.map((match) => match.id)).toEqual(['person.bob'])
    expect(found.nodes.map((node) => [node.id, node.match])).toEqual([
      ['person.bob', true],
      ['person.alice-hong', false],
    ])
    expect(found.links).toEqual([expect.objectContaining({ source: 'person.bob', rel: 'emailed', target: 'person.alice-hong' })])
  })

  it('takes a resource with an empty body for a candidate when it has evidence of its own, or attributes', () => {
    const evidenced = entity('datasource.ledger', { title: 'Ledger database', content: '' })
    const described = entity('datasource.stock', { title: 'Stock database', content: '', attributes: { engine: 'postgres' }, basis: 'stated', evidenceCount: 0, evidence: [] })
    expect(candidates('database', asked([evidenced, described], [{ name: 'neo4j', hits: [evidenced.id, described.id] }]))).toEqual(['datasource.ledger', 'datasource.stock'])
  })

  it('keeps the catalogue-db fixture on the board with its links when the ranking does not keep it, as a returned node or a neighbour', async () => {
    const { entities } = await validate({ cwd: FIXTURE_ROOT })
    expect(entities.find((e) => e.id === 'datasource.catalogue-db')).toMatchObject({ basis: 'unevidenced', evidenceCount: 0, attributes: { engine: 'mongodb' }, content: '' })
    const storefront = entity('service.storefront', { title: 'Storefront', content: 'Sells what the catalogue lists.', links: [{ rel: 'depends_on', target: 'datasource.catalogue-db' }] })
    const read = asked(
      [...entities, storefront],
      [
        {
          name: 'neo4j',
          hits: ['datasource.catalogue-db', storefront.id],
          graph: {
            nodes: ['service.catalogue', 'datasource.catalogue-db'],
            edges: [{ source: 'service.catalogue', rel: 'depends_on', target: 'datasource.catalogue-db' }],
            paths: [['service.catalogue', 'datasource.catalogue-db']],
          },
        },
      ],
    )
    const found = searchBoard('catalogue database', read, keep(storefront.id))
    expect(found.matches.map((match) => match.id)).toEqual(['service.storefront'])
    expect(found.nodes).toContainEqual(expect.objectContaining({ id: 'datasource.catalogue-db', match: false, via: 'adapter' }))
    expect(found.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'service.catalogue', rel: 'depends_on', target: 'datasource.catalogue-db', via: 'adapter' }),
        expect.objectContaining({ source: 'service.storefront', rel: 'depends_on', target: 'datasource.catalogue-db', via: 'canonical' }),
      ]),
    )
    expect(found.paths).toEqual([expect.objectContaining({ nodes: ['service.catalogue', 'datasource.catalogue-db'] })])

    const neighbour = searchBoard('catalogue database', read, keep(storefront.id), { include: ['facts'] })
    expect(neighbour.matches.map((match) => match.id)).toEqual(['service.storefront'])
    expect(neighbour.nodes).toContainEqual(expect.objectContaining({ id: 'datasource.catalogue-db', match: false, via: 'canonical' }))
  })

  it('keeps the best `limit` matches the ranking keeps, and only those on the board as matches', () => {
    const all = ['service.alpha', 'service.beta', 'service.gamma'].map((id) => entity(id))
    const read = asked(all, [{ name: 'neo4j', hits: all.map((e) => e.id) }])
    const found = searchBoard('service', read, keep('service.gamma', 'service.alpha', 'service.beta'), { limit: 2 })
    expect(found.matches.map((match) => match.id)).toEqual(['service.gamma', 'service.alpha'])
    expect(found.nodes.map((node) => [node.id, node.match])).toEqual([
      ['service.gamma', true],
      ['service.alpha', true],
    ])
    expect(searchBoard('service', read, { relevance: new Map() }).matches).toEqual([])
  })

  it('keeps one of two notes that say the same thing: the better evidenced, then the more confident', () => {
    const said = 'Alice sent Chris an email; she seemed a little dismissive about Sophia.'
    const once = entity('note.once', { content: said, evidenceCount: 1, confidence: 0.95 })
    const thrice = entity('note.thrice', { content: said, evidenceCount: 3, confidence: 0.8 })
    const sure = entity('fact.sure', { content: 'Orders run on Postgres.', confidence: 0.9 })
    const unsure = entity('fact.unsure', { content: 'Orders run on Postgres', confidence: 0.6 })
    const other = entity('note.other', { content: 'Sophia owns the Q3 roadmap.' })
    const read = asked([once, thrice, sure, unsure, other], [{ name: 'neo4j', hits: [once.id, unsure.id, thrice.id, sure.id, other.id] }])
    const options = { timeline: [event(once.id)] }
    expect(candidates('once', read, options).sort()).toEqual(['fact.sure', 'note.other', 'note.thrice'])
    const found = searchBoard('once', read, everything(read, options), options)
    const byId = new Map(found.matches.map((match) => [match.id, match]))
    expect([...byId.keys()].sort()).toEqual(['fact.sure', 'note.other', 'note.thrice'])
    // The kept note carries where the other was found.
    expect(byId.get('note.thrice')).toMatchObject({ foundIn: ['facts', 'timeline'] })
    expect(found.nodes.map((node) => node.id)).not.toContain('note.once')
  })

  it("ranks by the ranking's relevance alone, its score that relevance, never confidence or recency", () => {
    const sure = entity('service.sure', { confidence: 0.99 })
    const weak = entity('service.weak', { confidence: 0.2, evidence: [{ source: 'code', observedAt: daysAgo(730) }] })
    const read = asked([sure, weak], [{ name: 'neo4j', hits: [sure.id, weak.id] }])
    const found = searchBoard('service', read, { relevance: new Map([[sure.id, 0.41234], [weak.id, 0.87]]) })
    expect(found.matches.map((match) => [match.id, match.score, match.confidence])).toEqual([
      ['service.weak', 0.87, 0.2],
      ['service.sure', 0.412, 0.99],
    ])
  })

  it("draws a subgraph's other nodes as context, never letting them displace a hit from the limit", () => {
    const read = asked(
      ['service.first', 'service.weak', 'service.context', 'service.path'].map((id) => entity(id)),
      [{ name: 'neo4j', hits: ['service.first', 'service.stale', 'service.gone', 'service.weak'], graph: { nodes: ['service.first', 'service.context', 'service.path'] } }],
    )
    const found = searchBoard('service', read, keep('service.first', 'service.weak'), { limit: 2 })
    expect(found.matches.map((match) => [match.id, match.foundIn])).toEqual([
      ['service.first', ['facts', 'graph']],
      ['service.weak', ['facts']],
    ])
    expect(found.nodes.filter((node) => !node.match).map((node) => node.id)).toEqual(['service.context', 'service.path'])
  })

  it('looks only where include says', () => {
    const hit = entity('service.hit')
    const node = entity('service.node')
    const logged = entity('service.logged')
    const read = asked([hit, node, logged], [{ name: 'neo4j', hits: [hit.id], graph: { nodes: [hit.id, node.id] } }])
    const timeline = [event(logged.id)]
    const ids = (include: BoardOptions['include']) =>
      searchBoard('logged service', read, keep(hit.id, node.id, logged.id), { include, timeline }).nodes.map((n) => [n.id, n.match])
    expect(ids(['timeline'])).toEqual([['service.logged', true]])
    expect(ids(['facts'])).toEqual([['service.hit', true]])
    expect(ids(['graph']).sort()).toEqual([
      ['service.hit', false],
      ['service.node', false],
    ])
  })

  it("takes from the timeline only the resources whose events are in the query's words", () => {
    const alice = entity('person.alice-hong', { title: 'Alice Hong', evidence: [] })
    const orders = entity('service.orders', { title: 'Orders' })
    const read = asked([alice, orders], [])
    const timeline = [event(alice.id), event(orders.id), event('person.gone')]
    expect(candidates('Alice', read, { timeline })).toEqual(['person.alice-hong'])
    const found = searchBoard('Alice', read, keep(alice.id), { timeline })
    expect(found.matches).toEqual([expect.objectContaining({ id: 'person.alice-hong', foundIn: ['timeline'], foundBy: [] })])
    expect(found.nodes).toEqual([expect.objectContaining({ id: 'person.alice-hong', match: true, via: 'canonical' })])
    // What the event was, or who made it, is not what it is about.
    expect(candidates('remember claude', read, { timeline: [event(alice.id)] })).toEqual([])
  })

  it("gives the re-ranker each candidate's type, title, attributes, links by name and body, and each projection's rank and score", () => {
    const orders = entity('service.orders', {
      title: 'Orders',
      content: '# Orders\n\nTakes   orders\nfrom the storefront.',
      attributes: { tier: 1, owner_team: 'commerce' },
      links: [{ rel: 'depends_on', target: 'datasource.ledger' }],
    })
    const ledger = entity('datasource.ledger', { title: 'Ledger database' })
    const read = asked([orders, ledger], [
      { name: 'mem0', hits: [ledger.id, orders.id], scores: [0.81, 0.74] },
      { name: 'neo4j', hits: [orders.id], scores: [3.2] },
    ])
    const [first, second] = searchCandidates('which service takes orders', read, new Vocabulary([orders, ledger]))
    expect(first).toEqual({
      id: 'service.orders',
      text: 'service: Orders\ntier: 1; owner team: commerce\nLinked: depends on Ledger database\nTakes orders from the storefront.',
      semantic: { rank: 1, score: 0.74 },
      lexical: { rank: 0, score: 3.2 },
      coverage: 1,
    })
    expect(second).toMatchObject({ id: 'datasource.ledger', semantic: { rank: 0, score: 0.81 }, lexical: undefined })
  })
})

describe('a workspace whose Muse bot was renamed from Sophia to Captin', () => {
  const chris = entity('person.chris', { title: 'Chris', content: 'Chris builds Docket.', links: [{ rel: 'runs', target: 'agent.sophia' }, { rel: 'runs', target: 'agent.captin' }] })
  const sophia = entity('agent.sophia', {
    title: 'Sophia',
    content: "Sophia is Chris's Muse bot, answering in the chris-muse workspace.",
    evidence: [{ source: 'conversation', observedAt: daysAgo(60) }],
  })
  const captin = entity('agent.captin', {
    title: 'Captin',
    content: "Captin is Chris's Muse bot. It was renamed from Sophia.",
    evidence: [{ source: 'conversation', observedAt: daysAgo(3) }],
  })
  const renamed = { supersededBy: captin.id, validUntil: new Date(daysAgo(3)), reason: 'The Muse bot was renamed from Sophia to Captin.' }
  const read = (hits: string[]): Asked => ({
    ...asked([chris, sophia, captin], [{ name: 'mem0', hits }, { name: 'neo4j', hits, graph: { nodes: [...hits, chris.id], edges: hits.map((hit) => ({ source: chris.id, rel: 'runs', target: hit })) } }]),
    supersessions: new Map([[sophia.id, renamed]]),
  })
  const since = daysAgo(3).slice(0, 10)

  it('answers "who is sophia" with Captin and a note that Sophia is out of date, never presenting Sophia as current', () => {
    const found = searchBoard('who is sophia', read([sophia.id]), keep(captin.id), { timeline: [event(sophia.id)] })
    expect(found.matches.map((match) => [match.id, match.supersedes])).toEqual([['agent.captin', ['agent.sophia']]])
    expect(found.nodes.map((node) => node.id)).not.toContain('agent.sophia')
    expect(found.links.some((link) => link.source === sophia.id || link.target === sophia.id)).toBe(false)
    expect(found.changes).toEqual([
      {
        id: 'agent.sophia',
        type: 'agent',
        title: 'Sophia',
        supersededBy: 'agent.captin',
        current: { id: 'agent.captin', type: 'agent', title: 'Captin' },
        since,
        reason: renamed.reason,
        note: `Out of date: "Sophia" (agent.sophia) is superseded by "Captin" (agent.captin) since ${since}. The Muse bot was renamed from Sophia to Captin.`,
      },
    ])
  })

  it('answers "who is captin" with the current record alone, and no change note', () => {
    const found = searchBoard('who is captin', read([captin.id]), keep(captin.id))
    expect(found.matches.map((match) => match.id)).toEqual(['agent.captin'])
    expect(found.matches[0]?.supersedes).toBeUndefined()
    expect(found.changes).toBeUndefined()
    // Sophia is not a neighbour on the board either, though Chris ran both.
    expect(searchBoard('chris', read([chris.id]), keep(chris.id)).nodes.map((node) => node.id).sort()).toEqual(['agent.captin', 'person.chris'])
  })

  it('follows a chain of replacements to the record current now', () => {
    const cap = entity('agent.cap', { title: 'Cap', evidence: [{ source: 'conversation', observedAt: daysAgo(1) }] })
    const chained: Asked = {
      ...asked([chris, sophia, captin, cap], [{ name: 'mem0', hits: [sophia.id] }]),
      supersessions: new Map([
        [sophia.id, renamed],
        [captin.id, { supersededBy: cap.id, validUntil: new Date(daysAgo(1)), reason: 'Renamed again.' }],
      ]),
    }
    const found = searchBoard('sophia', chained, keep(cap.id))
    expect(found.matches.map((match) => match.id)).toEqual(['agent.cap'])
    expect(found.changes?.[0]).toEqual(expect.objectContaining({ id: 'agent.sophia', supersededBy: 'agent.captin', current: { id: 'agent.cap', type: 'agent', title: 'Cap' } }))
  })

  it('names no change when the record current now is not a match', () => {
    const found = searchBoard('who is sophia', read([sophia.id]), { relevance: new Map() })
    expect(found.matches).toEqual([])
    expect(found.changes).toBeUndefined()
  })

  it('re-ranks the current record\'s own text for "who is sophia": Sophia is on file, so the question is asked', async () => {
    const reranker = fakeReranker(() => 4)
    const ranked = await rankCandidates(reranker, 'who is sophia', 'org/muse', read([sophia.id]), {}, quiet)
    expect(reranker.asked).toEqual([['who is sophia', ["agent: Captin\nCaptin is Chris's Muse bot. It was renamed from Sophia."]]])
    expect([...ranked.relevance.keys()]).toEqual(['agent.captin'])
  })

  it("tells docket_ask which of the projections' hits are out of date", () => {
    expect(changesFound(read([sophia.id, chris.id])).map((change) => [change.id, change.current?.id])).toEqual([['agent.sophia', 'agent.captin']])
    expect(changesFound(read([captin.id]))).toEqual([])
  })
})

describe('a search request', () => {
  const body = { orgId: 'orga', workspaceId: 'ws1', query: 'alice', limit: 10, userId: 'u1' }

  it('takes include, each backend once', () => {
    expect(parseSearch({ ...body, include: ['facts', 'timeline', 'facts'] })).toEqual({ ...body, include: ['facts', 'timeline'] })
    expect(parseSearch(body)).toEqual(body)
  })

  it('takes minConfidence and passes it on only to be ignored', () => {
    expect(parseSearch({ ...body, minConfidence: 0.3 })).toEqual({ ...body, minConfidence: 0.3 })
  })

  it('takes a pool depth', () => {
    expect(parseSearch({ ...body, pool: 50 })).toEqual({ ...body, pool: 50 })
  })

  it.each([{ include: ['notes'] }, { include: [] }, { include: 'facts' }, { minConfidence: 2 }, { minConfidence: '0.3' }, { pool: 0 }, { pool: 51 }, { pool: 2.5 }])('refuses %j', (bad) => {
    expect(() => parseSearch({ ...body, ...bad })).toThrow(QueryFailure)
  })
})

describe('how a search decides what is relevant', () => {
  const services = ['orders', 'billing', 'ledger', 'catalogue', 'storefront', 'payments', 'search', 'auth', 'mailer', 'reports'].map((name) =>
    entity(`service.${name}`, { title: name[0]?.toUpperCase() + name.slice(1), content: `The ${name} service, run by the commerce team.` }),
  )
  // Semantic search always answers with its nearest records, however far they are.
  const noSophia = asked(services, [
    { name: 'mem0', hits: services.map((s) => s.id), scores: services.map((_, i) => 0.62 - i * 0.01) },
    { name: 'neo4j', hits: [], graph: { nodes: services.slice(0, 3).map((s) => s.id) } },
  ])

  it('answers "who is sophia" with nothing in a workspace that has never recorded a Sophia, without asking the re-ranker', async () => {
    const reranker = fakeReranker(() => 10)
    for (const question of ['who is sophia', 'Who is Sophia?', "what has Sophia worked on", 'who is our Sophia']) {
      const ranked = await rankCandidates(reranker, question, 'org/platform', noSophia, {}, quiet)
      expect(ranked.relevance.size, question).toBe(0)
      const found = searchBoard(question, noSophia, ranked)
      expect(found.matches, question).toEqual([])
      expect(found.nodes, question).toEqual([])
    }
    expect(reranker.asked).toEqual([])
  })

  it('still asks when the name is on file, or the capitalised word only starts a sentence, or is a code', async () => {
    const reranker = fakeReranker(() => 4)
    for (const question of ['who is billing', 'Billing. Who runs it?', 'Which service handles SKU-42?']) {
      await rankCandidates(reranker, question, 'org/platform', noSophia, {}, quiet)
    }
    expect(reranker.asked.map(([question]) => question)).toEqual(['who is billing', 'Billing. Who runs it?', 'Which service handles SKU-42?'])
  })

  it('returns only what the re-ranker reads as answering the question, and nothing when nothing does', async () => {
    const billing = (text: string) => (text.startsWith('service: Billing') ? 8 : -10)
    const kept = await rankCandidates(fakeReranker(billing), 'which service bills customers', 'org/platform', noSophia, {}, quiet)
    expect([...kept.relevance.keys()]).toEqual(['service.billing'])
    const none = await rankCandidates(fakeReranker(() => -10), 'which service bills customers', 'org/platform', noSophia, {}, quiet)
    expect(none.relevance.size).toBe(0)
  })

  it('asks as deep as a pool says, the re-ranker reading twice as many within what it reads at once', async () => {
    expect(searchDepth()).toEqual({ perSource: POOL_PER_SOURCE, reranked: MAX_RERANKED })
    expect(searchDepth(5)).toEqual({ perSource: POOL_PER_SOURCE, reranked: MAX_RERANKED })
    expect(searchDepth(25)).toEqual({ perSource: 25, reranked: 50 })
    expect(searchDepth(50)).toEqual({ perSource: 50, reranked: 64 })
    const many = Array.from({ length: 40 }, (_, i) => entity(`service.s${i}`, { title: `S${i}`, content: `The s${i} service.` }))
    const deep = asked(many, [{ name: 'mem0', hits: many.map((s) => s.id), scores: many.map((_, i) => 0.8 - i * 0.01) }])
    const shallow = fakeReranker(() => -10)
    await rankCandidates(shallow, 'which service', 'org/platform', deep, {}, quiet)
    expect(shallow.asked[0]?.[1]).toHaveLength(MAX_RERANKED)
    const deeper = fakeReranker(() => -10)
    await rankCandidates(deeper, 'which service', 'org/platform', deep, { reranked: searchDepth(25).reranked }, quiet)
    expect(deeper.asked[0]?.[1]).toHaveLength(40)
  })

  it("cuts on the projections' scores alone, and says so, when the re-ranker fails", async () => {
    const errors: string[] = []
    const failing: Reranker = { model: 'x', score: () => Promise.reject(new Error('connection refused')) }
    const ranked = await rankCandidates(failing, 'billing service', 'org/platform', noSophia, {}, { info: () => undefined, error: (m) => errors.push(m) })
    expect(ranked.warnings).toEqual([expect.stringContaining('re-ranker did not answer')])
    expect(errors).toEqual([expect.stringContaining('connection refused')])
    expect(searchBoard('billing service', noSophia, ranked).warnings).toEqual(ranked.warnings)
  })
})

describe('cognee in the search, for a workspace that turned it on', () => {
  it("tags what cognee found as cognee's, ranked as a semantic hit alongside mem0's", () => {
    const orders = entity('service.orders', { title: 'Orders', content: 'Takes customer checkouts and reserves stock.' })
    const read = asked([orders], [{ name: 'cognee', hits: [orders.id], scores: [0.8] }])
    const [candidate] = searchCandidates('checkouts', read, new Vocabulary(read.read.entities))
    expect(candidate).toMatchObject({ id: 'service.orders', semantic: { rank: 0, score: 0.8 } })
    const found = searchBoard('checkouts', read, keep(orders.id))
    expect(found.matches).toEqual([expect.objectContaining({ id: 'service.orders', foundBy: ['cognee'] })])
    expect(found.sources).toEqual([{ name: 'cognee', hits: 1 }])
  })

  it('answers with nothing from cognee when its floor left nothing: no candidate, no match', () => {
    const hannah = entity('person.hannah', { title: 'Hannah Okoro', content: 'Runs the platform team.' })
    const read = asked([hannah], [{ name: 'cognee', hits: [] }])
    expect(searchCandidates('who is sophia', read, new Vocabulary(read.read.entities))).toEqual([])
    expect(searchBoard('who is sophia', read, { relevance: new Map() }).matches).toEqual([])
  })
})
