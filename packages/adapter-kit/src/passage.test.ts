import { describe, expect, it } from 'vitest'

import type { DocumentInput, ObservationInput } from '@docket/contracts'

import { canonicalPassage } from './passage.js'
import { entityInput, entityLink } from './testing.js'

describe('canonical passages', () => {
  it('render an entity as title, kind, body, links and tags, referencing its file at its revision', () => {
    const passage = canonicalPassage(
      entityInput({
        id: 'service.orders',
        title: 'Orders',
        revision: 'sha256:1',
        path: '.docket/resources/services/orders.md',
        content: 'Takes orders.\n',
        links: [entityLink({ rel: 'depends_on', target: 'datasource.orders-db' })],
        tags: ['payments']
      })
    )
    expect(passage).toEqual({
      ref: {
        kind: 'entity',
        id: 'service.orders',
        revision: 'sha256:1',
        span: { path: '.docket/resources/services/orders.md' }
      },
      title: 'Orders',
      text: '# Orders\nservice service.orders\n\nTakes orders.\n\nLinks:\n- depends_on datasource.orders-db\n\nTags: payments\n'
    })
  })

  it('keep an observation verbatim with the times it states, and no event time it does not', () => {
    const observation: ObservationInput = {
      kind: 'observation',
      id: 'obs.deploy-1',
      revision: 'r1',
      scope: 'default',
      text: 'Deployed orders 1.4 to production.\nRolled back an hour later.',
      sources: [{ path: 'logs/deploys.md', startLine: 3, endLine: 4 }],
      entityRefs: ['service.orders'],
      observedAt: '2026-10-01T09:00:00Z'
    }
    expect(canonicalPassage(observation)).toEqual({
      ref: { kind: 'observation', id: 'obs.deploy-1', revision: 'r1', span: { path: 'logs/deploys.md', startLine: 3, endLine: 4 } },
      title: 'Deployed orders 1.4 to production.',
      text: observation.text,
      observedAt: '2026-10-01T09:00:00Z'
    })
    expect(canonicalPassage({ ...observation, eventAt: '2026-09-30T17:00:00Z' }).eventAt).toBe('2026-09-30T17:00:00Z')
  })

  it('keep a document verbatim, spanned to its source', () => {
    const document: DocumentInput = {
      kind: 'document',
      id: 'doc.adr-7',
      revision: 'r2',
      scope: 'default',
      text: '\n\nWe chose Postgres.',
      source: { path: 'docs/adr/7.md', startLine: 1, endLine: 3 },
      entityRefs: []
    }
    const passage = canonicalPassage(document)
    expect(passage.text).toBe(document.text)
    expect(passage.title).toBe('We chose Postgres.')
    expect(passage.ref.span).toEqual(document.source)
  })
})
