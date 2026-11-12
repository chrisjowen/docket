import { evidenceFor, hash32, random, sample, slug, type Corpus, type CorpusEntity, type EvalQuery } from '../corpus.js'
import { CANDIDATE_ABSENT_NAMES, absentNames, whoIsQuery, type QueryBudget } from './common.js'

/*
 * A CRM, generated: no public CRM dataset ships its records with questions
 * about them (CRMArena's live in a Salesforce org), so this one is built from
 * a fixed seed - accounts, their contacts, the reps who own them, products,
 * deals, cases, activities, contracts, campaigns and leads - and the queries
 * are generated from the same records, so every relevant id is known exactly.
 * Nothing is downloaded and the same seed gives the same corpus.
 *
 * No-answer queries name people, companies and products that do not exist -
 * some wholly absent ("who is sophia"), some a near miss that shares a
 * surname or a company prefix with a real record.
 */

const FIRST = ['Amara', 'Ben', 'Carys', 'Dmitri', 'Elena', 'Farid', 'Grace', 'Hugo', 'Isla', 'Jonah', 'Keiko', 'Liam', 'Maya', 'Nikhil', 'Olivia', 'Pavel', 'Quinn', 'Rosa', 'Samir', 'Tara', 'Umar', 'Vera', 'Wes', 'Yara', 'Zane', 'Ada', 'Bruno', 'Chloe', 'Diego', 'Esme', 'Felix', 'Gemma', 'Hamid', 'Iris', 'Jasper', 'Kofi', 'Lena', 'Marco', 'Nadia', 'Oscar']
const LAST = ['Abara', 'Brennan', 'Castillo', 'Dubois', 'Eriksen', 'Fischer', 'Gallagher', 'Haddad', 'Ivanova', 'Jensen', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura', 'Okafor', 'Petrov', 'Quintero', 'Rossi', 'Schmidt', 'Tanaka', 'Underwood', 'Varga', 'Whitfield', 'Xu', 'Yilmaz', 'Zimmermann', 'Achebe', 'Bianchi', 'Costa', 'Dlamini']
const PREFIX = ['Northwind', 'Bluefin', 'Granite', 'Halcyon', 'Ironbark', 'Juniper', 'Kestrel', 'Lumen', 'Meridian', 'Nimbus', 'Orchard', 'Pinnacle', 'Quarry', 'Redwood', 'Saffron', 'Tidewater', 'Umberline', 'Vantage', 'Willowmere', 'Zephyr', 'Alder', 'Beacon', 'Cobalt', 'Driftwood', 'Ember', 'Foxglove', 'Gullwing', 'Harbourside', 'Indigo', 'Larkspur']
const SUFFIX: [string, string][] = [
  ['Logistics', 'logistics'],
  ['Health', 'healthcare'],
  ['Foods', 'food and beverage'],
  ['Energy', 'energy'],
  ['Bank', 'financial services'],
  ['Retail', 'retail'],
  ['Labs', 'biotech'],
  ['Manufacturing', 'manufacturing'],
  ['Insurance', 'insurance'],
  ['Media', 'media']
]
const REGIONS = ['EMEA', 'North America', 'APAC', 'LATAM']
const TIERS = ['strategic', 'enterprise', 'mid-market', 'smb']
const TITLES: [string, string][] = [
  ['Chief Financial Officer', 'decision-maker'],
  ['Head of Procurement', 'decision-maker'],
  ['IT Director', 'influencer'],
  ['Finance Operations Manager', 'champion'],
  ['Accounts Payable Lead', 'user'],
  ['Billing Administrator', 'billing'],
  ['Security Architect', 'influencer'],
  ['Controller', 'champion']
]
const PRODUCTS: [string, string, number, string[]][] = [
  ['Ledger Cloud', 'Accounting', 42000, ['month-end close takes too long', 'journal import rejects multi-currency lines', 'trial balance does not match the general ledger']],
  ['Ledger Analytics', 'Analytics', 18000, ['dashboards show stale revenue figures', 'scheduled report emails stopped arriving', 'cohort chart times out on large accounts']],
  ['Payflow Payments', 'Payments', 55000, ['card payments fail with a 3-D Secure error', 'payout reconciliation is off by a day', 'refunds stay pending for a week']],
  ['Payflow Invoicing', 'Payments', 24000, ['invoice PDF export fails with a timeout', 'tax lines are rounded wrongly on invoices', 'dunning emails go to the wrong contact']],
  ['Sentinel Fraud Shield', 'Risk', 61000, ['legitimate orders are flagged as fraud', 'rules engine ignores an allow-list', 'fraud score webhook arrives late']],
  ['Sentinel Identity', 'Risk', 30000, ['SSO login loops after a password reset', 'SCIM provisioning creates duplicate users', 'MFA codes rejected for users abroad']],
  ['Atlas Spend', 'Procurement', 27000, ['purchase orders stuck awaiting approval', 'supplier catalogue import drops prices', 'budget alerts fire twice']],
  ['Atlas Expenses', 'Procurement', 15000, ['receipt scanning misreads totals', 'mileage claims use an old rate', 'card feed duplicates transactions']],
  ['Harbor Data Connector', 'Integrations', 12000, ['nightly sync to the data warehouse fails', 'ERP connector drops custom fields', 'API rate limit errors during bulk export']],
  ['Harbor Payroll Bridge', 'Integrations', 21000, ['payroll export misses new starters', 'pension deductions mapped to the wrong code', 'bridge stops after a schema change']]
]
const STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won', 'closed-lost'] as const
const OPEN = new Set(['prospecting', 'qualification', 'proposal', 'negotiation'])
const CAMPAIGNS = ['Finance Leaders Summit 2026', 'Close Faster webinar series', 'Fraud Week roadshow', 'Spring partner referral drive', 'Analytics free trial', 'EMEA CFO dinner', 'Procurement benchmark report', 'Payroll migration offer']
const OUTCOMES = [
  'agreed to a pilot with two business units',
  'asked for a security questionnaire before going further',
  'raised concerns about the renewal price',
  'wants a reference call with a customer in the same industry',
  'confirmed budget for next quarter',
  'is evaluating a competitor in parallel',
  'requested a custom data retention clause',
  'needs sign-off from the board before signing'
]

const EVIDENCE = (id: string) => [
  { source: 'crm_record', key: `crm:${id}` },
  { source: 'email', key: `msg:${id}` },
  { source: 'call_notes', path: `calls/${id}.md` },
  { source: 'human', observedBy: 'sales-ops' },
  { source: 'conversation', note: 'Mentioned by the account team.' }
]

export const loadCrm = async (budget: QueryBudget): Promise<Corpus> => {
  const next = random(hash32('crm'))
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
  const entities: CorpusEntity[] = []
  const add = (entity: Omit<CorpusEntity, 'evidence'>): CorpusEntity => {
    const full = { ...entity, evidence: evidenceFor(entity.id, EVIDENCE(entity.id)) }
    entities.push(full)
    return full
  }
  const usedNames = new Set<string>()
  const personName = (): string => {
    for (;;) {
      const name = `${pick(FIRST)} ${pick(LAST)}`
      if (!usedNames.has(name)) {
        usedNames.add(name)
        return name
      }
    }
  }

  const reps = Array.from({ length: 12 }, (_, index) => {
    const name = personName()
    const region = REGIONS[index % REGIONS.length] as string
    return add({ id: `sales_rep.${slug(name)}`, type: 'sales_rep', title: name, body: `${name} is an account executive covering ${region}.`, attributes: { region, team: index < 8 ? 'New Business' : 'Customer Success' } })
  })
  const products = PRODUCTS.map(([name, family, price]) =>
    add({ id: `product.${slug(name)}`, type: 'product', title: name, body: `${name} is part of the ${family} family, listed at ${price} a year.`, attributes: { family, price, sku: slug(name).toUpperCase() } })
  )
  const campaigns = CAMPAIGNS.map((name) => add({ id: `campaign.${slug(name)}`, type: 'campaign', title: name, body: `Marketing campaign: ${name}.` }))

  const accountNames = sample(PREFIX.flatMap((prefix) => SUFFIX.map(([suffix, industry]) => ({ name: `${prefix} ${suffix}`, prefix, industry }))), 40, next)
  const accounts = accountNames.map(({ name, industry }) => {
    const rep = pick(reps)
    const region = rep.attributes?.region as string
    return {
      rep,
      contacts: [] as CorpusEntity[],
      entity: add({
        id: `account.${slug(name)}`,
        type: 'account',
        title: name,
        body: `${name} is a ${pick(TIERS)} ${industry} customer in ${region}, managed by ${rep.title}.`,
        attributes: { industry, region, tier: pick(TIERS), status: pick(['customer', 'customer', 'customer', 'prospect', 'churned']) },
        links: [{ rel: 'managed_by', target: rep.id }]
      })
    }
  })
  const prefixesUsed = new Set(accountNames.map(({ prefix }) => prefix))

  for (const account of accounts) {
    for (const [title, role] of sample(TITLES, 4 + Math.floor(next() * 3), next)) {
      const name = personName()
      account.contacts.push(
        add({
          id: `contact.${slug(name)}`,
          type: 'contact',
          title: name,
          body: `${name} is the ${title} at ${account.entity.title}.`,
          attributes: { title, role, email: `${slug(name).replace(/-/g, '.')}@${slug(account.entity.title)}.example` },
          links: [{ rel: 'works_at', target: account.entity.id }]
        })
      )
    }
  }

  const opportunities = Array.from({ length: 120 }, (_, index) => {
    const account = pick(accounts)
    const product = pick(products)
    const stage = pick(STAGES)
    const amount = Math.round((product.attributes?.price as number) * (0.5 + next() * 2))
    const campaign = pick(campaigns)
    const month = 1 + Math.floor(next() * 12)
    return {
      account,
      product,
      stage,
      entity: add({
        id: `opportunity.${slug(account.entity.title)}-${slug(product.title)}-${index + 1}`,
        type: 'opportunity',
        title: `${account.entity.title} - ${product.title}`,
        body: `${stage === 'closed-won' ? 'Won' : stage === 'closed-lost' ? 'Lost' : 'Open'} deal for ${product.title} with ${account.entity.title}, worth ${amount}, at ${stage}. It came from the ${campaign.title} campaign.`,
        attributes: { stage, amount, closeDate: `2026-${String(month).padStart(2, '0')}-28` },
        links: [
          { rel: 'for_account', target: account.entity.id },
          { rel: 'involves_product', target: product.id },
          { rel: 'managed_by', target: account.rep.id },
          { rel: 'sourced_from', target: campaign.id }
        ]
      })
    }
  })

  const cases = Array.from({ length: 260 }, (_, index) => {
    const account = pick(accounts)
    const contact = pick(account.contacts)
    const productIndex = Math.floor(next() * PRODUCTS.length)
    const product = products[productIndex] as CorpusEntity
    const subject = pick(PRODUCTS[productIndex]?.[3] ?? [])
    const priority = pick(['low', 'medium', 'high', 'urgent'])
    const status = pick(['open', 'pending', 'escalated', 'closed', 'closed'])
    return {
      account,
      product,
      subject,
      contact,
      entity: add({
        id: `case.${index + 1001}`,
        type: 'case',
        title: `${product.title}: ${subject}`,
        body: `${contact.title} (${contact.attributes?.title}) at ${account.entity.title} reported that ${subject}. Priority ${priority}, ${status}.`,
        attributes: { priority, status },
        links: [
          { rel: 'for_account', target: account.entity.id },
          { rel: 'raised_by', target: contact.id },
          { rel: 'involves_product', target: product.id },
          { rel: 'managed_by', target: account.rep.id }
        ]
      })
    }
  })

  const activities = Array.from({ length: 300 }, (_, index) => {
    const opportunity = pick(opportunities)
    const contact = pick(opportunity.account.contacts)
    const kind = pick(['call', 'meeting', 'email', 'demo'])
    const outcome = pick(OUTCOMES)
    const date = `2026-${String(1 + Math.floor(next() * 10)).padStart(2, '0')}-${String(1 + Math.floor(next() * 27)).padStart(2, '0')}`
    return {
      contact,
      entity: add({
        id: `activity.${index + 5001}`,
        type: 'activity',
        title: `${kind[0]?.toUpperCase()}${kind.slice(1)} with ${contact.title}, ${date}`,
        body: `${kind[0]?.toUpperCase()}${kind.slice(1)} with ${contact.title} of ${opportunity.account.entity.title} about ${opportunity.product.title}: ${contact.title.split(' ')[0]} ${outcome}.`,
        attributes: { kind, date },
        links: [
          { rel: 'for_account', target: opportunity.account.entity.id },
          { rel: 'with_contact', target: contact.id },
          { rel: 'about_opportunity', target: opportunity.entity.id }
        ]
      })
    }
  })

  for (const account of sample(accounts, 30, next)) {
    const product = pick(products)
    add({
      id: `contract.${slug(account.entity.title)}-${slug(product.title)}`,
      type: 'contract',
      title: `${account.entity.title} ${product.title} agreement`,
      body: `Three-year agreement for ${product.title} with ${account.entity.title}, renewing in 2027.`,
      attributes: { startDate: '2024-04-01', endDate: '2027-03-31', value: (product.attributes?.price as number) * 3 },
      links: [
        { rel: 'for_account', target: account.entity.id },
        { rel: 'involves_product', target: product.id }
      ]
    })
  }
  for (let index = 0; index < 60; index += 1) {
    const name = personName()
    const campaign = pick(campaigns)
    add({
      id: `lead.${slug(name)}`,
      type: 'lead',
      title: name,
      body: `${name} signed up through ${campaign.title} and has not been qualified yet.`,
      attributes: { source: campaign.title, status: pick(['new', 'working', 'disqualified']) },
      links: [{ rel: 'sourced_from', target: campaign.id }, { rel: 'managed_by', target: pick(reps).id }]
    })
  }

  // --- Queries, from the records themselves ------------------------------------
  const generators: (() => EvalQuery)[] = [
    () => {
      const account = pick(accounts)
      const contact = pick(account.contacts)
      return { id: '', text: `Who is ${contact.title}?`, kind: 'answerable', category: 'who-is', relevant: { [contact.id]: 2, [account.entity.id]: 1 } }
    },
    () => {
      const account = pick(accounts)
      const contact = pick(account.contacts)
      return { id: '', text: `Who is the ${contact.attributes?.title} at ${account.entity.title}?`, kind: 'answerable', category: 'lookup', relevant: { [contact.id]: 2, [account.entity.id]: 1 } }
    },
    () => {
      const account = pick(accounts)
      return { id: '', text: `Who manages the ${account.entity.title} account?`, kind: 'answerable', category: 'multi-hop', relevant: { [account.rep.id]: 2, [account.entity.id]: 2 } }
    },
    () => {
      const rep = pick(reps)
      const owned = accounts.filter((account) => account.rep === rep)
      return { id: '', text: `Which accounts does ${rep.title} manage?`, kind: 'answerable', category: 'multi-hop', relevant: { [rep.id]: 1, ...Object.fromEntries(owned.map((account) => [account.entity.id, 2])) } }
    },
    () => {
      const found = pick(cases)
      const matching = cases.filter((item) => item.account === found.account && item.product === found.product)
      return { id: '', text: `What support cases has ${found.account.entity.title} raised about ${found.product.title}?`, kind: 'answerable', category: 'filter', relevant: Object.fromEntries(matching.map((item) => [item.entity.id, 2])) }
    },
    () => {
      const found = pick(cases)
      const matching = cases.filter((item) => item.subject === found.subject)
      return { id: '', text: `Which customers reported that ${found.subject}?`, kind: 'answerable', category: 'topical', relevant: Object.fromEntries(matching.flatMap((item) => [[item.entity.id, 2], [item.account.entity.id, 1]])) }
    },
    () => {
      const found = pick(opportunities.filter((item) => OPEN.has(item.stage)))
      const matching = opportunities.filter((item) => item.account === found.account && OPEN.has(item.stage))
      return { id: '', text: `What deals are open with ${found.account.entity.title}?`, kind: 'answerable', category: 'filter', relevant: Object.fromEntries(matching.map((item) => [item.entity.id, 2])) }
    },
    () => {
      const found = pick(activities)
      const matching = activities.filter((item) => item.contact === found.contact)
      return { id: '', text: `What came out of our conversations with ${found.contact.title}?`, kind: 'answerable', category: 'multi-hop', relevant: { [found.contact.id]: 1, ...Object.fromEntries(matching.map((item) => [item.entity.id, 2])) } }
    }
  ]
  const answerable: EvalQuery[] = []
  const seen = new Set<string>()
  while (answerable.length < budget.answerable) {
    const query = (generators[answerable.length % generators.length] as () => EvalQuery)()
    if (seen.has(query.text) || Object.keys(query.relevant).length === 0) continue
    seen.add(query.text)
    answerable.push({ ...query, id: `${query.category}-${answerable.length + 1}` })
  }

  const names = absentNames(entities)
  const usedLast = [...usedNames].map((name) => name.split(' ')[1] as string)
  const missingCompanies = PREFIX.filter((prefix) => !prefixesUsed.has(prefix))
  const unusedCombos = PREFIX.filter((prefix) => prefixesUsed.has(prefix)).flatMap((prefix) =>
    SUFFIX.map(([suffix]) => `${prefix} ${suffix}`).filter((name) => !accountNames.some((account) => account.name === name))
  )
  const noAnswerMakers: ((index: number) => EvalQuery)[] = [
    (index) => ({ id: '', text: `Who is ${names[index % names.length]} ${pick(usedLast)}?`, kind: 'no-answer', category: 'near-miss', relevant: {} }),
    (index) => ({ id: '', text: `What deals are open with ${pick(unusedCombos)}?`, kind: 'no-answer', category: 'near-miss', relevant: {} }),
    (index) => ({ id: '', text: `Who is the CFO at ${missingCompanies[index % Math.max(1, missingCompanies.length)] ?? 'Quillfeather'} ${pick(SUFFIX)[0]}?`, kind: 'no-answer', category: 'absent', relevant: {} }),
    (index) => ({ id: '', text: `Which customers use ${CANDIDATE_ABSENT_NAMES[(index + 3) % CANDIDATE_ABSENT_NAMES.length]} Workforce Scheduling?`, kind: 'no-answer', category: 'absent', relevant: {} })
  ]
  const noAnswer: EvalQuery[] = [whoIsQuery(names[0] as string)]
  for (let index = 0; noAnswer.length < budget.noAnswer; index += 1) {
    const query = (noAnswerMakers[index % noAnswerMakers.length] as (index: number) => EvalQuery)(index)
    if (seen.has(query.text)) continue
    seen.add(query.text)
    noAnswer.push({ ...query, id: `none-${noAnswer.length + 1}` })
  }

  return {
    name: 'crm',
    domain: 'CRM',
    source: 'Generated from a fixed seed (no download): accounts, contacts, reps, deals, cases, activities',
    template: 'crm',
    entities,
    queries: [...answerable, ...noAnswer]
  }
}
