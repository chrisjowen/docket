<!-- The run README.md#cognee describes: people and acme, cognee 1.6.8 on qwen2.5:7b and nomic-embed-text through Ollama, every strategy but agentic. RESULTS.md is the six-corpus run without cognee. -->

# Search evaluation results: cognee

Run 2026-11-13 06:39 UTC. Embedder ollama:nomic-embed-text; agentic model ollama:qwen2.5:7b. Every number is on the held-out test half of the queries; the relevance floors were tuned on the other half. See [README.md](README.md) for the datasets, the strategies and what each metric means.

## Corpora

| corpus | domain | template | entities | links | types (with entities) | test queries (no-answer) | sync ms | embed ms | cognee sync ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| people | people and organisations | people-org | 20 | 33 | 6 (6) | 6 (3) | 140 | 3.7 | 204723 |
| acme | SDLC | sdlc | 21 | 37 | 11 (11) | 24 (3) | 86 | 799 | 448734 |

Sources:

- **people**: Hand-written fixture in this repository (eval/search/fixtures/people-org.yaml)
- **acme**: examples/acme-platform (this repository) with the ask evaluation questions

## Overall

Macro-averaged over the corpora, so each counts the same. Relevance metrics are over answerable queries; FPR is the share of no-answer queries that returned anything. "balanced" is (nDCG@10 + (1 - FPR)) / 2, the objective the floors were tuned on.

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.874 | 0.179 | 0.957 | 0.907 | 0.98 | 1.00 | 10.5 | 0.16 | 0.437 | 22 | 44 | 0.0 | 0.65 |
| current+confidence | 0.505 | 0.083 | 0.518 | 0.631 | 0.64 | 1.00 | 3.7 | 0.25 | 0.253 | 25 | 40 | 0.0 | 0.89 |
| floor | 0.782 | 0.143 | 0.827 | 0.901 | 0.95 | 0.33 | 0.5 | 0.50 | 0.724 | 25 | 29 | 0.0 | 0.69 |
| floor+rrf | 0.783 | 0.143 | 0.827 | 0.901 | 0.95 | 0.33 | 0.5 | 0.51 | 0.725 | 23 | 34 | 0.0 | 0.69 |
| precached | 0.754 | 0.138 | 0.796 | 0.877 | 0.93 | 0.00 | 0.0 | 0.45 | 0.877 | 9.8 | 40 | 0.0 | 0.69 |
| cognee | 0.907 | 0.181 | 0.969 | 0.905 | 1.00 | 1.00 | 10.0 | 0.18 | 0.454 | 235 | 319 | 0.0 | 0.66 |
| cognee+floor | 0.790 | 0.145 | 0.811 | 0.861 | 0.93 | 0.50 | 0.5 | 0.41 | 0.645 | 230 | 352 | 0.0 | 0.68 |

## By corpus

### people

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.932 | 0.167 | 1.000 | 1.000 | 1.00 | 1.00 | 10.0 | 0.15 | 0.466 | 27 | 55 | 0.0 | 0.74 |
| current+confidence | 0.599 | 0.100 | 0.667 | 0.667 | 0.67 | 1.00 | 5.0 | 0.14 | 0.299 | 32 | 54 | 0.0 | 0.84 |
| floor | 0.803 | 0.133 | 0.833 | 1.000 | 1.00 | 0.33 | 0.3 | 0.67 | 0.735 | 34 | 37 | 0.0 | 0.79 |
| floor+rrf | 0.803 | 0.133 | 0.833 | 1.000 | 1.00 | 0.33 | 0.3 | 0.67 | 0.735 | 30 | 42 | 0.0 | 0.79 |
| precached | 0.803 | 0.133 | 0.833 | 1.000 | 1.00 | 0.00 | 0.0 | 0.57 | 0.902 | 2.8 | 53 | 0.0 | 0.79 |
| cognee | 1.000 | 0.167 | 1.000 | 1.000 | 1.00 | 1.00 | 10.0 | 0.17 | 0.500 | 257 | 341 | 0.0 | 0.74 |
| cognee+floor | 0.871 | 0.133 | 0.833 | 1.000 | 1.00 | 0.67 | 0.7 | 0.50 | 0.602 | 249 | 411 | 0.0 | 0.79 |

### acme

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.817 | 0.190 | 0.913 | 0.813 | 0.95 | 1.00 | 11.0 | 0.17 | 0.408 | 18 | 33 | 0.0 | 0.57 |
| current+confidence | 0.412 | 0.067 | 0.369 | 0.595 | 0.62 | 1.00 | 2.3 | 0.36 | 0.206 | 17 | 25 | 0.0 | 0.94 |
| floor | 0.760 | 0.152 | 0.821 | 0.802 | 0.90 | 0.33 | 0.7 | 0.34 | 0.714 | 16 | 22 | 0.0 | 0.58 |
| floor+rrf | 0.762 | 0.152 | 0.821 | 0.802 | 0.90 | 0.33 | 0.7 | 0.35 | 0.714 | 16 | 26 | 0.0 | 0.59 |
| precached | 0.704 | 0.143 | 0.758 | 0.754 | 0.86 | 0.00 | 0.0 | 0.33 | 0.852 | 17 | 26 | 0.0 | 0.59 |
| cognee | 0.815 | 0.195 | 0.937 | 0.810 | 1.00 | 1.00 | 10.0 | 0.20 | 0.407 | 214 | 297 | 0.0 | 0.57 |
| cognee+floor | 0.709 | 0.157 | 0.789 | 0.722 | 0.86 | 0.33 | 0.3 | 0.31 | 0.688 | 212 | 293 | 0.0 | 0.58 |

## By query category

nDCG@10 for answerable categories, and the share answered with nothing (higher is better) for no-answer ones, pooled over the corpora.

| category | n | current | current+confidence | floor | floor+rrf | precached | cognee | cognee+floor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| answerable/count | 4 | 0.56 | 0.12 | 0.37 | 0.37 | 0.12 | 0.56 | 0.03 |
| answerable/lookup | 11 | 0.95 | 0.57 | 0.92 | 0.94 | 0.94 | 0.96 | 0.93 |
| answerable/multi-hop | 8 | 0.78 | 0.34 | 0.73 | 0.70 | 0.67 | 0.79 | 0.77 |
| answerable/who-is | 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| no-answer/absent | 4 | 0.00 | 0.00 | 0.75 | 0.75 | 1.00 | 0.00 | 0.50 |
| no-answer/absent-name | 1 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 |
| no-answer/near-miss | 1 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0.00 |

## "Who is <absent name>"

Each corpus's "who is" query for a name it never mentions, answered by every strategy: how many entities came back, and the first three.

**people** - "who is sophia". A docket_search reply today also lists all 6 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Hannah Okoro", "Grace Wanjiru", "Tomás Silva", ...
- current+confidence: 5 - "Hannah Okoro", "Grace Wanjiru", "Partner Success", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- cognee: 10 - "Hannah Okoro", "Tomás Silva", "Grace Wanjiru", ...
- cognee+floor: nothing

**acme** - "who is sophia". A docket_search reply today also lists all 11 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Conversation API", "Support Session Store", "Orders Postgres", ...
- current+confidence: 1 - "Research Assistant"
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- cognee: 10 - "Conversation API", "Orders Postgres", "Support Session Store", ...
- cognee+floor: nothing

## Node confidence is not relevance

Over everything `current` returned for answerable queries (282 entities), relevant ones average confidence 0.672 and irrelevant ones 0.575; the point-biserial correlation between confidence and relevance is 0.210. Confidence says how well an entity's evidence supports it, whatever was asked.

Dropping entities below the low-confidence line (`current+confidence`) keeps 0.37 of the relevant entities `current` returned and 0.18 of the irrelevant ones, and still answers 1.00 of no-answer queries with something.

## Speed

- Precached answers to repeated queries: p50 0.0 ms.
- docket's JSONL lexicalSearch re-tokenises every document on each query: people 0.1 ms, acme 0.3 ms (p50), against 0.0 ms, 0.1 ms with the prebuilt index every strategy here uses.
- Latency is per query on one machine, embedding the query included; agentic adds two local model calls.

## Calibrated floors

| strategy | cosine floor | coverage floor | dev nDCG@10 | dev FPR | dev reply precision | dev balanced |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| floor | 0.62 | 0.50 | 0.710 | 0.00 | 0.51 | 0.855 |
| floor+rrf | 0.62 | 0.60 | 0.710 | 0.00 | 0.51 | 0.855 |
| precached | 0.64 | 0.60 | 0.808 | 0.00 | 0.56 | 0.904 |
| cognee+floor | 0.59 | - | 0.765 | 0.00 | 0.46 | 0.883 |

## Strategies

- **current**: Single pass: mem0-style semantic top 10, then full-text top 10, no floor - docket_search today.
- **current+confidence**: As current, dropping entities whose node confidence is below 0.7: the "drop low-confidence results" change.
- **floor**: As current, keeping semantic hits with cosine >= 0.62 and full-text hits covering >= 0.5 of the query's idf.
- **floor+rrf**: Relevance floor (cosine >= 0.62, coverage >= 0.6) on top 20 of each source, fused by reciprocal rank, top 10.
- **precached**: Sync-time link-aware embeddings and vocabulary; a query naming a word no entity holds returns nothing; otherwise floor (cosine >= 0.64, coverage >= 0.6) and RRF, top 10. Repeated queries come from a cache.
- **cognee**: cognee 1.6.8 through @docket/adapter-cognee: its CHUNKS search over cognified entities, top 10, no floor.
- **cognee+floor**: As cognee, keeping chunks with cosine similarity >= 0.59 - the adapter's maxDistance: 0.41.
