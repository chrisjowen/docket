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
