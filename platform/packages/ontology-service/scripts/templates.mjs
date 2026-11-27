// SPDX-License-Identifier: AGPL-3.0-only
// Builds the starter ontologies (§13.3) from the ones docket ships for
// `docket init --template`: each of docket's templates is its file as it is,
// and the lean catalogue and blank templates are cut from default-sdlc.yaml,
// so all of them move with docket.
//
//   node scripts/templates.mjs          writes templates/*.yaml
//   node scripts/templates.mjs --check  fails if they are out of date
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ONTOLOGY_TEMPLATES } from '@chrisjowen/docket'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, '..', 'templates')

/** The types of the lean service catalogue: the most-used subset of SDLC. */
export const LEAN_TYPES = ['service', 'team', 'datasource', 'api', 'decision', 'constraint', 'environment']

/** The domain templates docket ships beside SDLC, copied as they are. */
export const DOCKET_TEMPLATES = ['people-org', 'crm', 'research', 'personal-knowledge', 'product-catalogue']

/** The yaml of one of docket's `docket init --template` ontologies. */
export function docketSource(name) {
  const path = ONTOLOGY_TEMPLATES[name]
  if (!path) throw new Error(`@chrisjowen/docket has no ${name} template`)
  return readFileSync(path, 'utf8')
}

export function sdlcSource() {
  return docketSource('sdlc')
}

/** Keeps the lean types and every relationship whose ends still name one; `*` stays `*`. */
function lean(sdlc) {
  const doc = parseDocument(sdlc)
  doc.commentBefore = [
    ' Lean service catalogue: the most-used part of docket\'s SDLC ontology -',
    ` ${LEAN_TYPES.join(', ')} - and the`,
    ' relationships between them, with the SDLC sources and trust policies. Generated from',
    ' docket\'s default-sdlc.yaml by docket-cloud (packages/ontology-service/scripts/templates.mjs).',
  ].join('\n')
  const types = doc.get('resourceTypes')
  for (const pair of [...types.items]) {
    if (!LEAN_TYPES.includes(String(pair.key.value ?? pair.key))) types.delete(pair.key)
  }
  const relationships = doc.get('relationships')
  for (const pair of [...relationships.items]) {
    const definition = pair.value
    let empty = false
    for (const end of ['from', 'to']) {
      const node = definition.get(end, true)
      if (isScalar(node) && node.value === '*') continue
      if (!isSeq(node)) continue
      node.items = node.items.filter((item) => LEAN_TYPES.includes(String(isScalar(item) ? item.value : item)))
      if (node.items.length === 0) empty = true
    }
    if (empty) relationships.delete(pair.key)
  }
  const kept = new Set([...types.items, ...relationships.items].map((pair) => String(pair.key.value ?? pair.key)))
  keepPolicies(doc, (about) => kept.has(about))
  return strip(doc).toString()
}

/** Drops the trust policies about a type or relationship the template no longer has. */
function keepPolicies(doc, keep) {
  const policies = doc.getIn(['trust', 'policies'])
  if (!isSeq(policies)) return
  policies.items = policies.items.filter((policy) => {
    const about = isMap(policy) ? policy.getIn(['when', 'about']) : undefined
    return about === undefined || keep(String(about))
  })
}

/** No types and no relationships: only SDLC's sources and trust policies. */
function blank(sdlc) {
  const doc = parseDocument(sdlc)
  doc.commentBefore = [
    ' Blank: no resource types or relationships yet, and docket\'s default sources',
    ' and trust policies. Generated from docket\'s default-sdlc.yaml by docket-cloud',
    ' (packages/ontology-service/scripts/templates.mjs).',
  ].join('\n')
  doc.set('resourceTypes', doc.createNode({}))
  doc.set('relationships', doc.createNode({}))
  keepPolicies(doc, () => false)
  return strip(doc).toString()
}

/** Drops the section banners that describe types the template no longer has. */
function strip(doc) {
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const key = pair.key
      if (isScalar(key) && (key.value === 'resourceTypes' || key.value === 'relationships')) {
        key.commentBefore = undefined
        if (isMap(pair.value)) for (const item of pair.value.items) if (isScalar(item.key)) item.key.commentBefore = undefined
      }
    }
  }
  return doc
}

export function buildTemplates(sdlc = sdlcSource()) {
  const built = { 'sdlc.yaml': sdlc, 'lean-catalogue.yaml': lean(sdlc), 'blank.yaml': blank(sdlc) }
  for (const name of DOCKET_TEMPLATES) built[`${name}.yaml`] = docketSource(name)
  return built
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  let stale = false
  for (const [name, text] of Object.entries(buildTemplates())) {
    const path = join(templatesDir, name)
    let current = null
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      // missing: written below
    }
    if (current === text) continue
    if (check) {
      console.error(`templates/${name} is out of date: run node scripts/templates.mjs`)
      stale = true
    } else {
      writeFileSync(path, text)
      console.log(`wrote templates/${name}`)
    }
  }
  if (stale) process.exit(1)
}
