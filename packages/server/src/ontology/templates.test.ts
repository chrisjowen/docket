import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// @ts-expect-error the generator is plain JavaScript
import { LEAN_TYPES, sdlcSource, templateModule } from '../../scripts/templates.mjs'
import { parseOntology } from '../docket.js'
import { TEMPLATES, isTemplateId, template } from './templates.js'

describe('starter templates', () => {
  it('are what the generator makes from docket’s default-sdlc.yaml, and SDLC is that file as it is', () => {
    expect(readFileSync(new URL('./template-texts.ts', import.meta.url), 'utf8')).toBe(templateModule())
    expect(template('sdlc').yaml).toBe(sdlcSource())
  })

  it('all load cleanly with docket’s loader', () => {
    for (const t of TEMPLATES) {
      const loaded = parseOntology(t.yaml)
      expect(loaded.diagnostics, t.id).toEqual([])
      expect(loaded.ontology?.evidence?.sources).toHaveProperty('human')
    }
  })

  it('the lean catalogue has its seven types, and only relationships between them', () => {
    const lean = parseOntology(template('lean-catalogue').yaml).ontology
    expect(Object.keys(lean?.resourceTypes ?? {}).sort()).toEqual([...LEAN_TYPES].sort())
    for (const [name, rel] of Object.entries(lean?.relationships ?? {})) {
      for (const end of [rel.from, rel.to]) {
        if (end !== '*') expect(end.every((type) => LEAN_TYPES.includes(type)), name).toBe(true)
      }
    }
    const sdlc = parseOntology(template('sdlc').yaml).ontology
    expect(lean?.resourceTypes.service).toEqual(sdlc?.resourceTypes.service)
    expect(Object.keys(sdlc?.resourceTypes ?? {}).length).toBeGreaterThan(40)
  })

  it('blank has no types and the default evidence sources', () => {
    const blank = parseOntology(template('blank').yaml).ontology
    const sdlc = parseOntology(template('sdlc').yaml).ontology
    expect(blank?.resourceTypes).toEqual({})
    expect(blank?.relationships).toEqual({})
    expect(blank?.evidence).toEqual(sdlc?.evidence)
  })

  it('are looked up by id', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['sdlc', 'lean-catalogue', 'blank'])
    expect(isTemplateId('blank')).toBe(true)
    expect(isTemplateId('crm')).toBe(false)
    expect(() => template('crm' as 'blank')).toThrow('no template crm')
  })
})
