import { beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { readFixture, type Fixture } from '../../test/fixture.js'
import { parseMemoryFile, parseOntology } from '../docket.js'
import type { Origin } from '../origin.js'
import { checkDraft, evaluateDraft, parseDraft, type StoredDocument, type WorkspaceSnapshot } from './check.js'
import { MigrationInvalid, OntologyBreakingChange, OntologyInvalid, OntologyNarrowingChange } from './errors.js'
import type { Migration } from './migrations.js'

/** The fixture's ontology with one edit, made the way the editor makes it: on the YAML document. */
function edit(yaml: string, change: (doc: ReturnType<typeof parseDocument>) => void): string {
  const doc = parseDocument(yaml)
  change(doc)
  return doc.toString()
}

/** The fixture as a store holds it, published as v1, each document from `originOf` its path. */
function workspace(fixture: Fixture, originOf: (path: string) => Origin = () => 'cloud', documents = fixture.documents) {
  const stored: StoredDocument[] = documents.map((document) => ({ ...document, origin: originOf(document.path) }))
  const snapshot: WorkspaceSnapshot = {
    documents: documents.map((document) => {
      const parsed = parseMemoryFile(document.raw, document.path).document
      if (!parsed) throw new Error(`${document.path} does not parse`)
      return parsed
    }),
    origins: new Map(stored.map((document) => [document.path, document.origin])),
    head: { number: 1, ontology: parseOntology(fixture.ontology).ontology }
  }
  return { snapshot, stored }
}

const isPod = (path: string) => path.includes('/pod/')

describe('checkDraft over a workspace of 12 documents', () => {
  let fixture: Fixture
  beforeAll(async () => {
    fixture = await readFixture()
  })

  it('adding type slo is safe and introduces nothing', () => {
    const { snapshot, stored } = workspace(fixture)
    const draft = edit(fixture.ontology, (doc) => doc.setIn(['resourceTypes', 'slo'], { description: 'A service level objective.' }))
    const check = checkDraft(snapshot, stored, draft)
    expect(check.classification).toBe('safe')
    expect(check.introduced).toEqual([])
    expect(check.documents).toBe(12)
    expect(check.head).toBe(1)
    expect(check.changes).toEqual([{ op: '+', text: 'type `slo`' }])
    expect(check.migrated).toEqual([])
    expect(check.unresolved).toEqual([])
  })

  it('narrowing depends_on.to to service lists the 3 resources whose links target a datasource', () => {
    const { snapshot, stored } = workspace(fixture)
    const draft = edit(fixture.ontology, (doc) => doc.setIn(['relationships', 'depends_on', 'to'], ['service']))
    const check = checkDraft(snapshot, stored, draft)
    expect(check.classification).toBe('narrowing')
    expect(check.affected).toEqual([
      { resourceId: 'service.catalogue', origin: 'cloud' },
      { resourceId: 'service.orders', origin: 'cloud' },
      { resourceId: 'service.payments', origin: 'cloud' }
    ])
    expect(check.introduced.map((d) => d.code)).toEqual(Array(3).fill('relationship-to-violation'))
    expect(check.introduced.map((d) => d.message).join('\n')).toContain('"datasource.orders-db"')
    expect(check.changes).toEqual([{ op: '~', text: 'relationship `depends_on`: to −= `datasource`' }])
    expect(new OntologyNarrowingChange(check).message).toBe('the change gives 3 resource(s) new diagnostics; publish anyway to accept them')
  })

  it('a violation that was already there is not reported again when only what is allowed changes', () => {
    const narrowed = edit(fixture.ontology, (doc) => doc.setIn(['relationships', 'depends_on', 'to'], ['service']))
    const { snapshot, stored } = workspace(fixture)
    const head = { number: 2, ontology: parseOntology(narrowed).ontology }
    const draft = edit(narrowed, (doc) => doc.setIn(['relationships', 'depends_on', 'to'], ['service', 'api']))
    const check = checkDraft({ ...snapshot, head }, stored, draft)
    expect(check.classification).toBe('safe')
    expect(check.introduced).toEqual([])
    expect(check.resolved).toEqual([])
  })

  it('removing type pod, used by 2 documents, is breaking', () => {
    const { snapshot, stored } = workspace(fixture)
    const draft = edit(fixture.ontology, (doc) => doc.deleteIn(['resourceTypes', 'pod']))
    const check = checkDraft(snapshot, stored, draft)
    expect(check.classification).toBe('breaking')
    expect(check.introduced).toEqual([
      expect.objectContaining({ code: 'unknown-type', id: 'pod.orders-7f9c', severity: 'error' }),
      expect.objectContaining({ code: 'unknown-type', id: 'pod.payments-5d2a', severity: 'error' })
    ])
    expect(check.unresolved).toEqual([
      { resourceId: 'pod.orders-7f9c', origin: 'cloud', changes: ['type pod'], updatable: false },
      { resourceId: 'pod.payments-5d2a', origin: 'cloud', changes: ['type pod'], updatable: false }
    ])
    expect(new OntologyBreakingChange(check).message).toBe(
      'the change breaks 2 resource(s); add a migration that resolves them, or give each a disposition'
    )
  })

  it('a migration step that resolves nothing does not unblock a breaking change', () => {
    const { snapshot, stored } = workspace(fixture)
    const draft = edit(fixture.ontology, (doc) => doc.deleteIn(['resourceTypes', 'pod']))
    const migration: Migration[] = [{ op: 'dropAttribute', type: 'service', from: 'nonexistent' }]
    const check = checkDraft(snapshot, stored, draft, { migration })
    expect(check.classification).toBe('breaking')
    expect(check.migrated).toEqual([])
    expect(check.unresolved).toEqual([
      { resourceId: 'pod.orders-7f9c', origin: 'cloud', changes: ['type pod'], updatable: false },
      { resourceId: 'pod.payments-5d2a', origin: 'cloud', changes: ['type pod'], updatable: false }
    ])
  })

  it('a rename migration rewrites the cloud documents with evidence, and leaves a repo one to its source', () => {
    // One pod comes from a repo: it cannot be rewritten in place.
    const documents = fixture.documents.map((document) =>
      document.path.endsWith('pod/payments-5d2a.md') ? { ...document, raw: `${document.raw}\nSeen in the cluster.\n` } : document
    )
    const { snapshot, stored } = workspace(fixture, (path) => (path.endsWith('pod/payments-5d2a.md') ? 'repo' : 'cloud'), documents)
    const draft = edit(fixture.ontology, (doc) => {
      doc.deleteIn(['resourceTypes', 'pod'])
      doc.setIn(['resourceTypes', 'container'], { description: 'A running container.', icon: 'container' })
    })
    const migration: Migration[] = [{ op: 'renameType', from: 'pod', to: 'container' }]
    const repoUnresolved = { resourceId: 'pod.payments-5d2a', origin: 'repo', changes: ['type pod'], updatable: true }

    const check = checkDraft(snapshot, stored, draft, { migration, login: 'alice' })
    expect(check.migrated).toEqual(['.docket/resources/pod/orders-7f9c.md'])
    expect(check.unresolved).toEqual([repoUnresolved])
    expect(check.affected).toEqual([{ resourceId: 'pod.payments-5d2a', origin: 'repo' }])

    const evaluation = evaluateDraft(snapshot, stored, parseDraft(draft).ontology, { migration, login: 'alice' })
    expect(evaluation.rewrites).toEqual([
      {
        path: '.docket/resources/pod/orders-7f9c.md',
        resourceId: 'pod.orders-7f9c',
        evidence: { source: 'human', observedBy: 'alice', note: 'ontology v2 migration: renameType pod -> container' },
        raw: [
          '---',
          'id: pod.orders-7f9c',
          'type: container',
          'title: orders-7f9c',
          'evidence:',
          '  - source: human',
          '    observedBy: alice',
          '    note: "ontology v2 migration: renameType pod -> container"',
          '---',
          ''
        ].join('\n')
      }
    ])
  })

  it('names the version a migration is for, and the publisher when no login is given', () => {
    const { snapshot, stored } = workspace(fixture)
    const draft = edit(fixture.ontology, (doc) => {
      doc.deleteIn(['resourceTypes', 'pod'])
      doc.setIn(['resourceTypes', 'container'], { description: 'A running container.' })
    })
    const migration: Migration[] = [{ op: 'mapType', from: 'pod', to: 'container' }]
    const evaluation = evaluateDraft(snapshot, stored, parseDraft(draft).ontology, { migration, version: 7 })
    expect(evaluation.rewrites.map((rewrite) => rewrite.evidence)).toEqual(
      Array(2).fill({ source: 'human', observedBy: 'publisher', note: 'ontology v7 migration: mapType pod -> container' })
    )
    // The pods become containers, which no policy names: their code evidence
    // is worth the source's 0.6, not a pod's 0.3, and the migration's human
    // evidence adds to it.
    expect(evaluation.check.classification).toBe('rescore')
    expect(evaluation.check.rescored.every((entry) => entry.after > entry.before)).toBe(true)
  })

  it('refuses a migration that names what the draft does not have, and a draft that is not an ontology', () => {
    const { snapshot, stored } = workspace(fixture)
    const migration: Migration[] = [{ op: 'renameType', from: 'pod', to: 'container' }]
    expect(() => checkDraft(snapshot, stored, fixture.ontology, { migration })).toThrow(MigrationInvalid)
    expect(() => checkDraft(snapshot, stored, 'version: 1\nresourceTypes: [\n')).toThrow(OntologyInvalid)
  })

  it('a policy edit is a rescore: it lists every resource and link whose confidence moves, and needs no acceptance', () => {
    const { snapshot, stored } = workspace(fixture)
    // What a manifest says of any resource: 0.9 -> 0.7.
    const draft = edit(fixture.ontology, (doc) => {
      const at = (doc.getIn(['trust', 'policies']) as { items: { get: (key: string) => unknown }[] }).items.findIndex(
        (policy) => policy.get('name') === 'manifest evidence'
      )
      doc.setIn(['trust', 'policies', at, 'score'], 0.7)
    })
    const check = checkDraft(snapshot, stored, draft)
    expect(check.classification).toBe('rescore')
    expect(check.introduced).toEqual([])
    expect(check.changes).toEqual([{ op: '~', text: 'policy `manifest evidence`: score 0.9 → 0.7' }])
    expect(check.rescored).toEqual([
      expect.objectContaining({ before: 0.9, after: 0.7, bandBefore: 'established', bandAfter: 'probable' })
    ])
    expect(check.rescored[0]?.link).toBeUndefined()
  })

  it('rewriting the same policies in another order rescores nothing, and stays safe', () => {
    const { snapshot, stored } = workspace(fixture)
    const draft = edit(fixture.ontology, (doc) => {
      const policies = doc.getIn(['trust', 'policies']) as { items: unknown[] }
      policies.items.reverse()
    })
    const check = checkDraft(snapshot, stored, draft)
    expect(check.classification).toBe('safe')
    expect(check.rescored).toEqual([])
  })

  it('checks a first ontology against nothing published', () => {
    const { snapshot, stored } = workspace(fixture)
    const check = checkDraft({ ...snapshot, head: null }, stored, fixture.ontology)
    expect(check.head).toBe(0)
    expect(check.classification).toBe('safe')
    expect(check.changes.every((change) => change.op === '+')).toBe(true)
  })
})

describe('the breaking-change gate when the broken documents come from a repo or the CLI', () => {
  let fixture: Fixture
  const originOf = (path: string): Origin => (isPod(path) ? (path.includes('orders') ? 'repo' : 'cli') : 'cloud')
  beforeAll(async () => {
    fixture = await readFixture()
  })

  it('an unrelated migration step does not make removing type pod updatable at the source', () => {
    const { snapshot, stored } = workspace(fixture, originOf)
    const draft = edit(fixture.ontology, (doc) => doc.deleteIn(['resourceTypes', 'pod']))
    const migration: Migration[] = [{ op: 'dropAttribute', type: 'service', from: 'nonexistent' }]
    const check = checkDraft(snapshot, stored, draft, { migration })
    expect(check.classification).toBe('breaking')
    expect(check.affected).toEqual([
      { resourceId: 'pod.orders-7f9c', origin: 'repo' },
      { resourceId: 'pod.payments-5d2a', origin: 'cli' }
    ])
    expect(check.unresolved.map((u) => [u.resourceId, u.updatable])).toEqual([
      ['pod.orders-7f9c', false],
      ['pod.payments-5d2a', false]
    ])
  })

  it('a rename that rewrites no document leaves each resource unresolved, and updatable at its source', () => {
    const { snapshot, stored } = workspace(fixture, originOf)
    const draft = edit(fixture.ontology, (doc) => {
      doc.deleteIn(['resourceTypes', 'pod'])
      doc.setIn(['resourceTypes', 'container'], { description: 'A running container.' })
    })
    const migration: Migration[] = [{ op: 'renameType', from: 'pod', to: 'container' }]
    const check = checkDraft(snapshot, stored, draft, { migration })
    expect(check.migrated).toEqual([])
    expect(check.unresolved).toEqual([
      { resourceId: 'pod.orders-7f9c', origin: 'repo', changes: ['type pod'], updatable: true },
      { resourceId: 'pod.payments-5d2a', origin: 'cli', changes: ['type pod'], updatable: true }
    ])
  })
})
