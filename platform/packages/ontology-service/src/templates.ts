// SPDX-License-Identifier: AGPL-3.0-only
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./yaml.d.ts" />
import blank from '../templates/blank.yaml?raw'
import crm from '../templates/crm.yaml?raw'
import lean from '../templates/lean-catalogue.yaml?raw'
import peopleOrg from '../templates/people-org.yaml?raw'
import personalKnowledge from '../templates/personal-knowledge.yaml?raw'
import productCatalogue from '../templates/product-catalogue.yaml?raw'
import research from '../templates/research.yaml?raw'
import sdlc from '../templates/sdlc.yaml?raw'

/** A starter ontology in the platform catalogue (§13.3). */
export interface Template {
  id: TemplateId
  name: string
  description: string
  yaml: string
}

export const TEMPLATE_IDS = [
  'sdlc',
  'lean-catalogue',
  'people-org',
  'crm',
  'research',
  'personal-knowledge',
  'product-catalogue',
  'blank',
] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export const TEMPLATES: readonly Template[] = [
  {
    id: 'sdlc',
    name: 'Software delivery (SDLC)',
    description: "docket's default ontology: code and delivery, runtime and infrastructure, operations, security, knowledge and planning.",
    yaml: sdlc,
  },
  {
    id: 'lean-catalogue',
    name: 'Lean service catalogue',
    description: 'Services, teams, datasources, APIs, decisions, constraints and environments: the most-used part of SDLC.',
    yaml: lean,
  },
  {
    id: 'people-org',
    name: 'People and organisations',
    description: 'People, the organisations and teams they belong to, their roles, locations and skills: a directory or org chart.',
    yaml: peopleOrg,
  },
  {
    id: 'crm',
    name: 'Customer relationships (CRM)',
    description: 'Accounts, contacts, leads, deals, support cases, products, contracts and campaigns, and the reps who own them.',
    yaml: crm,
  },
  {
    id: 'research',
    name: 'Research and literature',
    description: 'Papers, their authors, institutions and venues, the datasets and methods they use, and the claims they make.',
    yaml: research,
  },
  {
    id: 'personal-knowledge',
    name: 'Personal knowledge',
    description: "What an assistant remembers about someone's life: people, conversations, events, notes, places, interests and goals.",
    yaml: personalKnowledge,
  },
  {
    id: 'product-catalogue',
    name: 'Product catalogue',
    description: 'What a business sells: products and variants, categories, brands, collections and suppliers.',
    yaml: productCatalogue,
  },
  {
    id: 'blank',
    name: 'Blank',
    description: "No types yet, and docket's default evidence sources. Build your own.",
    yaml: blank,
  },
]

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value)
}

export function template(id: TemplateId): Template {
  const found = TEMPLATES.find((t) => t.id === id)
  if (!found) throw new Error(`no template ${id}`)
  return found
}
