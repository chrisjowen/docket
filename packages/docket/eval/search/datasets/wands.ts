import { readFile } from 'node:fs/promises'

import { evidenceFor, hash32, random, sample, slug, type Corpus, type CorpusEntity, type EvalQuery } from '../corpus.js'
import { absentNames, dataFile, whoIsQuery, type QueryBudget } from './common.js'

/*
 * WANDS, the Wayfair ANnotation DataSet (Chen et al., ECIR 2022), as a
 * product catalogue: each product with its description and features, in the
 * category tree its hierarchy names. A query's relevant products are the
 * ones annotated Exact (grade 2) or Partial (grade 1); precision, recall and
 * MRR count only Exact, nDCG credits both.
 *
 * The full catalogue is 42,994 products, so each answerable query brings a
 * sample of its annotated products - Exact, Partial and the hard negatives
 * annotated Irrelevant - and random products fill the rest. Unannotated
 * pairs count as not relevant, as in any qrels.
 *
 * No-answer queries are for kinds of product the catalogue does not carry:
 * every product of the query's class, and every product annotated Exact or
 * Partial for it, is left out.
 */

const PER_QUERY = { Exact: 25, Partial: 10, Irrelevant: 10 } as const
const DISTRACTORS = 1500

const EVIDENCE = (id: string) => [
  { source: 'catalogue_feed', key: `wands:${id}` },
  { source: 'storefront', urls: [`https://example.com/products/${id}`] },
  { source: 'supplier_sheet', path: `suppliers/${id}.pdf` },
  { source: 'reviews', urls: [`https://example.com/products/${id}#reviews`] }
]

const tsv = async (file: string): Promise<string[][]> =>
  (await readFile(dataFile(file), 'utf8'))
    .split('\n')
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

/** The first features, as "name: value", skipping yes/no flags. */
const features = (raw: string): string =>
  [
    ...new Set(
      raw
        .split('|')
        .map((pair) => pair.split(':').map((part) => part.trim()))
        .filter(([name, value]) => name && value && !/^(yes|no)$/.test(value))
        .map(([name, value]) => `${name}: ${value}`)
    )
  ]
    .slice(0, 12)
    .join('; ')

export const loadWands = async (budget: QueryBudget): Promise<Corpus> => {
  const products = new Map((await tsv('wands-product.csv')).map((row) => [row[0] as string, row]))
  const queries = (await tsv('wands-query.csv')).map(([id, text, cls]) => ({ id: id as string, text: text as string, cls: (cls ?? '').trim() }))
  const labels = new Map<string, Map<string, string>>()
  for (const [, query, product, label] of await tsv('wands-label.csv')) {
    const byProduct = labels.get(query as string) ?? new Map<string, string>()
    byProduct.set(product as string, (label as string).trim())
    labels.set(query as string, byProduct)
  }
  const classOf = (product: string): string => (products.get(product)?.[2] ?? '').trim()
  const relevantTo = (query: string): string[] =>
    [...(labels.get(query) ?? [])].filter(([, label]) => label === 'Exact' || label === 'Partial').map(([product]) => product)

  const next = random(hash32('wands'))
  const heldOut: typeof queries = []
  const heldClasses = new Set<string>()
  for (const query of sample(queries.filter((query) => query.cls), queries.length, next)) {
    if (heldOut.length >= budget.noAnswer - 1) break
    if (heldClasses.has(query.cls)) continue
    heldOut.push(query)
    heldClasses.add(query.cls)
  }
  const excluded = new Set(heldOut.flatMap((query) => relevantTo(query.id)))
  for (const [id] of products) if (heldClasses.has(classOf(id))) excluded.add(id)

  const eligible = queries.filter(
    (query) => !heldOut.includes(query) && [...(labels.get(query.id) ?? [])].filter(([product, label]) => label === 'Exact' && !excluded.has(product)).length >= 3
  )
  const answerable = sample(eligible, budget.answerable, next)
  const included = new Set<string>()
  for (const query of answerable) {
    const byLabel = (wanted: string) => [...(labels.get(query.id) ?? [])].filter(([product, label]) => label === wanted && !excluded.has(product)).map(([product]) => product)
    for (const [label, count] of Object.entries(PER_QUERY)) for (const product of sample(byLabel(label), count, next)) included.add(product)
  }
  for (const product of sample([...products.keys()].filter((id) => !excluded.has(id) && !included.has(id)), DISTRACTORS, next)) included.add(product)

  const entities: CorpusEntity[] = []
  const categories = new Map<string, CorpusEntity>()
  const categoryOf = (path: string[]): string => {
    const id = `category.${slug(path.join(' '), 100)}`
    if (!categories.has(id)) {
      const parent = path.length > 1 ? categoryOf(path.slice(0, -1)) : undefined
      categories.set(id, {
        id,
        type: 'category',
        title: path.at(-1) as string,
        body: path.length > 1 ? `${path.at(-1)}, under ${path.slice(0, -1).join(' / ')}.` : `${path[0]}: a top-level department.`,
        ...(parent ? { links: [{ rel: 'subcategory_of', target: parent }] } : {}),
        evidence: [{ source: 'catalogue_feed', key: `category:${path.join('/')}` }]
      })
    }
    return id
  }
  for (const id of [...included].sort((a, b) => Number(a) - Number(b))) {
    const [, name, cls, hierarchy, description, featureList, , rating, reviews] = products.get(id) as string[]
    const path = (hierarchy ?? '').split('/').map((part) => part.trim()).filter(Boolean)
    const rated = Number(rating)
    const reviewed = Number(reviews)
    entities.push({
      id: `product.w${id}`,
      type: 'product',
      title: (name ?? '').trim() || `Product ${id}`,
      body: [(description ?? '').trim().slice(0, 1200), features(featureList ?? '') ? `Features: ${features(featureList ?? '')}.` : ''].filter(Boolean).join('\n\n'),
      ...(cls?.trim() ? { tags: [cls.trim()] } : {}),
      attributes: {
        sku: `W${id}`,
        ...(Number.isFinite(rated) && rating ? { rating: rated } : {}),
        ...(Number.isFinite(reviewed) && reviews ? { reviewCount: reviewed } : {})
      },
      ...(path.length > 0 ? { links: [{ rel: 'in_category', target: categoryOf(path) }] } : {}),
      evidence: evidenceFor(`product.w${id}`, EVIDENCE(id))
    })
  }
  entities.push(...categories.values())

  const evalQueries: EvalQuery[] = [
    ...answerable.map((query) => ({
      id: `q${query.id}`,
      text: query.text,
      kind: 'answerable' as const,
      category: 'product-search',
      relevant: Object.fromEntries(
        [...(labels.get(query.id) ?? [])]
          .filter(([product, label]) => included.has(product) && (label === 'Exact' || label === 'Partial'))
          .map(([product, label]) => [`product.w${product}`, label === 'Exact' ? 2 : 1])
      ),
      minGrade: 2
    })),
    whoIsQuery(absentNames(entities)[0] as string),
    ...heldOut.map((query) => ({ id: `q${query.id}-not-carried`, text: query.text, kind: 'no-answer' as const, category: 'not-carried', relevant: {} }))
  ]

  return {
    name: 'wands',
    domain: 'product catalogue',
    source: `WANDS (wayfair/WANDS, MIT): ${included.size} of 42,994 products`,
    template: 'product-catalogue',
    entities,
    queries: evalQueries
  }
}
