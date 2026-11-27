// SPDX-License-Identifier: AGPL-3.0-only
import type { MemoryEntity, Ontology } from '@docket/platform-canonical-store'
import { describe, expect, it } from 'vitest'

import { detect, fingerprint, fitting, type Candidate } from './detect.js'

type Resource = Parameters<typeof detect>[0]['resources'][number]

const resource = (input: Partial<MemoryEntity> & Pick<MemoryEntity, 'id' | 'type' | 'title'>): Resource => ({
  path: `.docket/resources/${input.type}/${input.id.split('.').slice(1).join('.')}.md`,
  attributes: {},
  links: [],
  content: '',
  mentions: [],
  evidence: [],
  ...input,
})

const link = (rel: string, target: string) => ({ rel, target, evidence: [], confidence: 0.5, basis: 'unevidenced' as const, evidenceCount: 0, sources: [] })

const ONTOLOGY: Ontology = {
  version: 1,
  resourceTypes: { service: {}, datasource: {}, team: {}, api: {}, pod: {} },
  relationships: {
    depends_on: { from: ['service'], to: ['service', 'datasource'] },
    owned_by: { from: '*', to: ['team'] },
    exposes: { from: ['service'], to: ['api'] },
    uses: { from: '*', to: '*' },
    duplicate_of: { from: '*', to: '*' },
    contradicts: { from: '*', to: '*' },
  },
}

const of = (candidates: Candidate[], kind: Candidate['kind']) => candidates.filter((candidate) => candidate.kind === kind)

describe('fitting', () => {
  it('prefers relationships that name both types, and leaves out the ones enrichment writes by name', () => {
    expect(fitting(ONTOLOGY, 'service', 'datasource')).toEqual({ rels: ['depends_on'], specific: true })
    expect(fitting(ONTOLOGY, 'team', 'service')).toEqual({ rels: ['uses'], specific: false })
  })
})

describe('detect', () => {
  it('infers a link a description names, certain when one relationship names both types', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'service.checkout', type: 'service', title: 'Checkout', content: 'Charges the basket through the Ledger database.' }),
        resource({ id: 'datasource.ledger-db', type: 'datasource', title: 'Ledger database' }),
      ],
    })
    expect(of(candidates, 'link')).toEqual([
      expect.objectContaining({
        from: 'service.checkout',
        target: 'datasource.ledger-db',
        rels: ['depends_on'],
        certain: true,
        cited: [{ id: 'service.checkout', path: '.docket/resources/service/checkout.md', what: 'its description names Ledger database' }],
      }),
    ])
    expect(of(candidates, 'link')[0]?.reasoning).toMatch(/depends_on is the one relationship/)
  })

  it('reads attributes and [[id]] mentions too, and leaves pairs already linked either way', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'service.orders', type: 'service', title: 'Orders', attributes: { database: 'orders-db' }, links: [link('depends_on', 'service.payments')] }),
        resource({ id: 'service.payments', type: 'service', title: 'Payments', content: 'Called by [[service.orders]].', mentions: ['service.orders'] }),
        resource({ id: 'datasource.orders-db', type: 'datasource', title: 'Orders DB' }),
      ],
    })
    expect(of(candidates, 'link').map((candidate) => [candidate.from, candidate.target, candidate.cited[0]?.what])).toEqual([
      ['service.orders', 'datasource.orders-db', 'its attribute database names Orders DB'],
    ])
  })

  it('reads an id only as a whole id, not inside a longer one', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'service.checkout', type: 'service', title: 'Checkout', content: 'Writes to datasource.db-archive.' }),
        resource({ id: 'service.billing', type: 'service', title: 'Billing', content: 'Reads datasource.db.' }),
        resource({ id: 'datasource.db', type: 'datasource', title: 'DB' }),
      ],
    })
    expect(of(candidates, 'link').map((candidate) => [candidate.from, candidate.target])).toEqual([['service.billing', 'datasource.db']])
  })

  it('leaves a link open when only a relationship taking any type fits', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'team.commerce', type: 'team', title: 'Commerce', content: 'Runs the storefront.', links: [] }),
        resource({ id: 'api.storefront', type: 'api', title: 'Storefront', links: [link('owned_by', 'team.commerce')] }),
      ],
    })
    expect(of(candidates, 'link')).toEqual([])
    const open = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'team.commerce', type: 'team', title: 'Commerce', content: 'Runs the storefront.' }),
        resource({ id: 'api.storefront', type: 'api', title: 'Storefront' }),
      ],
    })
    expect(of(open, 'link')).toEqual([expect.objectContaining({ from: 'team.commerce', target: 'api.storefront', rels: ['uses'], certain: false })])
  })

  it('infers an owner from a name sibling, the neighbours and a team that names it, when they agree', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'service.orders', type: 'service', title: 'Orders', links: [link('owned_by', 'team.commerce'), link('exposes', 'api.orders')] }),
        resource({ id: 'api.orders', type: 'api', title: 'Orders API' }),
        resource({ id: 'pod.orders-7f9c', type: 'pod', title: 'orders-7f9c' }),
        resource({ id: 'team.commerce', type: 'team', title: 'Commerce', content: 'Owns the Orders API.' }),
        resource({ id: 'team.discovery', type: 'team', title: 'Discovery' }),
      ],
    })
    const owners = of(candidates, 'owner')
    expect(owners.map((candidate) => [candidate.from, candidate.target])).toEqual([
      ['api.orders', 'team.commerce'],
      ['pod.orders-7f9c', 'team.commerce'],
    ])
    expect(owners[0]?.reasoning).toMatch(/no owner/)
    expect(owners[0]?.cited.map((cited) => cited.id)).toEqual(['service.orders', 'team.commerce'])
  })

  it('leaves an owner only a team names to review: naming a resource is not owning it', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'api.search', type: 'api', title: 'Search API' }),
        resource({ id: 'team.data', type: 'team', title: 'Data', content: 'Reads the Search API nightly.' }),
      ],
    })
    expect(of(candidates, 'owner')).toEqual([expect.objectContaining({ from: 'api.search', target: 'team.data', certain: false })])
  })

  it('infers no owner when the hints disagree', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'datasource.shared-db', type: 'datasource', title: 'Shared database' }),
        resource({ id: 'service.a', type: 'service', title: 'Alpha', links: [link('depends_on', 'datasource.shared-db'), link('owned_by', 'team.one')] }),
        resource({ id: 'service.b', type: 'service', title: 'Bravo', links: [link('depends_on', 'datasource.shared-db'), link('owned_by', 'team.two')] }),
        resource({ id: 'team.one', type: 'team', title: 'One' }),
        resource({ id: 'team.two', type: 'team', title: 'Two' }),
      ],
    })
    expect(of(candidates, 'owner').map((candidate) => candidate.from)).not.toContain('datasource.shared-db')
  })

  it('finds duplicates by name, kept on the one with more behind it, and the attributes they disagree on', () => {
    const candidates = detect({
      ontology: ONTOLOGY,
      resources: [
        resource({ id: 'service.payments', type: 'service', title: 'Payments', attributes: { tier: 'critical' }, links: [link('owned_by', 'team.commerce')] }),
        resource({ id: 'service.payments-service', type: 'service', title: 'Payments', attributes: { tier: 'standard' }, links: [link('owned_by', 'team.commerce')], evidence: [] }),
        resource({ id: 'team.commerce', type: 'team', title: 'Commerce' }),
      ],
    })
    expect(of(candidates, 'duplicate')).toEqual([
      expect.objectContaining({ from: 'service.payments-service', target: 'service.payments', rels: ['duplicate_of'], certain: true }),
    ])
    expect(of(candidates, 'link')).toEqual([])
    const [contradiction] = of(candidates, 'contradiction')
    expect(contradiction).toEqual(expect.objectContaining({ from: 'service.payments-service', target: 'service.payments', rels: ['contradicts'] }))
    expect(contradiction?.reasoning).toContain('tier "standard"')
    expect(contradiction?.reasoning).toContain('tier "critical"')
  })

  it('writes duplicates and contradictions only where the ontology has the relationships', () => {
    const relationships = Object.fromEntries(Object.entries(ONTOLOGY.relationships).filter(([rel]) => rel !== 'duplicate_of' && rel !== 'contradicts'))
    const candidates = detect({
      ontology: { ...ONTOLOGY, relationships },
      resources: [
        resource({ id: 'service.payments', type: 'service', title: 'Payments', attributes: { tier: 'critical' } }),
        resource({ id: 'service.payments-service', type: 'service', title: 'Payments', attributes: { tier: 'standard' } }),
      ],
    })
    expect(of(candidates, 'duplicate')).toEqual([])
    expect(of(candidates, 'contradiction')).toEqual([])
  })

  it('makes a retired duplicate the same inference again once the other side has more behind it', () => {
    const pair = (heavier: string) => [
      resource({ id: 'service.payments', type: 'service', title: 'Payments', attributes: { tier: 'critical' } }),
      resource({ id: 'service.payments-service', type: 'service', title: 'Payments', attributes: { tier: 'standard' } }),
      resource({ id: 'team.commerce', type: 'team', title: 'Commerce' }),
    ].map((entry) => (entry.id === heavier ? { ...entry, links: [link('owned_by', 'team.commerce')] } : entry))
    const fingerprints = (heavier: string) =>
      detect({ ontology: ONTOLOGY, resources: pair(heavier) })
        .filter((candidate) => candidate.kind === 'duplicate' || candidate.kind === 'contradiction')
        .map((candidate) => [candidate.target, fingerprint(candidate)])
    const before = fingerprints('service.payments')
    const after = fingerprints('service.payments-service')
    expect(before.map(([kept]) => kept)).toEqual(['service.payments', 'service.payments'])
    expect(after.map(([kept]) => kept)).toEqual(['service.payments-service', 'service.payments-service'])
    expect(after.map(([, key]) => key)).toEqual(before.map(([, key]) => key))
  })

  it('fingerprints an inference by what it connects, whichever relationship it gets', () => {
    expect(fingerprint({ kind: 'link', from: 'team.commerce', target: 'api.storefront' })).toBe('link|api.storefront|team.commerce')
    expect(fingerprint({ kind: 'link', from: 'api.storefront', target: 'team.commerce' })).toBe('link|api.storefront|team.commerce')
    expect(fingerprint({ kind: 'owner', from: 'pod.p', target: 'team.t' })).toBe('owner|pod.p|team.t')
    expect(fingerprint({ kind: 'duplicate', from: 'service.payments', target: 'service.payments-service' })).toBe('duplicate|service.payments|service.payments-service')
    expect(fingerprint({ kind: 'duplicate', from: 'service.payments-service', target: 'service.payments' })).toBe('duplicate|service.payments|service.payments-service')
    expect(fingerprint({ kind: 'contradiction', from: 'service.payments-service', target: 'service.payments' })).toBe('contradiction|service.payments|service.payments-service')
  })
})
