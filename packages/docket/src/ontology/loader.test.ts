import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { type ResolvedConfig, memoryConfigSchema } from '../config/config.js'
import { loadOntology } from './loader.js'

const resolvedFor = async (contents?: string): Promise<ResolvedConfig> => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'docket-'))
  const ontologyPath = join(projectRoot, 'entities.yaml')
  if (contents !== undefined) await writeFile(ontologyPath, contents, 'utf8')
  return {
    config: memoryConfigSchema.parse({ version: 1 }),
    projectRoot,
    memoryRoot: projectRoot,
    ontologyPath
  }
}

describe('loadOntology', () => {
  it('loads a valid ontology', async () => {
    const { ontology, diagnostics } = await loadOntology(
      await resolvedFor(
        [
          'version: 1',
          'resourceTypes:',
          '  service:',
          '    attributes:',
          '      language:',
          '        type: string',
          'relationships:',
          '  uses:',
          '    from: "*"',
          '    to: "*"'
        ].join('\n')
      )
    )

    expect(diagnostics).toEqual([])
    expect(ontology?.resourceTypes.service?.attributes?.language?.type).toBe(
      'string'
    )
    expect(ontology?.relationships.uses?.from).toBe('*')
  })

  it('reads legacy confidence rules as policies, and warns about the legacy form and an unregistered source', async () => {
    const { ontology, diagnostics } = await loadOntology(
      await resolvedFor(
        [
          'version: 1',
          'resourceTypes:',
          '  pod:',
          '    confidence:',
          '      code: 0.3',
          '      kubectl: 0.9',
          'relationships: {}'
        ].join('\n')
      )
    )

    expect(ontology?.resourceTypes.pod?.confidence).toBeUndefined()
    expect(ontology?.trust?.policies).toEqual(
      expect.arrayContaining([
        { name: 'code evidence of pod', when: { about: 'pod', source: 'code' }, score: 0.3 },
        { name: 'kubectl evidence of pod', when: { about: 'pod', source: 'kubectl' }, score: 0.9 }
      ])
    )
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'legacy-evidence-settings' }),
      expect.objectContaining({
        severity: 'warning',
        code: 'unknown-evidence-source',
        message: expect.stringContaining('trust.policies "kubectl evidence of pod" names source "kubectl"')
      })
    ])
  })

  it('accepts an icon per resource type and warns about one docket does not bundle', async () => {
    const { ontology, diagnostics } = await loadOntology(
      await resolvedFor(
        [
          'version: 1',
          'resourceTypes:',
          '  service:',
          '    icon: server',
          '  ledger:',
          '    icon: piggy-bank',
          'relationships: {}'
        ].join('\n')
      )
    )

    expect(ontology?.resourceTypes.service?.icon).toBe('server')
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'unknown-icon',
        message: expect.stringContaining('resourceTypes.ledger.icon "piggy-bank"')
      })
    ])
  })

  it('rejects an icon that is not a kebab-case name', async () => {
    const { ontology, diagnostics } = await loadOntology(
      await resolvedFor(['version: 1', 'resourceTypes:', '  service:', '    icon: Server Rack', 'relationships: {}'].join('\n'))
    )
    expect(ontology).toBeNull()
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'ontology-invalid', message: expect.stringContaining('resourceTypes.service.icon') })
    ])
  })

  it('rejects a confidence outside 0 to 1 and a location field evidence does not have', async () => {
    const { ontology, diagnostics } = await loadOntology(
      await resolvedFor(
        [
          'version: 1',
          'evidence:',
          '  sources:',
          '    ticket:',
          '      confidence: 1.5',
          '      requires: [ticketId]',
          'resourceTypes: {}',
          'relationships: {}'
        ].join('\n')
      )
    )
    expect(ontology).toBeNull()
    expect(diagnostics.map((d) => d.code)).toEqual(['ontology-invalid', 'ontology-invalid'])
  })

  it('reports a missing ontology file instead of throwing', async () => {
    const { ontology, diagnostics } = await loadOntology(await resolvedFor())
    expect(ontology).toBeNull()
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'ontology-missing'
    })
  })

  it('reports invalid YAML', async () => {
    const { ontology, diagnostics } = await loadOntology(
      await resolvedFor('version: [1\n')
    )
    expect(ontology).toBeNull()
    expect(diagnostics[0]?.code).toBe('ontology-parse-error')
  })

  it('reports schema violations', async () => {
    const { ontology, diagnostics } = await loadOntology(
      await resolvedFor(
        ['version: 1', 'resourceTypes:', '  service:', '    attributes:', '      language:', '        type: date'].join(
          '\n'
        )
      )
    )
    expect(ontology).toBeNull()
    expect(diagnostics[0]?.code).toBe('ontology-invalid')
  })
})

describe('loadOntology: sources and policies', () => {
  const load = async (lines: string[]) => loadOntology(await resolvedFor(['version: 1', 'resourceTypes:', '  repository: {}', 'relationships: {}', ...lines].join('\n')))

  it('loads sources and policies without a diagnostic, and nothing of docket\'s built-in sources', async () => {
    const { ontology, diagnostics } = await load([
      'sources:',
      '  github:',
      '    kind: system',
      '    identifiedBy: [repo]',
      '    attributes:',
      '      branch_protected: { type: boolean, setBy: connection }',
      '    locator:',
      '      repo: { required: true }',
      'trust:',
      '  policies:',
      '    - name: Repository found in GitHub',
      '      when: { about: repository, source: github }',
      '      score: 0.9',
      '    - name: Protected branch',
      '      when: { source: github, branch_protected: true }',
      '      adjust: 0.05'
    ])
    expect(diagnostics).toEqual([])
    expect(Object.keys(ontology?.sources ?? {})).toEqual(['github'])
    expect(ontology?.trust?.policies).toHaveLength(2)
  })

  it('rejects a policy that gives both a score and an adjustment, or neither', async () => {
    for (const effect of [['      score: 0.9', '      adjust: 0.1'], []]) {
      const { ontology, diagnostics } = await load([
        'sources:',
        '  github: {}',
        'trust:',
        '  policies:',
        '    - name: Odd',
        '      when: { source: github }',
        ...effect
      ])
      expect(ontology).toBeNull()
      expect(diagnostics[0]).toMatchObject({ code: 'ontology-invalid', message: expect.stringContaining('either score or adjust') })
    }
  })

  it('warns about a policy that can never apply as written, and about two that tie', async () => {
    const { diagnostics } = await load([
      'sources:',
      '  github:',
      '    identifiedBy: [repo, org]',
      '    attributes:',
      '      visibility: { type: string, enum: [public, private], setBy: connection }',
      '    locator:',
      '      repo: {}',
      'trust:',
      '  policies:',
      '    - name: From GitLab',
      '      when: { source: gitlab }',
      '      score: 0.8',
      '    - name: About a widget',
      '      when: { about: widget, source: github }',
      '      score: 0.8',
      '    - name: Starred',
      '      when: { source: github, stars: { gt: 100 }, "@branch": main }',
      '      adjust: 0.1',
      '    - name: Public',
      '      when: { source: github, visibility: public }',
      '      score: 0.7',
      '    - name: Public',
      '      when: { visibility: public, source: github }',
      '      score: 0.6'
    ])
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['unknown-locator-field', expect.stringContaining('sources.github.identifiedBy names "org"')],
      ['unknown-evidence-source', expect.stringContaining('"From GitLab" names source "gitlab"')],
      ['unknown-policy-subject', expect.stringContaining('"About a widget" is about "widget"')],
      ['unknown-policy-condition', expect.stringContaining('"Starred" tests "stars", which is not an attribute')],
      ['unknown-policy-condition', expect.stringContaining('"Starred" tests "@branch", which is not a locator field')],
      ['duplicate-policy-name', expect.stringContaining('"Public"')],
      ['tied-policies', expect.stringContaining('the lower, 0.6, wins')]
    ])
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true)
  })

  it('warns about the legacy evidence form, which it reads as sources and policies', async () => {
    const { ontology, diagnostics } = await load(['evidence:', '  unevidenced: 0.3', '  sources:', '    ledger: { confidence: 0.8 }'])
    expect(diagnostics.map((d) => d.code)).toEqual(['legacy-evidence-settings'])
    expect(ontology?.evidence).toBeUndefined()
    expect(ontology?.sources).toEqual({ ledger: {} })
    expect(ontology?.trust).toEqual({
      unevidenced: 0.3,
      fallback: 0.3,
      cap: 1,
      policies: [{ name: 'ledger evidence', when: { source: 'ledger' }, score: 0.8 }]
    })
  })
})
