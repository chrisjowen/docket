# Search evaluation

How fast, how accurate and how relevant docket's search is, across corpora
from six ontologies, and which way of searching does best. It loads each
corpus into a local docket under one of docket's ontology templates, syncs it,
asks every strategy the same queries, and writes a report. The latest results
are in [RESULTS.md](RESULTS.md).

It answers one question in particular: what should `docket_search` return
when nothing in the docket answers? Asked "who is sophia" in a workspace with
no Sophia, Docket Cloud returns ten unrelated records, because semantic search
always returns its top ten however poor the match. Filtering on node
confidence does not fix that. Confidence says how well an entity's evidence
supports it, not how well it matches a question, and the evaluation keeps the
two apart in every metric and strategy.

## What the results say

From the run in [RESULTS.md](RESULTS.md), macro-averaged over the six corpora:

- Today's single pass answers every no-answer query with something - 14.5
  entities on average - and only 23% of what it returns for answerable
  queries is relevant.
- Filtering on node confidence keeps 65% of the relevant entities and 50% of
  the irrelevant ones. It still answers every no-answer query.
- A relevance floor on each source fixes most of the no-answer problem
  (false-positive rate 1.00 to 0.16) and more than doubles reply precision,
  but it costs ranking quality (nDCG@10 0.73 to 0.52). Multi-hop and count
  questions lose most, because the entities they need match the question
  weakly.
- `precached` balances the two best: false-positive rate 0.21, nDCG@10
  0.63, at single-pass speed. Its link-aware embeddings recover much of what
  the floor drops, and its name check answers "who is sophia" without
  searching.
- `agentic` with a local 7B model has the highest reply precision (0.69), but
  it is about 7 seconds per query and a weak judge of no-answer questions
  that stay on topic. Its numbers measure that model as much as the method.
- What stays hard is a no-answer question on a topic the docket does cover:
  a SciFact claim whose papers are gone, or a product class the catalogue
  does not carry. Every single-pass floor still answers most of those.

## Running it

```sh
pnpm -C packages/docket eval:search:download   # fetch the datasets (~100 MB), once
pnpm -C packages/docket eval:search            # run; prints the report and writes it to DOCKET_EVAL_OUT
```

It needs [Ollama](https://ollama.com) with `nomic-embed-text` for embeddings
and, for the agentic strategy, a chat model (`qwen2.5:7b` by default). Without
Ollama it prints `search evaluation skipped: <why>` and is reported as
skipped. It calls models, so it is never part of `pnpm test`. `pnpm test` does
run [search.test.ts](search.test.ts): the metrics, the full-text index against
the JSONL adapter, the strategies' floors, and the committed and generated
corpora.

A dataset that has not been downloaded is skipped, saying so. The people
fixture and the generated CRM need no download, so a run always has at least
those. A full run takes about 40 minutes on an M-series laptop, most of it the
agentic strategy. Embeddings are cached in the data directory, so a second run
only re-embeds what changed.

| Variable | Default | |
| --- | --- | --- |
| `DOCKET_EVAL_DATA` | `$XDG_CACHE_HOME/docket-eval` or `~/.cache/docket-eval` | Where the datasets and the embedding cache live. |
| `DOCKET_EVAL_MIRROR` | | Fetch `<mirror>/<file>` instead of each upstream URL. |
| `DOCKET_EVAL_OUT` | a new temp directory | Where `report.md`, `outcomes.json` (every query, every answer) and the synced dockets go. |
| `DOCKET_EVAL_CORPORA` | all | Comma-separated: `people,acme,crm,locomo,scifact,wands`. |
| `DOCKET_EVAL_STRATEGIES` | all | Comma-separated strategy names. |
| `DOCKET_EVAL_QUERIES` / `DOCKET_EVAL_NO_ANSWER` | `60` / `20` | Answerable and no-answer queries per generated or sampled corpus. |
| `DOCKET_EVAL_EMBEDDER` | `nomic-embed-text` | An Ollama embedding model. |
| `DOCKET_EVAL_AGENT` | `ollama:qwen2.5:7b` | The agentic strategy's model: `ollama:<model>`, `claude` or `claude:<model>`. |
| `DOCKET_EVAL_AGENTIC_MAX` | all | At most this many test queries per corpus for the agentic strategy. |
| `DOCKET_EVAL_OLLAMA_URL` | `http://localhost:11434` | |

To update [RESULTS.md](RESULTS.md), run with `DOCKET_EVAL_OUT` set and copy
its `report.md` over it.

## Datasets

The task needs typed records with links between them, people and
organisations among them, and queries with known relevant records, including
queries the records cannot answer. Few public datasets have all of that, so
the corpora are picked to cover different ontologies and different ways a
search can go wrong.

| Corpus | Ontology template | Entities | Source | Why |
| --- | --- | --- | --- | --- |
| `people` | `people-org` | 20 | [fixtures/people-org.yaml](fixtures/people-org.yaml), committed | People, teams, organisations, roles, skills and who reports to whom, with "who is" and near-miss queries. Always available. |
| `acme` | the example's own SDLC ontology | 21 | [examples/acme-platform](../../../../examples/acme-platform), with the [ask evaluation](../ask/README.md)'s questions | Software delivery: services, teams, decisions. Each ask question's `basis` is what a search should find. |
| `crm` | `crm` | ~1,000 | [datasets/crm.ts](datasets/crm.ts), generated from a fixed seed | Accounts, contacts, reps, deals, cases and activities, with exact ground truth and near-miss names. |
| `locomo` | `personal-knowledge` | ~2,700 | [LoCoMo](https://github.com/snap-research/locomo) (Maharana et al., ACL 2024), CC BY-NC 4.0 | Long-term conversational memory: people, sessions, the facts and events said in them. The benchmark mem0's paper reports on. |
| `scifact` | `research` | ~5,200 | [SciFact](https://github.com/allenai/scifact) (Wadden et al., EMNLP 2020) via [BEIR](https://github.com/beir-cellar/beir), CC BY-NC 2.0 | Scientific claims and the abstracts that support or refute them: dense, same-field distractors. |
| `wands` | `product-catalogue` | ~4,300 | [WANDS](https://github.com/wayfair/WANDS) (Chen et al., ECIR 2022), MIT | Products in a category tree, with Exact, Partial and Irrelevant judgements from Wayfair's annotators. |

### How the queries are built

- **Answerable** queries come from each dataset's own judgements: the ask
  questions' `basis`, LoCoMo's evidence turns, SciFact's qrels, WANDS's Exact
  and Partial labels, and the CRM generator's own records. Each relevant
  entity has a grade: 2 answers the query, 1 is partly relevant.
- **No-answer** queries have no relevant entity at all, built so that a
  near-but-wrong match is likely:
  - every corpus has "who is <name>" for a first name it never mentions -
    "who is sophia" where Sophia is absent;
  - LoCoMo swaps the one speaker a question names for an absent name ("When
    did Ingrid start boot camp with his family?");
  - SciFact holds claims out, removing the papers they cite, so the closest
    papers in the same field remain;
  - WANDS drops a whole product class, so "salon chair" meets a catalogue
    with chairs but no salon chairs;
  - the CRM asks about people who share a surname with a real contact, and
    companies that share a prefix with a real account.
- Half of each corpus's queries, chosen by a hash of the id, are **dev**
  queries the relevance floors are tuned on; every reported number is on
  the other half, the **test** queries.

LoCoMo conversations conv-43 and conv-47 are left out, because their "John"
shares a first name with conv-41's. Its adversarial questions (category 5)
are left out too: they ask about the wrong speaker, so the records are
relevant even though the answer is not.

Each generated entity gets one piece of evidence, from a source its
template defines, picked by a hash of its id. Its node confidence therefore
varies independently of anything a query asks.

### Considered and not used

- **CRMArena** (Salesforce, 2024): realistic CRM tasks, but the records live
  in a Salesforce org rather than in the dataset, so there is no corpus to
  load. The CRM corpus is generated instead.
- **DBpedia-Entity v2** (Hasibi et al., 2017): graded entity-search judgements
  for 467 queries, a strong fit for people and organisations, but its corpus
  is 4.6 million DBpedia entities. A usable subsample would be derived data
  that has to be hosted somewhere - see [Hosting](#hosting).
- **LongMemEval** (Wu et al., 2024): has abstention questions like LoCoMo's,
  but its haystacks are chat sessions rather than typed records, and LoCoMo
  already covers personal memory.
- **Amazon ESCI** (Reddy et al., 2022): product search with
  Exact/Substitute/Complement/Irrelevant labels, but about 2 GB. WANDS has the
  same kind of graded labels at a twentieth of the size, under MIT.
- **SQuAD 2.0, Natural Questions, CRAG, HotpotQA, MS MARCO**: unanswerable or
  multi-hop questions over passages, not typed entities with links.
- **Enron email, OpenAlex, Wikidata**: rich records but no relevance
  judgements; queries would all have to be written by hand.

### Hosting

Nothing large is committed. [download.mjs](download.mjs) fetches each file
from its upstream URL - GitHub at a pinned commit, or BEIR's server - and
checks it against the sha256 in [datasets.json](datasets.json); a file that
changes upstream fails the check rather than changing the results. There was
no Hostinger download path or S3 bucket to use, and none is needed while the
upstreams stay up. If one disappears, mirror the five files (about 100 MB)
under any HTTP path and set `DOCKET_EVAL_MIRROR` to it; the hashes still
apply. A subsampled DBpedia-Entity corpus would need such a path.

The CC BY-NC datasets (LoCoMo, SciFact) are fetched for evaluation and never
redistributed.

## Strategies

Each strategy answers a query with entity ids, most relevant first, or with
nothing. The single-pass strategies use the two sources `docket_search`
combines in Docket Cloud:

- **semantic**, standing in for mem0: cosine similarity between the query and
  each entity, embedded as adapter-mem0's `renderDocument` writes it (title,
  type, body, links, tags), with nomic-embed-text's `search_document: ` and
  `search_query: ` prefixes;
- **full-text**, standing in for Neo4j's full-text index: BM25 over title,
  id and tags, and body, scored exactly as the JSONL adapter's
  `lexicalSearch` (`search.test.ts` checks they agree), but tokenised once.

| Strategy | What it does |
| --- | --- |
| `current` | `docket_search` today: each source's top 10, semantic hits first, no floor. |
| `current+confidence` | `current`, dropping entities whose node confidence is below 0.7 (docket's `LOW_CONFIDENCE`): the "drop low-confidence results" change. It filters on confidence, not relevance, and is here to show what that does. |
| `floor` | `current` with a relevance floor on each source: semantic hits need a minimum cosine similarity, full-text hits must cover a minimum share of the query's terms, weighted by idf. |
| `floor+rrf` | The floor on each source's top 20, then reciprocal rank fusion and a cut to 10. |
| `precached` | Work moved to sync time. Each entity is embedded with the titles of what it links to and without its confidence, and the full-text vocabulary is kept. A query naming a word no entity holds - a capitalised word that does not start a sentence, or whatever follows "who is" unless it starts "our", "the" or another determiner; acronyms and words with digits never count - returns nothing without searching. Otherwise floor and fusion as above, over the link-aware embeddings. Answers are cached by query terms. |
| `precached+precision` | `precached` with its floors tuned for reply precision instead (below). |
| `agentic` | A model (`DOCKET_EVAL_AGENT`) plans 1-3 searches, the record types to expect, and whether to follow links. The single-pass sources run each search, adding neighbours when asked. The model then judges which candidates are about exactly what was asked, and an empty judgement is the answer. Two model calls per query. |

The floors are tuned on the dev queries, pooled over corpora, by grid
search: cosine 0.30-0.90 in steps of 0.01, coverage 0-1 in steps of 0.1. The
objective is **balanced** = (nDCG@10 on answerable queries + share of
no-answer queries answered with nothing) / 2. Balanced never looks at how much
of a reply is noise, so `precached`'s floors are also tuned for the most dev
reply precision whose dev nDCG@10 is within 0.02 of the balanced pick's and
whose dev FPR is no worse (`precached+precision`). The report lists each
floor's objective and its dev nDCG@10, FPR and reply precision. A cosine floor belongs to its
embedding model. The floors here are for `nomic-embed-text`; the hosted mem0
platform embeds with its own model, so its scores sit on a different scale
and its floor must be tuned the same way on its own scores.

## Metrics

All at k = 10, `docket_search`'s default limit, on test queries.

| Metric | Over | Meaning |
| --- | --- | --- |
| nDCG@10 | answerable | Graded ranking quality: gain 2^grade - 1, against the ideal order. |
| P@10, R@10, MRR | answerable | Precision, recall and reciprocal rank of the first relevant entity, counting entities at the query's `minGrade` (Exact only for WANDS; any grade elsewhere). |
| hit@10 | answerable | Share with at least one relevant entity in the top 10. |
| no-answer FPR | no-answer | Share that returned anything at all. The "who is sophia" failure. |
| returned on no-answer | no-answer | Entities returned, on average. |
| reply precision | answerable | Of everything returned, the share relevant at any grade: how much of a reply is noise. |
| balanced | both | (nDCG@10 + 1 - FPR) / 2. |
| p50 / p95 ms | all | Wall time per query on the machine that ran it, embedding the query included. |
| LLM calls | all | Model calls per query. |
| mean confidence | all returned | Mean node confidence of what was returned. Reported on its own, used in no other metric. |

Each corpus is summarised on its own, and the overall table is the mean of
the corpora, so the 21-entity fixtures count as much as the 5,000-entity
ones. The report also gives the scores by query category, each corpus's
"who is <absent name>" answer from every strategy, how node confidence
relates to relevance among returned entities, and the latency of docket's
JSONL `lexicalSearch` against a prebuilt index.

## Files

- [search.eval.ts](search.eval.ts): the run.
- [corpus.ts](corpus.ts): the corpus and query model, and writing a corpus out as a docket.
- [datasets/](datasets): one loader per corpus.
- [engine.ts](engine.ts): the full-text index, embeddings and links every strategy searches.
- [strategies.ts](strategies.ts), [metrics.ts](metrics.ts), [report.ts](report.ts).
- [download.mjs](download.mjs), [datasets.json](datasets.json): fetching the datasets.
