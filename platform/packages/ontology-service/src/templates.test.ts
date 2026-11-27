// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ONTOLOGY_TEMPLATES } from '@chrisjowen/docket'
import { parseOntology } from '@docket/platform-canonical-store'
import { describe, expect, it } from 'vitest'

// @ts-expect-error the generator is plain JavaScript
import { DOCKET_TEMPLATES, LEAN_TYPES, buildTemplates, docketSource, sdlcSource } from '../scripts/templates.mjs'
import { TEMPLATES, TEMPLATE_IDS, template, type TemplateId } from './templates.js'

describe('starter templates', () => {
  it('are what the generator makes from docket’s default-sdlc.yaml, and SDLC is that file as it is', () => {
    const built = buildTemplates() as Record<string, string>
    expect(Object.keys(built).sort()).toEqual(TEMPLATE_IDS.map((id) => `${id}.yaml`).sort())
    for (const name of Object.keys(built)) {
      expect(readFileSync(join(import.meta.dirname, '..', 'templates', name), 'utf8')).toBe(built[name])
    }
    expect(template('sdlc').yaml).toBe(sdlcSource())
  })

  it('offer every template `docket init --template` does, each as docket ships it', () => {
    expect([...DOCKET_TEMPLATES, 'sdlc'].sort()).toEqual(Object.keys(ONTOLOGY_TEMPLATES).sort())
    for (const id of DOCKET_TEMPLATES as TemplateId[]) {
      expect(template(id).yaml, id).toBe(docketSource(id))
      expect(Object.keys(parseOntology(template(id).yaml).ontology?.resourceTypes ?? {}).length, id).toBeGreaterThan(0)
    }
  })

  it('each have a name and a one-line description', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([...TEMPLATE_IDS])
    for (const t of TEMPLATES) {
      expect(t.name.trim(), t.id).not.toBe('')
      expect(t.description, t.id).toMatch(/^[^\n]{10,140}$/)
    }
  })

  it('all load cleanly with docket’s loader', () => {
    for (const t of TEMPLATES) {
      const loaded = parseOntology(t.yaml)
      expect(loaded.diagnostics, t.id).toEqual([])
      expect(loaded.ontology?.sources).toHaveProperty('person')
      expect(loaded.ontology?.trust?.policies?.length).toBeGreaterThan(0)
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

  it('blank has no types and the default sources and policies', () => {
    const blank = parseOntology(template('blank').yaml).ontology
    const sdlc = parseOntology(template('sdlc').yaml).ontology
    expect(blank?.resourceTypes).toEqual({})
    expect(blank?.relationships).toEqual({})
    expect(blank?.sources).toEqual(sdlc?.sources)
    expect(blank?.trust?.policies?.filter((policy) => !policy.when.about)).toEqual(sdlc?.trust?.policies?.filter((policy) => !policy.when.about))
  })
})
