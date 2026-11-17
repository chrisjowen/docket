import { BLANK_YAML, LEAN_CATALOGUE_YAML, SDLC_YAML } from './template-texts.js'

/** A starter ontology a new workspace can begin from. */
export interface Template {
  id: TemplateId
  name: string
  description: string
  yaml: string
}

export const TEMPLATE_IDS = ['sdlc', 'lean-catalogue', 'blank'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export const TEMPLATES: readonly Template[] = [
  {
    id: 'sdlc',
    name: 'Software delivery (SDLC)',
    description: "docket's default ontology: code and delivery, runtime and infrastructure, operations, security, knowledge and planning.",
    yaml: SDLC_YAML
  },
  {
    id: 'lean-catalogue',
    name: 'Lean service catalogue',
    description: 'Services, teams, datasources, APIs, decisions, constraints and environments: the most-used part of SDLC.',
    yaml: LEAN_CATALOGUE_YAML
  },
  {
    id: 'blank',
    name: 'Blank',
    description: "No types yet, and docket's default evidence sources. Build your own.",
    yaml: BLANK_YAML
  }
]

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value)
}

export function template(id: TemplateId): Template {
  const found = TEMPLATES.find((t) => t.id === id)
  if (!found) throw new Error(`no template ${id}`)
  return found
}
