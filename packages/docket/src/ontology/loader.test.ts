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

  it('warns about a confidence rule for a source that is not registered', async () => {
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

    expect(ontology?.resourceTypes.pod?.confidence).toEqual({ code: 0.3, kubectl: 0.9 })
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'unknown-evidence-source',
        message: expect.stringContaining('resourceTypes.pod.confidence names source "kubectl"')
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
