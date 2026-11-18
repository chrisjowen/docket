<!-- The run README.md#postgres-and-sqlite describes: all six corpora, every strategy but agentic, the Postgres and SQLite adapters synced through docket sync into Postgres 17 with pgvector 0.8 and SQLite files. RESULTS.md is the six-corpus run without them. -->

# Search evaluation results: Postgres and SQLite

Run 2026-11-18 08:17 UTC. Embedder ollama:nomic-embed-text; agentic model ollama:qwen2.5:7b. Every number is on the held-out test half of the queries; the relevance floors were tuned on the other half. See [README.md](README.md) for the datasets, the strategies and what each metric means.

## Corpora

| corpus | domain | template | entities | links | types (with entities) | test queries (no-answer) | sync ms | embed ms | postgres sync ms | postgres+hybrid sync ms | sqlite sync ms | sqlite+hybrid sync ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| people | people and organisations | people-org | 20 | 33 | 6 (6) | 6 (3) | 121 | 196 | 302 | 547 | 61 | 330 |
| acme | SDLC | sdlc | 21 | 37 | 11 (11) | 24 (3) | 45 | 125 | 109 | 435 | 38 | 443 |
| crm | CRM | crm | 1044 | 2844 | 10 (10) | 47 (8) | 361 | 158 | 3615 | 23255 | 1573 | 15301 |
| locomo | personal knowledge | personal-knowledge | 2733 | 5450 | 7 (4) | 47 (12) | 747 | 178 | 9978 | 66825 | 1464 | 52463 |
| scifact | research | research | 5163 | 0 | 8 (1) | 42 (12) | 1276 | 236 | 16869 | 273000 | 3477 | 235419 |
| wands | product catalogue | product-catalogue | 4289 | 4131 | 6 (2) | 38 (7) | 1115 | 244 | 16467 | 148484 | 2461 | 118363 |

Sources:

- **people**: Hand-written fixture in this repository (eval/search/fixtures/people-org.yaml)
- **acme**: examples/acme-platform (this repository) with the ask evaluation questions
- **crm**: Generated from a fixed seed (no download): accounts, contacts, reps, deals, cases, activities
- **locomo**: LoCoMo (snap-research/locomo, CC BY-NC 4.0): 8 of 10 long conversations
- **scifact**: SciFact via BEIR (CC BY-NC 2.0): 5,183 abstracts, test claims
- **wands**: WANDS (wayfair/WANDS, MIT): 3425 of 42,994 products

## Overall

Macro-averaged over the corpora, so each counts the same. Relevance metrics are over answerable queries; FPR is the share of no-answer queries that returned anything. "balanced" is (nDCG@10 + (1 - FPR)) / 2, the objective the floors were tuned on.

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.731 | 0.241 | 0.723 | 0.784 | 0.92 | 1.00 | 14.8 | 0.23 | 0.366 | 21 | 35 | 0.0 | 0.68 |
| current+confidence | 0.473 | 0.162 | 0.421 | 0.587 | 0.68 | 1.00 | 8.0 | 0.26 | 0.237 | 20 | 28 | 0.0 | 0.82 |
| floor | 0.557 | 0.185 | 0.530 | 0.675 | 0.78 | 0.20 | 0.6 | 0.55 | 0.680 | 21 | 28 | 0.0 | 0.69 |
| floor+rrf | 0.616 | 0.203 | 0.588 | 0.718 | 0.83 | 0.25 | 1.1 | 0.52 | 0.683 | 21 | 33 | 0.0 | 0.69 |
| precached | 0.632 | 0.208 | 0.608 | 0.712 | 0.82 | 0.21 | 1.0 | 0.47 | 0.712 | 17 | 29 | 0.0 | 0.69 |
| postgres | 0.725 | 0.234 | 0.734 | 0.781 | 0.90 | 0.83 | 7.3 | 0.29 | 0.446 | 60 | 108 | 0.0 | 0.68 |
| postgres+hybrid | 0.752 | 0.246 | 0.759 | 0.814 | 0.95 | 1.00 | 10.0 | 0.28 | 0.376 | 71 | 121 | 0.0 | 0.68 |
| sqlite | 0.715 | 0.236 | 0.744 | 0.756 | 0.92 | 0.89 | 7.4 | 0.29 | 0.413 | 10 | 16 | 0.0 | 0.68 |
| sqlite+hybrid | 0.747 | 0.245 | 0.762 | 0.808 | 0.95 | 1.00 | 10.0 | 0.28 | 0.373 | 48 | 67 | 0.0 | 0.68 |

## By corpus

### people

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.932 | 0.167 | 1.000 | 1.000 | 1.00 | 1.00 | 10.0 | 0.15 | 0.466 | 15 | 59 | 0.0 | 0.74 |
| current+confidence | 0.599 | 0.100 | 0.667 | 0.667 | 0.67 | 1.00 | 5.0 | 0.14 | 0.299 | 14 | 21 | 0.0 | 0.84 |
| floor | 0.630 | 0.100 | 0.667 | 1.000 | 1.00 | 0.00 | 0.0 | 1.00 | 0.815 | 15 | 17 | 0.0 | 0.77 |
| floor+rrf | 0.803 | 0.133 | 0.833 | 1.000 | 1.00 | 0.00 | 0.0 | 1.00 | 0.902 | 16 | 25 | 0.0 | 0.79 |
| precached | 0.803 | 0.133 | 0.833 | 1.000 | 1.00 | 0.00 | 0.0 | 0.80 | 0.902 | 0.0 | 16 | 0.0 | 0.80 |
| postgres | 0.896 | 0.167 | 1.000 | 1.000 | 1.00 | 0.33 | 0.3 | 0.28 | 0.781 | 6.3 | 33 | 0.0 | 0.75 |
| postgres+hybrid | 0.896 | 0.167 | 1.000 | 1.000 | 1.00 | 1.00 | 10.0 | 0.17 | 0.448 | 30 | 39 | 0.0 | 0.74 |
| sqlite | 0.896 | 0.167 | 1.000 | 1.000 | 1.00 | 0.33 | 0.3 | 0.28 | 0.781 | 0.6 | 2.5 | 0.0 | 0.75 |
| sqlite+hybrid | 0.896 | 0.167 | 1.000 | 1.000 | 1.00 | 1.00 | 10.0 | 0.17 | 0.448 | 38 | 63 | 0.0 | 0.74 |

### acme

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.817 | 0.190 | 0.913 | 0.813 | 0.95 | 1.00 | 11.0 | 0.17 | 0.408 | 25 | 33 | 0.0 | 0.57 |
| current+confidence | 0.412 | 0.067 | 0.369 | 0.595 | 0.62 | 1.00 | 2.3 | 0.36 | 0.206 | 19 | 27 | 0.0 | 0.94 |
| floor | 0.463 | 0.081 | 0.472 | 0.548 | 0.62 | 0.00 | 0.0 | 0.63 | 0.731 | 19 | 28 | 0.0 | 0.62 |
| floor+rrf | 0.516 | 0.095 | 0.528 | 0.595 | 0.67 | 0.00 | 0.0 | 0.57 | 0.758 | 17 | 22 | 0.0 | 0.62 |
| precached | 0.580 | 0.114 | 0.631 | 0.611 | 0.71 | 0.00 | 0.0 | 0.56 | 0.790 | 16 | 25 | 0.0 | 0.61 |
| postgres | 0.878 | 0.200 | 0.966 | 0.873 | 1.00 | 0.67 | 3.3 | 0.22 | 0.606 | 9.1 | 14 | 0.0 | 0.58 |
| postgres+hybrid | 0.864 | 0.205 | 0.973 | 0.849 | 1.00 | 1.00 | 10.0 | 0.20 | 0.432 | 26 | 46 | 0.0 | 0.57 |
| sqlite | 0.809 | 0.200 | 0.961 | 0.790 | 1.00 | 1.00 | 4.3 | 0.22 | 0.404 | 2.5 | 5.2 | 0.0 | 0.58 |
| sqlite+hybrid | 0.839 | 0.200 | 0.961 | 0.825 | 1.00 | 1.00 | 10.0 | 0.20 | 0.420 | 19 | 23 | 0.0 | 0.57 |

### crm

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.817 | 0.338 | 0.746 | 0.944 | 1.00 | 1.00 | 15.4 | 0.25 | 0.409 | 19 | 33 | 0.0 | 0.74 |
| current+confidence | 0.547 | 0.226 | 0.479 | 0.747 | 0.82 | 1.00 | 9.1 | 0.27 | 0.274 | 20 | 27 | 0.0 | 0.82 |
| floor | 0.700 | 0.300 | 0.600 | 0.816 | 0.85 | 0.13 | 0.3 | 0.60 | 0.788 | 21 | 29 | 0.0 | 0.74 |
| floor+rrf | 0.711 | 0.297 | 0.622 | 0.868 | 0.92 | 0.13 | 0.4 | 0.48 | 0.793 | 20 | 32 | 0.0 | 0.74 |
| precached | 0.808 | 0.323 | 0.683 | 0.910 | 0.92 | 0.13 | 0.4 | 0.46 | 0.841 | 19 | 33 | 0.0 | 0.74 |
| postgres | 0.841 | 0.354 | 0.781 | 0.970 | 1.00 | 1.00 | 10.0 | 0.35 | 0.421 | 40 | 55 | 0.0 | 0.74 |
| postgres+hybrid | 0.854 | 0.354 | 0.781 | 0.970 | 1.00 | 1.00 | 10.0 | 0.35 | 0.427 | 47 | 66 | 0.0 | 0.74 |
| sqlite | 0.848 | 0.354 | 0.781 | 0.974 | 1.00 | 1.00 | 10.0 | 0.35 | 0.424 | 10.0 | 13 | 0.0 | 0.74 |
| sqlite+hybrid | 0.864 | 0.354 | 0.781 | 0.987 | 1.00 | 1.00 | 10.0 | 0.35 | 0.432 | 32 | 42 | 0.0 | 0.74 |

### locomo

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.442 | 0.126 | 0.466 | 0.533 | 0.80 | 1.00 | 17.3 | 0.09 | 0.221 | 20 | 29 | 0.0 | 0.63 |
| current+confidence | 0.251 | 0.063 | 0.232 | 0.368 | 0.51 | 1.00 | 9.6 | 0.08 | 0.126 | 20 | 26 | 0.0 | 0.72 |
| floor | 0.364 | 0.091 | 0.364 | 0.432 | 0.63 | 0.25 | 0.3 | 0.15 | 0.557 | 22 | 31 | 0.0 | 0.63 |
| floor+rrf | 0.419 | 0.114 | 0.436 | 0.529 | 0.77 | 0.25 | 0.5 | 0.13 | 0.585 | 20 | 27 | 0.0 | 0.62 |
| precached | 0.413 | 0.109 | 0.425 | 0.517 | 0.74 | 0.00 | 0.0 | 0.12 | 0.706 | 20 | 32 | 0.0 | 0.62 |
| postgres | 0.396 | 0.106 | 0.436 | 0.482 | 0.69 | 1.00 | 10.0 | 0.11 | 0.198 | 76 | 93 | 0.0 | 0.63 |
| postgres+hybrid | 0.432 | 0.123 | 0.469 | 0.515 | 0.83 | 1.00 | 10.0 | 0.12 | 0.216 | 92 | 110 | 0.0 | 0.63 |
| sqlite | 0.432 | 0.117 | 0.501 | 0.508 | 0.77 | 1.00 | 10.0 | 0.12 | 0.216 | 19 | 25 | 0.0 | 0.63 |
| sqlite+hybrid | 0.442 | 0.131 | 0.499 | 0.521 | 0.86 | 1.00 | 10.0 | 0.13 | 0.221 | 53 | 88 | 0.0 | 0.62 |

### scifact

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.655 | 0.093 | 0.833 | 0.612 | 0.83 | 1.00 | 17.5 | 0.06 | 0.328 | 26 | 33 | 0.0 | 0.71 |
| current+confidence | 0.383 | 0.050 | 0.483 | 0.363 | 0.50 | 1.00 | 8.6 | 0.06 | 0.192 | 26 | 35 | 0.0 | 0.83 |
| floor | 0.622 | 0.090 | 0.800 | 0.579 | 0.80 | 0.67 | 2.3 | 0.16 | 0.478 | 27 | 34 | 0.0 | 0.72 |
| floor+rrf | 0.630 | 0.090 | 0.800 | 0.591 | 0.80 | 0.83 | 4.6 | 0.12 | 0.399 | 31 | 60 | 0.0 | 0.72 |
| precached | 0.582 | 0.087 | 0.767 | 0.536 | 0.77 | 0.83 | 4.6 | 0.12 | 0.374 | 27 | 38 | 0.0 | 0.71 |
| postgres | 0.715 | 0.100 | 0.900 | 0.656 | 0.90 | 1.00 | 10.0 | 0.10 | 0.358 | 171 | 358 | 0.0 | 0.71 |
| postgres+hybrid | 0.781 | 0.107 | 0.967 | 0.734 | 0.97 | 1.00 | 10.0 | 0.11 | 0.390 | 170 | 344 | 0.0 | 0.72 |
| sqlite | 0.705 | 0.100 | 0.900 | 0.644 | 0.90 | 1.00 | 10.0 | 0.10 | 0.353 | 18 | 30 | 0.0 | 0.72 |
| sqlite+hybrid | 0.761 | 0.107 | 0.967 | 0.709 | 0.97 | 1.00 | 10.0 | 0.11 | 0.381 | 82 | 107 | 0.0 | 0.72 |

### wands

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.724 | 0.532 | 0.377 | 0.802 | 0.94 | 1.00 | 17.6 | 0.67 | 0.362 | 21 | 24 | 0.0 | 0.69 |
| current+confidence | 0.648 | 0.465 | 0.296 | 0.783 | 0.94 | 1.00 | 13.1 | 0.65 | 0.324 | 21 | 31 | 0.0 | 0.77 |
| floor | 0.561 | 0.445 | 0.278 | 0.673 | 0.77 | 0.14 | 0.7 | 0.79 | 0.709 | 21 | 29 | 0.0 | 0.68 |
| floor+rrf | 0.614 | 0.487 | 0.311 | 0.724 | 0.81 | 0.29 | 1.0 | 0.83 | 0.664 | 21 | 33 | 0.0 | 0.66 |
| precached | 0.606 | 0.484 | 0.310 | 0.696 | 0.77 | 0.29 | 1.0 | 0.78 | 0.660 | 21 | 26 | 0.0 | 0.67 |
| postgres | 0.622 | 0.481 | 0.320 | 0.703 | 0.84 | 1.00 | 10.0 | 0.69 | 0.311 | 58 | 95 | 0.0 | 0.69 |
| postgres+hybrid | 0.687 | 0.519 | 0.367 | 0.813 | 0.90 | 1.00 | 10.0 | 0.74 | 0.344 | 64 | 124 | 0.0 | 0.69 |
| sqlite | 0.602 | 0.481 | 0.319 | 0.619 | 0.84 | 1.00 | 10.0 | 0.69 | 0.301 | 13 | 20 | 0.0 | 0.69 |
| sqlite+hybrid | 0.679 | 0.513 | 0.365 | 0.807 | 0.90 | 1.00 | 10.0 | 0.74 | 0.339 | 66 | 80 | 0.0 | 0.68 |

## By query category

nDCG@10 for answerable categories, and the share answered with nothing (higher is better) for no-answer ones, pooled over the corpora.

| category | n | current | current+confidence | floor | floor+rrf | precached | postgres | postgres+hybrid | sqlite | sqlite+hybrid |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| answerable/claim | 30 | 0.66 | 0.38 | 0.62 | 0.63 | 0.58 | 0.72 | 0.78 | 0.71 | 0.76 |
| answerable/count | 4 | 0.56 | 0.12 | 0.00 | 0.00 | 0.00 | 0.80 | 0.73 | 0.74 | 0.74 |
| answerable/filter | 8 | 0.74 | 0.54 | 0.57 | 0.74 | 0.90 | 0.91 | 0.89 | 0.92 | 0.92 |
| answerable/lookup | 16 | 0.96 | 0.63 | 0.81 | 0.87 | 0.87 | 0.90 | 0.92 | 0.87 | 0.92 |
| answerable/multi-hop | 30 | 0.65 | 0.41 | 0.38 | 0.40 | 0.51 | 0.66 | 0.68 | 0.65 | 0.69 |
| answerable/open-domain | 3 | 0.15 | 0.00 | 0.15 | 0.15 | 0.21 | 0.05 | 0.15 | 0.05 | 0.13 |
| answerable/product-search | 31 | 0.72 | 0.65 | 0.56 | 0.61 | 0.61 | 0.62 | 0.69 | 0.60 | 0.68 |
| answerable/single-hop | 17 | 0.55 | 0.35 | 0.48 | 0.54 | 0.55 | 0.51 | 0.55 | 0.55 | 0.56 |
| answerable/temporal | 8 | 0.43 | 0.15 | 0.39 | 0.39 | 0.38 | 0.38 | 0.37 | 0.45 | 0.36 |
| answerable/topical | 7 | 0.97 | 0.75 | 0.97 | 0.97 | 0.97 | 0.97 | 0.97 | 0.97 | 0.97 |
| answerable/who-is | 5 | 0.86 | 0.20 | 0.86 | 0.86 | 0.86 | 0.86 | 0.86 | 0.86 | 0.86 |
| no-answer/absent | 8 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.25 | 0.00 | 0.13 | 0.00 |
| no-answer/absent-name | 1 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 |
| no-answer/held-out | 12 | 0.00 | 0.00 | 0.33 | 0.17 | 0.17 | 0.00 | 0.00 | 0.00 | 0.00 |
| no-answer/near-miss | 5 | 0.00 | 0.00 | 0.80 | 0.80 | 0.80 | 0.00 | 0.00 | 0.00 | 0.00 |
| no-answer/not-carried | 7 | 0.00 | 0.00 | 0.86 | 0.71 | 0.71 | 0.00 | 0.00 | 0.00 | 0.00 |
| no-answer/swapped-name | 12 | 0.00 | 0.00 | 0.75 | 0.75 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 |

## "Who is <absent name>"

Each corpus's "who is" query for a name it never mentions, answered by every strategy: how many entities came back, and the first three.

**people** - "who is sophia". A docket_search reply today also lists all 6 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Hannah Okoro", "Grace Wanjiru", "Tomás Silva", ...
- current+confidence: 5 - "Hannah Okoro", "Grace Wanjiru", "Partner Success", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- postgres: nothing
- postgres+hybrid: 10 - "Hannah Okoro", "Grace Wanjiru", "Tomás Silva", ...
- sqlite: nothing
- sqlite+hybrid: 10 - "Hannah Okoro", "Grace Wanjiru", "Tomás Silva", ...

**acme** - "who is sophia". A docket_search reply today also lists all 11 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Conversation API", "Support Session Store", "Orders Postgres", ...
- current+confidence: 1 - "Research Assistant"
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- postgres: nothing
- postgres+hybrid: 10 - "Conversation API", "Support Session Store", "Orders Postgres", ...
- sqlite: nothing
- sqlite+hybrid: 10 - "Conversation API", "Support Session Store", "Orders Postgres", ...

**crm** - "who is sophia". A docket_search reply today also lists all 10 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Call with Gemma Achebe, 2026-02-16", "Demo with Hugo Petrov, 2026-01-24", "Demo with Vera Schmidt, 2026-03-01", ...
- current+confidence: 8 - "Call with Gemma Achebe, 2026-02-16", "Demo with Hugo Petrov, 2026-01-24", "Demo with Vera Schmidt, 2026-03-01", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- postgres: nothing
- postgres+hybrid: 10 - "Call with Gemma Achebe, 2026-02-16", "Demo with Hugo Petrov, 2026-01-24", "Demo with Vera Schmidt, 2026-03-01", ...
- sqlite: nothing
- sqlite+hybrid: 10 - "Call with Gemma Achebe, 2026-02-16", "Demo with Hugo Petrov, 2026-01-24", "Demo with Vera Schmidt, 2026-03-01", ...

**locomo** - "who is sophia". A docket_search reply today also lists all 7 ontology types, 3 of them with no entities in this docket.

- current: 10 - "Gina is passionate about fashion trends and unique pieces, and she blended her love for…", "Gina lost her job, started an online clothing store, and enjoys being her own boss.", "Jolene is into reading, particularly enjoying the books "Sapiens" and "Avalanche" by…", ...
- current+confidence: 4 - "Jon and Gina, session 6 (2:35 pm on 16 March, 2023)", "Gina is part of a solid community that cheers Jon on.", "Jolene owns a pet named Seraphim, who brings comfort and cheer to her life.", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- postgres: nothing
- postgres+hybrid: 10 - "Gina is passionate about fashion trends and unique pieces, and she blended her love for…", "Gina lost her job, started an online clothing store, and enjoys being her own boss.", "Jon and Gina, session 6 (2:35 pm on 16 March, 2023)", ...
- sqlite: nothing
- sqlite+hybrid: 10 - "Gina is passionate about fashion trends and unique pieces, and she blended her love for…", "Gina lost her job, started an online clothing store, and enjoys being her own boss.", "Jolene is into reading, particularly enjoying the books "Sapiens" and "Avalanche" by…", ...

**scifact** - "who is sophia". A docket_search reply today also lists all 8 ontology types, 7 of them with no entities in this docket.

- current: 10 - "GATA3 transcription factor abrogates Smad4 transcription factor-mediated fascin overexpression, invadopodium formation, and breast cancer cell invasion.", "A central role for HER3 in HER2-amplified breast cancer: implications for targeted therapy.", "SSEA-1 is an enrichment marker for tumor-initiating cells in human glioblastoma.", ...
- current+confidence: 3 - "A central role for HER3 in HER2-amplified breast cancer: implications for targeted therapy.", "Feedback upregulation of HER3 (ErbB3) expression and activity attenuates antitumor effect of PI3K inhibitors.", "Orai1 and STIM1 are critical for breast tumor cell migration and metastasis."
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- postgres: nothing
- postgres+hybrid: 10 - "GATA3 transcription factor abrogates Smad4 transcription factor-mediated fascin overexpression, invadopodium formation, and breast cancer cell invasion.", "A central role for HER3 in HER2-amplified breast cancer: implications for targeted therapy.", "SSEA-1 is an enrichment marker for tumor-initiating cells in human glioblastoma.", ...
- sqlite: nothing
- sqlite+hybrid: 10 - "GATA3 transcription factor abrogates Smad4 transcription factor-mediated fascin overexpression, invadopodium formation, and breast cancer cell invasion.", "A central role for HER3 in HER2-amplified breast cancer: implications for targeted therapy.", "SSEA-1 is an enrichment marker for tumor-initiating cells in human glioblastoma.", ...

**wands** - "who is priya". A docket_search reply today also lists all 6 ontology types, 4 of them with no entities in this docket.

- current: 10 - "ariaya meditating buddha garden statue", "pancho villa and staff photographic print on wrapped canvas", "rohini neutral pouf", ...
- current+confidence: 9 - "ariaya meditating buddha garden statue", "pancho villa and staff photographic print on wrapped canvas", "rohini neutral pouf", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- postgres: nothing
- postgres+hybrid: 10 - "ariaya meditating buddha garden statue", "pancho villa and staff photographic print on wrapped canvas", "rohini neutral pouf", ...
- sqlite: nothing
- sqlite+hybrid: 10 - "ariaya meditating buddha garden statue", "pancho villa and staff photographic print on wrapped canvas", "rohini neutral pouf", ...

## Node confidence is not relevance

Over everything `current` returned for answerable queries (2430 entities), relevant ones average confidence 0.681 and irrelevant ones 0.676; the point-biserial correlation between confidence and relevance is 0.014. Confidence says how well an entity's evidence supports it, whatever was asked.

Dropping entities below the low-confidence line (`current+confidence`) keeps 0.64 of the relevant entities `current` returned and 0.50 of the irrelevant ones, and still answers 1.00 of no-answer queries with something.

## Speed

- Precached answers to repeated queries: p50 0.0 ms.
- docket's JSONL lexicalSearch re-tokenises every document on each query: people 0.2 ms, acme 0.2 ms, crm 3.5 ms, locomo 22 ms, scifact 172 ms, wands 50 ms (p50), against 0.0 ms, 0.0 ms, 0.2 ms, 0.6 ms, 1.3 ms, 0.4 ms with the prebuilt index every strategy here uses.
- Latency is per query on one machine, embedding the query included; agentic adds two local model calls.

## Calibrated floors

| strategy | cosine floor | coverage floor | dev nDCG@10 | dev FPR | dev reply precision | dev balanced |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| floor | 0.73 | 0.70 | 0.547 | 0.18 | 0.56 | 0.685 |
| floor+rrf | 0.70 | 0.80 | 0.577 | 0.21 | 0.52 | 0.682 |
| precached | 0.70 | 0.70 | 0.631 | 0.20 | 0.51 | 0.717 |

## Strategies

- **current**: Single pass: mem0-style semantic top 10, then full-text top 10, no floor - docket_search today.
- **current+confidence**: As current, dropping entities whose node confidence is below 0.7: the "drop low-confidence results" change.
- **floor**: As current, keeping semantic hits with cosine >= 0.73 and full-text hits covering >= 0.7 of the query's idf.
- **floor+rrf**: Relevance floor (cosine >= 0.7, coverage >= 0.8) on top 20 of each source, fused by reciprocal rank, top 10.
- **precached**: Sync-time link-aware embeddings and vocabulary; a query naming a word no entity holds returns nothing; otherwise floor (cosine >= 0.7, coverage >= 0.7) and RRF, top 10. Repeated queries come from a cache.
- **postgres**: Postgres through @docket/adapter-postgres: full-text (websearch_to_tsquery, BM25 over title, type and tags, body) with the trigram title lift, top 10, no floor.
- **postgres+hybrid**: As postgres, fused by reciprocal rank with pgvector cosine similarity of the same embeddings as semantic, top 10, no floor.
- **sqlite**: SQLite through @docket/adapter-sqlite: FTS5 BM25 with Lucene idf over title, type and tags, body, Porter-stemmed, top 10, no floor.
- **sqlite+hybrid**: As sqlite, fused by reciprocal rank with cosine similarity of the same embeddings as semantic, top 10, no floor.
