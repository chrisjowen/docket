# Search relevance: the re-ranker and the learned cut

`docket_search` used to return each projection's top 10, filtered on node
confidence and ranked by rank × confidence × recency: 8 to 10 results for a
question with one to three relevant records, and ten unrelated ones for "who
is sophia" in a workspace with no Sophia. Docket's search evaluation and its
research (docket `packages/docket/eval/search`) found why: the hybrid pool
almost always holds a relevant record, but nothing read the question and the
record together, and node confidence says how well a record is supported, not
whether it answers the question.

It now decides relevance in three steps (`apps/worker/src/relevance.ts`):

1. **The name gate.** A question naming someone or something no resource
   holds - a capitalised word that does not start a sentence, or whoever
   follows "who is" - is answered with nothing, without searching further.
   Words with digits, words in capitals, and a role after "who is our" are not
   taken for names.
2. **The re-ranker.** Each projection's top 10 (Neo4j full-text and mem0),
   at most 20 candidates, are read with the question by a cross-encoder,
   `cross-encoder/ms-marco-MiniLM-L6-v2`, int8 for AVX-512 VNNI, 256 tokens of
   question and record together. It runs on the node's CPU in a pod of its own
   (`deploy/helm/docket-cloud/templates/reranker.yaml`), as the embedder does.
   The Ask page's search filtered by type or tag asks deeper (`pool`, each
   projection's top 50, at most 64 candidates), since the projections rank
   across every type; the cut still applies.
3. **The learned cut.** A logistic model over the re-ranker's score and the
   projections' own (cosine, Lucene score, ranks, how much of the question a
   record holds) gives each candidate a probability of being relevant. A
   question is answered only when its best candidate reaches 0.3, and then
   with the candidates above 0.2 and at least 0.6 times the best, most
   probable first. When the re-ranker
   does not answer, a second model fitted on the projections' scores alone
   cuts instead, and the reply says so.

Node confidence decides none of it: it is shown with each result. The
`minConfidence` argument is still taken, and ignored: the reply says so.

## How it was measured

`apps/worker/src/search-relevance.int.test.ts` projects docket's six search
evaluation corpora (people, acme, CRM, LoCoMo, SciFact, WANDS; 13,270 records,
381 questions, the evaluation's own dev/test split) into the cloud's own
Neo4j and mem0 - so the cut is fitted on the scores these projectors give,
not the evaluation's stand-ins - asks every question through the worker's
search path, and scores the answers with the evaluation's metrics. The cut is
fitted on the dev questions: the best balanced score, (nDCG@10 + 1 - FPR) / 2,
plus reply precision among the cuts whose dev nDCG@10 is at least 0.622 -
the research pilot's baseline, the evaluation's `precached` search at 0.632,
less 0.01.

Test questions, macro over the six corpora:

| | nDCG@10 | no-answer FPR | reply precision | results per answerable question |
| --- | ---: | ---: | ---: | ---: |
| before: confidence floor, rank × confidence × recency | 0.618 | 1.00 | 0.29 | 8.6 |
| re-ranked, no cut (the gate only) | 0.766 | 0.41 | 0.29 | 9.9 |
| **re-ranked and cut (shipped)** | **0.622** | **0.31** | **0.62** | **3.0** |
| projections' scores only, cut (the fallback) | 0.645 | 0.41 | 0.52 | 4.3 |
| bge-reranker-base instead, cut | 0.665 | 0.34 | 0.56 | 3.7 |

Each corpus, nDCG@10 / FPR / reply precision (results):

| corpus | before | re-ranked and cut |
| --- | --- | --- |
| acme | 0.40 / 1.00 / 0.34 (2.0) | 0.71 / 0.33 / 0.58 (2.0) |
| crm | 0.75 / 1.00 / 0.35 (10.0) | 0.78 / 0.13 / 0.81 (3.7) |
| locomo | 0.40 / 1.00 / 0.13 (10.0) | 0.37 / 0.00 / 0.30 (3.1) |
| people | 0.91 / 1.00 / 0.17 (10.0) | 0.80 / 0.00 / 0.80 (1.7) |
| scifact | 0.68 / 1.00 / 0.10 (10.0) | 0.54 / 0.42 / 0.38 (1.7) |
| wands | 0.57 / 1.00 / 0.66 (9.9) | 0.52 / 1.00 / 0.83 (6.0) |

"who is sophia" in the people corpus and "Who is Sophia Varga?" in the CRM
each returned ten records before and return nothing now.

The test split is small: a macro difference under about 0.03 is noise.
Ranking is level with the search it replaces (nDCG@10 0.618 to 0.622) and
within 0.01 of the research's `precached` baseline (0.632); the no-answer
false-positive rate falls from 1.00 to 0.31 and reply precision rises from
0.29 to 0.62. The research pilot reached 0.647 / 0.14 / 0.59 on the
evaluation's stand-in projectors. The gap that remains is the false-positive
rate, mostly WANDS questions about product classes the shop does not carry
and SciFact's held-out claims: topical near misses, which the research found
no score threshold separates from real answers. People, SciFact, WANDS and
LoCoMo still rank somewhat lower than before, while acme and CRM rank higher.
A cut fitted per corpus is not possible at query time - the search does not
know which kind of workspace it is in - so the fit is per projector, as the
research asks. bge-reranker-base ranks better (0.665) but answers more
no-answer questions (0.34) and runs about five times as long on the node's
CPU (below), outside the search's budget. Asking each projection for 15
instead of 10 changed nothing measurable (0.623 / 0.33 / 0.65); for 20, it
ranked a little higher but answered more no-answer questions (0.646 / 0.41 /
0.60), at twice the re-ranker's time.

## Latency

The re-ranker on a 4 vCPU reference host (AMD EPYC 9354P, two ONNX Runtime
threads, the host under its usual load), per question:

| candidates | MiniLM p50 / p95 | bge-reranker-base p50 / p95 |
| --- | ---: | ---: |
| 14 SDLC resources (acme) | 255 / 297 ms | 1352 / 1594 ms |
| 20 CRM records | 92 / 120 ms | 525 / 822 ms |
| 20 LoCoMo notes | 135 / 200 ms | 688 / 802 ms |
| 20 SciFact abstracts (256 tokens each, the worst case) | 464 / 567 ms | 2088 / 2403 ms |

The budget: the re-ranker adds at most 600 ms at p95 to `docket_search`,
which the load test holds to a p95 of 800 ms. Its client gives up after 3 s
(`DOCKET_RERANKER_TIMEOUT_MS`), and the search then cuts on the projections'
scores alone.

## Refitting

Refit whenever a projector, its embedder or the re-ranker changes; the
scores the cut reads are the projectors' own. First export the corpora from a
docket checkout (docket at `a16b1ad`): each written out as a docket, with a
`queries.json` of its questions and their split. Save this as
`packages/docket/eval/search/zz-export.eval.ts` there and run
`EXPORT_OUT=<corpora> npx vitest run --config eval/vitest.config.ts eval/search/zz-export`
in `packages/docket`, after `pnpm eval:search:download`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { it } from 'vitest'
import { splitOf, writeDocket, type Corpus } from './corpus.js'
import { loadAcme } from './datasets/acme.js'
import { MissingData, type QueryBudget } from './datasets/common.js'
import { loadCrm } from './datasets/crm.js'
import { loadLocomo } from './datasets/locomo.js'
import { loadPeople } from './datasets/people.js'
import { loadScifact } from './datasets/scifact.js'
import { loadWands } from './datasets/wands.js'

// Exports each corpus as a synced docket plus its queries, for docket-cloud's search harness.
const OUT = process.env.EXPORT_OUT as string
const BUDGET: QueryBudget = { answerable: 60, noAnswer: 20 }
const LOADERS: [string, () => Promise<Corpus>][] = [
  ['people', loadPeople], ['acme', loadAcme], ['crm', () => loadCrm(BUDGET)], ['locomo', () => loadLocomo(BUDGET)], ['scifact', () => loadScifact(BUDGET)], ['wands', () => loadWands(BUDGET)],
]
it('exports', { timeout: 3_600_000 }, async () => {
  await mkdir(OUT, { recursive: true })
  for (const [name, load] of LOADERS) {
    try {
      const corpus = await load()
      await writeDocket(corpus, join(OUT, name))
      const queries = corpus.queries.map((q) => ({ ...q, split: splitOf(corpus.name, q) }))
      await writeFile(join(OUT, name, 'queries.json'), JSON.stringify({ name, domain: corpus.domain, template: corpus.template, queries }, null, 1))
      console.log(name, corpus.queries.length, 'queries')
    } catch (e) { if (e instanceof MissingData) console.log(name, 'missing', e.message); else throw e }
  }
})
```

Then, with the stack and Ollama's `nomic-embed-text`:

```sh
DOCKET_SEARCH_EVAL_CORPORA=<corpora> DOCKET_SEARCH_EVAL_OUT=<out> DOCKET_SEARCH_EVAL_RERANKERS=minilm,bge-base \
  pnpm --filter @docket/server-worker exec vitest run src/search-relevance.int.test.ts
```

It writes `report.md` and `models.json`; copy the models into
`apps/worker/src/relevance-model.ts`. Projecting the six corpora takes about
half an hour on a laptop; the pools are cached in the output directory, so a
refit after that takes seconds.
