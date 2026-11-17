import { describe, expect, it } from 'vitest'

import { readFixture } from '../../test/fixture.js'
import { MAX_ONTOLOGY_BYTES, exportYaml, importYaml, stripHeader } from './yaml-io.js'

const hash = `sha256:${'a'.repeat(64)}`

describe('YAML import and export', () => {
  it('exports exactly the imported file, after the header comment', async () => {
    const { ontology } = await readFixture()
    const imported = importYaml(ontology)
    expect(imported.ontology).not.toBeNull()
    expect(imported.diagnostics).toEqual([])
    const exported = exportYaml({ org: 'acme', workspace: 'platform', number: 14, hash, yaml: imported.yaml })
    expect(exported).toBe(`# docket-cloud: acme/platform ontology v14 (${hash})\n${ontology}`)
    // Re-importing an export does not stack headers.
    expect(importYaml(exported).yaml).toBe(ontology)
    expect(stripHeader(exported)).toBe(ontology)
  })

  it('reports YAML and schema errors with their paths', () => {
    expect(importYaml('version: 1\nresourceTypes: [\n').diagnostics).toEqual([
      expect.objectContaining({ code: 'ontology-parse-error', severity: 'error' })
    ])
    expect(importYaml('version: 1\nrelationships:\n  uses:\n    from: [a]\n').diagnostics).toEqual([
      expect.objectContaining({ code: 'ontology-invalid', message: expect.stringMatching(/^relationships\.uses\.to: /) })
    ])
  })

  it('warns about a relationship end that names no type, and an icon docket does not bundle', () => {
    const { diagnostics } = importYaml(
      'version: 1\nresourceTypes:\n  service:\n    icon: rocket-ship\nrelationships:\n  uses:\n    from: [service]\n    to: [libary]\n'
    )
    expect(diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'unknown-icon'],
      ['warning', 'unknown-constraint-type']
    ])
  })

  it('refuses a text larger than an ontology may be, without parsing it', () => {
    const imported = importYaml(`# ${'x'.repeat(MAX_ONTOLOGY_BYTES)}\nversion: 1\n`)
    expect(imported.ontology).toBeNull()
    expect(imported.diagnostics).toEqual([expect.objectContaining({ code: 'ontology-too-large', severity: 'error' })])
  })
})
