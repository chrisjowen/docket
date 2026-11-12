import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { ONTOLOGY_TEMPLATES } from '../config/defaults.js'
import { ontologySchema } from '../model/ontology.js'
import { isIconName } from './icons.js'

const load = async (name: string) => ontologySchema.parse(parse(await readFile(ONTOLOGY_TEMPLATES[name] as string, 'utf8')))

describe('ontology templates', () => {
  it('offers SDLC and the other common domains', () => {
    expect(Object.keys(ONTOLOGY_TEMPLATES)).toEqual(['sdlc', 'people-org', 'crm', 'research', 'personal-knowledge', 'product-catalogue'])
  })

  for (const name of Object.keys(ONTOLOGY_TEMPLATES)) {
    describe(name, () => {
      it('gives every resource type a description and a bundled icon', async () => {
        const ontology = await load(name)
        expect(Object.keys(ontology.resourceTypes).length).toBeGreaterThan(0)
        for (const [type, definition] of Object.entries(ontology.resourceTypes)) {
          expect(definition.description, type).toBeTruthy()
          expect(definition.icon && isIconName(definition.icon), type).toBe(true)
        }
      })

      it('relates only the types it defines', async () => {
        const ontology = await load(name)
        const types = new Set(Object.keys(ontology.resourceTypes))
        for (const [rel, definition] of Object.entries(ontology.relationships)) {
          for (const end of [definition.from, definition.to]) {
            if (end === '*') continue
            for (const type of end) expect(types.has(type), `${rel}: ${type}`).toBe(true)
          }
        }
      })

      it('scores the human and conversation sources every template shares', async () => {
        const sources = (await load(name)).evidence?.sources ?? {}
        expect(sources.human?.confidence).toBe(0.9)
        expect(sources.conversation?.confidence).toBe(0.7)
      })
    })
  }
})
