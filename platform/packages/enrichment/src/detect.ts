// SPDX-License-Identifier: AGPL-3.0-only
import type { MemoryEntity, Ontology } from '@docket/platform-canonical-store'

/**
 * What background enrichment looks for in a workspace's resources, by rule:
 * links their names and attributes imply, owners their neighbours imply,
 * duplicates and the contradictions between them. Pure: it reads the merged
 * resources and the published ontology, and only proposes relationships the
 * ontology allows between the two types.
 */

export type InferenceKind = 'link' | 'owner' | 'duplicate' | 'contradiction'

/** Relationships enrichment writes by name, when the ontology has them. */
export const OWNER_REL = 'owned_by'
export const DUPLICATE_REL = 'duplicate_of'
export const CONTRADICTS_REL = 'contradicts'
const SPECIAL = new Set([OWNER_REL, DUPLICATE_REL, CONTRADICTS_REL])

/** Where an inference was read: a resource, the document it was read in, and what was read there. */
export interface Cited {
  id: string
  path: string
  what: string
}

export interface Candidate {
  kind: InferenceKind
  /** The resource the link is written on. */
  from: string
  target: string
  /** The relationships that fit, most specific first. */
  rels: string[]
  /** Whether the rule alone decides it: one relationship fits, and its definition names both types. */
  certain: boolean
  /** Why, in a sentence a person reads. */
  reasoning: string
  cited: Cited[]
}

/**
 * What makes two candidates the same inference, whichever relationship is
 * chosen: what it connects, either way round for all but an owner.
 */
export function fingerprint(candidate: Pick<Candidate, 'kind' | 'from' | 'target'>): string {
  const [a, b] = candidate.kind !== 'owner' && candidate.target < candidate.from ? [candidate.target, candidate.from] : [candidate.from, candidate.target]
  return `${candidate.kind}|${a}|${b}`
}

type Resource = Pick<MemoryEntity, 'id' | 'type' | 'title' | 'path' | 'attributes' | 'links' | 'content' | 'mentions' | 'evidence'>

const normal = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const slugOf = (resource: Pick<Resource, 'id' | 'type'>): string =>
  resource.id.startsWith(`${resource.type}.`) ? resource.id.slice(resource.type.length + 1) : resource.id

/** The names a resource goes by, normalised: its title and its slug. Short or numeric ones say too little. */
function namesOf(resource: Resource): string[] {
  const names = new Set([normal(resource.title), normal(slugOf(resource))])
  return [...names].filter((name) => name.length >= 4 && !/^[0-9 ]+$/.test(name))
}

/** Whether `text` (normalised) contains `name` as whole words. */
const names = (text: string, name: string): boolean => ` ${text} `.includes(` ${name} `)

/** What a resource's text is read as, once per run: its names, its description's words and ids, its attributes' words. */
interface Read {
  names: string[]
  body: string
  ids: Set<string>
  attributes: [key: string, item: string, normalised: string][]
}

function read(resource: Resource): Read {
  const attributes: Read['attributes'] = []
  for (const [key, value] of Object.entries(resource.attributes)) {
    for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') attributes.push([key, item, normal(item)])
  }
  return {
    names: namesOf(resource),
    body: normal(resource.content),
    ids: new Set((resource.content.match(/[A-Za-z0-9._-]+/g) ?? []).map((token) => token.replace(/^\.+|\.+$/g, ''))),
    attributes,
  }
}

const quoted = (resource: Pick<Resource, 'id' | 'title'>) => `${resource.title} (${resource.id})`

function accepts(constraint: '*' | string[], type: string): boolean {
  return constraint === '*' || constraint.includes(type)
}

/**
 * The relationships allowed from `from` to `to`, the special ones left out:
 * those whose definition names both types when there are any (`specific`),
 * else those that take any type.
 */
export function fitting(ontology: Ontology, from: string, to: string): { rels: string[]; specific: boolean } {
  const specific: string[] = []
  const general: string[] = []
  for (const [rel, definition] of Object.entries(ontology.relationships)) {
    if (SPECIAL.has(rel)) continue
    if (!accepts(definition.from, from) || !accepts(definition.to, to)) continue
    if (definition.from !== '*' && definition.to !== '*') specific.push(rel)
    else general.push(rel)
  }
  specific.sort()
  general.sort()
  return specific.length ? { rels: specific, specific: true } : { rels: general, specific: false }
}

const allows = (ontology: Ontology, rel: string, from: string, to: string): boolean => {
  const definition = ontology.relationships[rel]
  return Boolean(definition && accepts(definition.from, from) && accepts(definition.to, to))
}

/** Where a resource's text names another, if it does: its description, an attribute, or a `[[id]]` mention. */
function whereNamed(resource: Resource, text: Read, other: Resource, otherNames: string[]): string | null {
  if (resource.mentions.includes(other.id)) return `its description mentions [[${other.id}]]`
  if (text.ids.has(other.id) || otherNames.some((name) => names(text.body, name))) return `its description names ${other.title}`
  for (const [key, item, normalised] of text.attributes) {
    if (item === other.id || otherNames.some((name) => names(normalised, name))) return `its attribute ${key} names ${other.title}`
  }
  return null
}

/** Whether two resources of different types share a name stem: `orders-7f9c` and `orders`, a pod named for its service. */
function stemmed(a: Resource, b: Resource): boolean {
  if (a.type === b.type) return false
  const left = slugOf(a).toLowerCase()
  const right = slugOf(b).toLowerCase()
  if (left === right) return true
  const [short, long] = left.length < right.length ? [left, right] : [right, left]
  return short.length >= 4 && (long.startsWith(`${short}-`) || long.startsWith(`${short}_`))
}

export interface DetectInput {
  /** The resources as the documents people, repos and checkouts wrote say them: inferences never build on inferences. */
  resources: readonly Resource[]
  ontology: Ontology
  /** Links earlier runs inferred: never inferred again, and an inferred owner is an owner. */
  inferred?: readonly { from: string; rel: string; target: string }[]
}

/** Every candidate inference in the workspace, in a stable order. */
export function detect(input: DetectInput): Candidate[] {
  const { resources, ontology } = input
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  const texts = new Map(resources.map((resource) => [resource.id, read(resource)]))
  const textOf = (resource: Resource) => texts.get(resource.id) as Read
  const namedIn = (resource: Resource, other: Resource) => whereNamed(resource, textOf(resource), other, textOf(other).names)
  // Two resources of one type that go by the same name: duplicates, not related.
  const sameName = (a: Resource, b: Resource): string | undefined =>
    a.type === b.type ? textOf(a).names.find((name) => textOf(b).names.includes(name)) : undefined
  const linked = new Set<string>()
  const said = new Set<string>()
  const links = [...resources.flatMap((resource) => resource.links.map((link) => ({ from: resource.id, rel: link.rel, target: link.target }))), ...(input.inferred ?? [])]
  for (const { from, rel, target } of links) {
    linked.add(`${from}\u0000${target}`)
    linked.add(`${target}\u0000${from}`)
    said.add(`${from}\u0000${rel}\u0000${target}`)
    said.add(`${target}\u0000${rel}\u0000${from}`)
  }
  const saidAs = (a: string, rel: string, b: string) => said.has(`${a}\u0000${rel}\u0000${b}`)
  const inferredOwner = new Set((input.inferred ?? []).filter((link) => link.rel === OWNER_REL).map((link) => link.from))
  const connected = (a: string, b: string) => linked.has(`${a}\u0000${b}`)
  const out: Candidate[] = []
  const seen = new Set<string>()
  const push = (candidate: Candidate) => {
    const key = fingerprint(candidate)
    if (seen.has(key)) return
    seen.add(key)
    out.push(candidate)
  }

  // Links: a resource whose description or attributes name another, or that shares its name stem, with nothing between them yet.
  for (const resource of resources) {
    for (const other of resources) {
      if (other.id === resource.id || connected(resource.id, other.id) || sameName(resource, other)) continue
      const named = namedIn(resource, other)
      const stem = !named && stemmed(resource, other)
      if (!named && !stem) continue
      const forward = fitting(ontology, resource.type, other.type)
      const backward = forward.rels.length ? null : fitting(ontology, other.type, resource.type)
      const [from, to, fit] = backward ? [other, resource, backward] : [resource, other, forward]
      if (!fit.rels.length) continue
      const certain = fit.specific && fit.rels.length === 1
      const why = named ? `${quoted(resource)}: ${named}` : `${quoted(resource)} and ${quoted(other)} share a name`
      const only = certain ? `, and ${fit.rels[0]} is the one relationship the ontology has from a ${from.type} to a ${to.type}` : ''
      push({
        kind: 'link',
        from: from.id,
        target: to.id,
        rels: fit.rels,
        certain,
        reasoning: `${why}${only}.`,
        cited: [
          { id: resource.id, path: resource.path, what: named ?? `its name, ${slugOf(resource)}` },
          ...(stem ? [{ id: other.id, path: other.path, what: `its name, ${slugOf(other)}` }] : []),
        ],
      })
    }
  }

  // Owners: a resource with no owner, whose name sibling, neighbours or a team's description all point at one owner.
  const owner = ontology.relationships[OWNER_REL]
  if (owner) {
    const ownersOf = (resource: Resource) => [...new Set(resource.links.filter((link) => link.rel === OWNER_REL).map((link) => link.target))]
    for (const resource of resources) {
      if (!accepts(owner.from, resource.type) || ownersOf(resource).length || inferredOwner.has(resource.id)) continue
      const suggested = new Map<string, Cited[]>()
      const reasons: string[] = []
      // A name sibling's or the neighbours' owner is a strong hint; a team that only names it may just use it.
      let strong = false
      const suggest = (team: string, cited: Cited[], reason: string, hint: 'strong' | 'weak') => {
        const target = byId.get(team)
        if (!target || !allows(ontology, OWNER_REL, resource.type, target.type)) return
        suggested.set(team, [...(suggested.get(team) ?? []), ...cited])
        reasons.push(reason)
        if (hint === 'strong') strong = true
      }
      for (const sibling of resources) {
        if (sibling.id === resource.id || !stemmed(resource, sibling)) continue
        const owners = ownersOf(sibling)
        if (owners.length !== 1) continue
        const team = byId.get(owners[0] as string)
        suggest(owners[0] as string, [{ id: sibling.id, path: sibling.path, what: `${OWNER_REL} ${owners[0]}` }], `it shares its name with ${quoted(sibling)}, which ${team?.title ?? owners[0]} owns`, 'strong')
      }
      const neighbours = resources.filter(
        (other) =>
          other.id !== resource.id &&
          (resource.links.some((link) => link.target === other.id && link.rel !== OWNER_REL) ||
            other.links.some((link) => link.target === resource.id && link.rel !== OWNER_REL)),
      )
      const owned = neighbours.filter((other) => ownersOf(other).length === 1)
      const agreed = new Set(owned.map((other) => ownersOf(other)[0]))
      if (owned.length && agreed.size === 1) {
        const team = [...agreed][0] as string
        suggest(
          team,
          owned.map((other) => ({ id: other.id, path: other.path, what: `${OWNER_REL} ${team}` })),
          `everything linked to it that has an owner is owned by ${byId.get(team)?.title ?? team}: ${owned.map((other) => other.id).join(', ')}`,
          'strong',
        )
      }
      for (const team of resources) {
        if (team.id === resource.id || !allows(ontology, OWNER_REL, resource.type, team.type)) continue
        const named = namedIn(team, resource)
        if (named) suggest(team.id, [{ id: team.id, path: team.path, what: named }], `${quoted(team)}: ${named}`, 'weak')
      }
      // Two owners suggested is a question, not an inference.
      if (suggested.size !== 1) continue
      const [team, cited] = [...suggested][0] as [string, Cited[]]
      push({
        kind: 'owner',
        from: resource.id,
        target: team,
        rels: [OWNER_REL],
        certain: strong,
        reasoning: `${quoted(resource)} has no owner, and ${[...new Set(reasons)].join('; ')}.`,
        cited: dedupe(cited),
      })
    }
  }

  // Duplicates: two resources of one type that go by the same name. The one with more behind it is kept.
  const duplicate = ontology.relationships[DUPLICATE_REL]
  const contradicts = ontology.relationships[CONTRADICTS_REL]
  const weight = (resource: Resource) => resource.links.length + resource.evidence.length
  for (let i = 0; i < resources.length; i += 1) {
    for (let j = i + 1; j < resources.length; j += 1) {
      const a = resources[i] as Resource
      const b = resources[j] as Resource
      const shared = sameName(a, b)
      if (!shared) continue
      const [kept, other] = weight(b) > weight(a) || (weight(b) === weight(a) && b.id < a.id) ? [b, a] : [a, b]
      const cited = [
        { id: other.id, path: other.path, what: `its name, ${other.title}` },
        { id: kept.id, path: kept.path, what: `its name, ${kept.title}` },
      ]
      if (duplicate && allows(ontology, DUPLICATE_REL, other.type, kept.type) && !connected(other.id, kept.id)) {
        push({
          kind: 'duplicate',
          from: other.id,
          target: kept.id,
          rels: [DUPLICATE_REL],
          certain: true,
          reasoning: `${quoted(other)} and ${quoted(kept)} are both ${a.type}s that go by "${shared}"; ${kept.id} has more links and evidence behind it.`,
          cited,
        })
      }
      // Contradictions: the two disagree about an attribute both give.
      const differing = Object.keys(other.attributes)
        .filter((key) => key in kept.attributes && JSON.stringify(other.attributes[key]) !== JSON.stringify(kept.attributes[key]))
        .sort()
      if (contradicts && differing.length && allows(ontology, CONTRADICTS_REL, other.type, kept.type) && !saidAs(other.id, CONTRADICTS_REL, kept.id)) {
        const says = (resource: Resource) => differing.map((key) => `${key} ${JSON.stringify(resource.attributes[key])}`).join(', ')
        push({
          kind: 'contradiction',
          from: other.id,
          target: kept.id,
          rels: [CONTRADICTS_REL],
          certain: true,
          reasoning: `${quoted(other)} and ${quoted(kept)} look like the same ${a.type} but disagree: ${other.id} says ${says(other)}, ${kept.id} says ${says(kept)}.`,
          cited: [
            { id: other.id, path: other.path, what: says(other) },
            { id: kept.id, path: kept.path, what: says(kept) },
          ],
        })
      }
    }
  }
  return out
}

function dedupe(cited: Cited[]): Cited[] {
  const seen = new Set<string>()
  return cited.filter((entry) => {
    const key = `${entry.id}\u0000${entry.what}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
