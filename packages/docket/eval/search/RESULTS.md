# Search evaluation results

Run 2026-11-12 16:32 UTC. Embedder ollama:nomic-embed-text; agentic model ollama:qwen2.5:7b. Every number is on the held-out test half of the queries; the relevance floors were tuned on the other half. See [README.md](README.md) for the datasets, the strategies and what each metric means.

## Corpora

| corpus | domain | template | entities | links | types (with entities) | test queries (no-answer) | sync ms | embed ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| people | people and organisations | people-org | 20 | 33 | 6 (6) | 6 (3) | 96 | 12 |
| acme | SDLC | sdlc | 21 | 37 | 11 (11) | 24 (3) | 45 | 7.6 |
| crm | CRM | crm | 1044 | 2844 | 10 (10) | 47 (8) | 336 | 15 |
| locomo | personal knowledge | personal-knowledge | 2733 | 5450 | 7 (4) | 47 (12) | 710 | 72138 |
| scifact | research | research | 5163 | 0 | 8 (1) | 42 (12) | 1307 | 264238 |
| wands | product catalogue | product-catalogue | 4289 | 4131 | 6 (2) | 38 (7) | 1229 | 162856 |

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
| current | 0.733 | 0.241 | 0.721 | 0.794 | 0.92 | 1.00 | 14.5 | 0.23 | 0.367 | 20 | 36 | 0.0 | 0.68 |
| current+confidence | 0.473 | 0.164 | 0.418 | 0.581 | 0.66 | 1.00 | 7.8 | 0.26 | 0.236 | 17 | 22 | 0.0 | 0.82 |
| floor | 0.517 | 0.177 | 0.479 | 0.582 | 0.66 | 0.16 | 0.6 | 0.56 | 0.677 | 18 | 24 | 0.0 | 0.71 |
| floor+rrf | 0.493 | 0.166 | 0.450 | 0.573 | 0.65 | 0.19 | 0.6 | 0.56 | 0.653 | 20 | 36 | 0.0 | 0.71 |
| precached | 0.632 | 0.208 | 0.608 | 0.712 | 0.82 | 0.21 | 1.0 | 0.47 | 0.712 | 15 | 23 | 0.0 | 0.69 |
| agentic | 0.574 | 0.160 | 0.468 | 0.693 | 0.73 | 0.36 | 0.5 | 0.69 | 0.606 | 7250 | 9321 | 2.0 | 0.68 |

## By corpus

### people

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.932 | 0.167 | 1.000 | 1.000 | 1.00 | 1.00 | 10.0 | 0.15 | 0.466 | 12 | 59 | 0.0 | 0.74 |
| current+confidence | 0.599 | 0.100 | 0.667 | 0.667 | 0.67 | 1.00 | 5.0 | 0.14 | 0.299 | 14 | 17 | 0.0 | 0.83 |
| floor | 0.333 | 0.033 | 0.333 | 0.333 | 0.33 | 0.00 | 0.0 | 1.00 | 0.667 | 14 | 20 | 0.0 | 0.85 |
| floor+rrf | 0.333 | 0.033 | 0.333 | 0.333 | 0.33 | 0.00 | 0.0 | 1.00 | 0.667 | 19 | 31 | 0.0 | 0.85 |
| precached | 0.803 | 0.133 | 0.833 | 1.000 | 1.00 | 0.00 | 0.0 | 0.80 | 0.902 | 0.0 | 16 | 0.0 | 0.80 |
| agentic | 0.942 | 0.133 | 0.833 | 1.000 | 1.00 | 0.00 | 0.0 | 1.00 | 0.971 | 4292 | 5649 | 2.0 | 0.72 |

### acme

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.852 | 0.195 | 0.937 | 0.873 | 1.00 | 1.00 | 11.7 | 0.17 | 0.426 | 14 | 18 | 0.0 | 0.57 |
| current+confidence | 0.412 | 0.067 | 0.369 | 0.595 | 0.62 | 1.00 | 2.3 | 0.37 | 0.206 | 14 | 17 | 0.0 | 0.94 |
| floor | 0.545 | 0.095 | 0.560 | 0.643 | 0.71 | 0.00 | 0.0 | 0.63 | 0.772 | 13 | 24 | 0.0 | 0.63 |
| floor+rrf | 0.512 | 0.090 | 0.512 | 0.619 | 0.67 | 0.00 | 0.0 | 0.63 | 0.756 | 14 | 18 | 0.0 | 0.63 |
| precached | 0.580 | 0.114 | 0.631 | 0.611 | 0.71 | 0.00 | 0.0 | 0.56 | 0.790 | 11 | 16 | 0.0 | 0.61 |
| agentic | 0.616 | 0.119 | 0.603 | 0.714 | 0.76 | 0.00 | 0.0 | 0.68 | 0.808 | 4746 | 5945 | 2.0 | 0.58 |

### crm

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.812 | 0.338 | 0.749 | 0.987 | 1.00 | 1.00 | 14.8 | 0.26 | 0.406 | 18 | 39 | 0.0 | 0.74 |
| current+confidence | 0.551 | 0.221 | 0.471 | 0.795 | 0.82 | 1.00 | 9.0 | 0.28 | 0.275 | 14 | 21 | 0.0 | 0.82 |
| floor | 0.791 | 0.333 | 0.711 | 0.936 | 0.95 | 0.00 | 0.0 | 0.61 | 0.895 | 16 | 23 | 0.0 | 0.74 |
| floor+rrf | 0.745 | 0.305 | 0.645 | 0.936 | 0.95 | 0.00 | 0.0 | 0.60 | 0.873 | 16 | 22 | 0.0 | 0.74 |
| precached | 0.808 | 0.323 | 0.683 | 0.910 | 0.92 | 0.13 | 0.4 | 0.46 | 0.841 | 16 | 21 | 0.0 | 0.74 |
| agentic | 0.796 | 0.279 | 0.596 | 0.936 | 0.95 | 0.38 | 0.5 | 0.93 | 0.710 | 6970 | 8298 | 2.0 | 0.74 |

### locomo

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.427 | 0.106 | 0.388 | 0.533 | 0.74 | 1.00 | 17.0 | 0.09 | 0.214 | 20 | 33 | 0.0 | 0.62 |
| current+confidence | 0.244 | 0.060 | 0.218 | 0.346 | 0.49 | 1.00 | 8.7 | 0.07 | 0.122 | 18 | 25 | 0.0 | 0.72 |
| floor | 0.342 | 0.077 | 0.328 | 0.410 | 0.54 | 0.17 | 0.2 | 0.15 | 0.587 | 19 | 26 | 0.0 | 0.62 |
| floor+rrf | 0.304 | 0.066 | 0.279 | 0.381 | 0.51 | 0.17 | 0.2 | 0.13 | 0.569 | 20 | 26 | 0.0 | 0.62 |
| precached | 0.413 | 0.109 | 0.425 | 0.517 | 0.74 | 0.00 | 0.0 | 0.12 | 0.706 | 18 | 24 | 0.0 | 0.62 |
| agentic | 0.290 | 0.063 | 0.230 | 0.367 | 0.49 | 0.75 | 1.3 | 0.25 | 0.270 | 8640 | 11609 | 2.0 | 0.61 |

### scifact

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.645 | 0.097 | 0.867 | 0.586 | 0.87 | 1.00 | 17.4 | 0.06 | 0.322 | 30 | 35 | 0.0 | 0.72 |
| current+confidence | 0.379 | 0.050 | 0.483 | 0.358 | 0.50 | 1.00 | 9.3 | 0.06 | 0.190 | 24 | 30 | 0.0 | 0.83 |
| floor | 0.539 | 0.077 | 0.667 | 0.509 | 0.67 | 0.67 | 2.4 | 0.19 | 0.436 | 24 | 28 | 0.0 | 0.72 |
| floor+rrf | 0.536 | 0.077 | 0.667 | 0.507 | 0.67 | 0.67 | 2.4 | 0.20 | 0.435 | 25 | 31 | 0.0 | 0.72 |
| precached | 0.582 | 0.087 | 0.767 | 0.536 | 0.77 | 0.83 | 4.6 | 0.12 | 0.374 | 24 | 30 | 0.0 | 0.71 |
| agentic | 0.320 | 0.033 | 0.317 | 0.333 | 0.33 | 0.33 | 0.3 | 0.43 | 0.494 | 10017 | 11328 | 2.0 | 0.73 |

### wands

| strategy | nDCG@10 | P@10 | R@10 | MRR | hit@10 | no-answer FPR | returned on no-answer | reply precision | balanced | p50 ms | p95 ms | LLM calls | mean confidence (not relevance) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 0.731 | 0.545 | 0.388 | 0.788 | 0.90 | 1.00 | 16.0 | 0.68 | 0.366 | 23 | 32 | 0.0 | 0.69 |
| current+confidence | 0.652 | 0.484 | 0.300 | 0.728 | 0.87 | 1.00 | 12.7 | 0.66 | 0.326 | 21 | 25 | 0.0 | 0.77 |
| floor | 0.552 | 0.445 | 0.274 | 0.662 | 0.77 | 0.14 | 0.9 | 0.79 | 0.704 | 20 | 22 | 0.0 | 0.69 |
| floor+rrf | 0.530 | 0.426 | 0.268 | 0.660 | 0.77 | 0.29 | 1.0 | 0.80 | 0.622 | 28 | 88 | 0.0 | 0.68 |
| precached | 0.606 | 0.484 | 0.310 | 0.696 | 0.77 | 0.29 | 1.0 | 0.78 | 0.660 | 21 | 30 | 0.0 | 0.67 |
| agentic | 0.479 | 0.329 | 0.230 | 0.806 | 0.87 | 0.71 | 1.1 | 0.85 | 0.382 | 8834 | 13099 | 2.0 | 0.68 |

## By query category

nDCG@10 for answerable categories, and the share answered with nothing (higher is better) for no-answer ones, pooled over the corpora.

| category | n | current | current+confidence | floor | floor+rrf | precached | agentic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| answerable/claim | 30 | 0.64 | 0.38 | 0.54 | 0.54 | 0.58 | 0.32 |
| answerable/count | 4 | 0.67 | 0.12 | 0.00 | 0.00 | 0.00 | 0.25 |
| answerable/filter | 8 | 0.93 | 0.68 | 0.93 | 0.93 | 0.90 | 0.82 |
| answerable/lookup | 16 | 0.93 | 0.62 | 0.75 | 0.72 | 0.87 | 0.77 |
| answerable/multi-hop | 30 | 0.63 | 0.38 | 0.45 | 0.38 | 0.51 | 0.61 |
| answerable/open-domain | 3 | 0.10 | 0.00 | 0.10 | 0.10 | 0.21 | 0.00 |
| answerable/product-search | 31 | 0.73 | 0.65 | 0.55 | 0.53 | 0.61 | 0.48 |
| answerable/single-hop | 17 | 0.53 | 0.34 | 0.48 | 0.41 | 0.55 | 0.43 |
| answerable/temporal | 8 | 0.36 | 0.14 | 0.34 | 0.32 | 0.38 | 0.11 |
| answerable/topical | 7 | 0.97 | 0.75 | 0.97 | 0.97 | 0.97 | 0.92 |
| answerable/who-is | 5 | 0.86 | 0.20 | 0.86 | 0.86 | 0.86 | 0.86 |
| no-answer/absent | 8 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.75 |
| no-answer/absent-name | 1 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| no-answer/held-out | 12 | 0.00 | 0.00 | 0.33 | 0.33 | 0.17 | 0.67 |
| no-answer/near-miss | 5 | 0.00 | 0.00 | 1.00 | 1.00 | 0.80 | 0.80 |
| no-answer/not-carried | 7 | 0.00 | 0.00 | 0.86 | 0.71 | 0.71 | 0.29 |
| no-answer/swapped-name | 12 | 0.00 | 0.00 | 0.83 | 0.83 | 1.00 | 0.25 |

## "Who is <absent name>"

Each corpus's "who is" query for a name it never mentions, answered by every strategy: how many entities came back, and the first three.

**people** - "who is sophia". A docket_search reply today also lists all 6 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Hannah Okoro", "Grace Wanjiru", "Tomás Silva", ...
- current+confidence: 5 - "Hannah Okoro", "Grace Wanjiru", "Ravi Menon", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- agentic: nothing

**acme** - "who is sophia". A docket_search reply today also lists all 11 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Conversation API", "Orders Postgres", "Support Session Store", ...
- current+confidence: 2 - "Research Assistant", "Host the Research Assistant on Databricks"
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- agentic: nothing

**crm** - "who is sophia". A docket_search reply today also lists all 10 ontology types, 0 of them with no entities in this docket.

- current: 10 - "Call with Gemma Achebe, 2026-02-16", "Call with Gemma Achebe, 2026-04-19", "Demo with Yara Moreau, 2026-01-20", ...
- current+confidence: 8 - "Call with Gemma Achebe, 2026-02-16", "Call with Gemma Achebe, 2026-04-19", "Demo with Yara Moreau, 2026-01-20", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- agentic: nothing

**locomo** - "who is sophia". A docket_search reply today also lists all 7 ontology types, 3 of them with no entities in this docket.

- current: 10 - "Gina has been to Rome once.", "Pixie has been keeping Audrey busy since they adopted her.", "Gina has developed a video presentation to teach how to style her fashion pieces.", ...
- current+confidence: 2 - "Gina has developed a video presentation to teach how to style her fashion pieces.", "Gina got noticed by fashion editors last week."
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- agentic: 7 - "Gina owns a store where she sells fashion pieces.", "Gina lost her job, started an online clothing store, and enjoys being her own boss.", "Gina is passionate about fashion trends and unique pieces, and she blended her love for…", ...

**scifact** - "who is sophia". A docket_search reply today also lists all 8 ontology types, 7 of them with no entities in this docket.

- current: 10 - "A central role for HER3 in HER2-amplified breast cancer: implications for targeted therapy.", "The Association between Single-Nucleotide Polymorphisms of ORAI1 Gene and Breast Cancer in a Taiwanese Population", "Genome-wide analysis of estrogen receptor binding sites", ...
- current+confidence: 4 - "A central role for HER3 in HER2-amplified breast cancer: implications for targeted therapy.", "Influence of CYP2D6 Polymorphisms on Serum Levels of Tamoxifen Metabolites in Spanish Women with Breast Cancer", "Orai1 and STIM1 are critical for breast tumor cell migration and metastasis.", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- agentic: nothing

**wands** - "who is priya". A docket_search reply today also lists all 6 ontology types, 4 of them with no entities in this docket.

- current: 10 - "ariaya meditating buddha garden statue", "rohini neutral pouf", "pancho villa and staff photographic print on wrapped canvas", ...
- current+confidence: 9 - "ariaya meditating buddha garden statue", "rohini neutral pouf", "pancho villa and staff photographic print on wrapped canvas", ...
- floor: nothing
- floor+rrf: nothing
- precached: nothing
- agentic: nothing

## Node confidence is not relevance

Over everything `current` returned for answerable queries (2404 entities), relevant ones average confidence 0.682 and irrelevant ones 0.675; the point-biserial correlation between confidence and relevance is 0.020. Confidence says how well an entity's evidence supports it, whatever was asked.

Dropping entities below the low-confidence line (`current+confidence`) keeps 0.65 of the relevant entities `current` returned and 0.50 of the irrelevant ones, and still answers 1.00 of no-answer queries with something.

## Speed

- Precached answers to repeated queries: p50 0.0 ms.
- docket's JSONL lexicalSearch re-tokenises every document on each query: people 0.1 ms, acme 0.2 ms, crm 2.7 ms, locomo 15 ms, scifact 115 ms, wands 30 ms (p50), against 0.0 ms, 0.0 ms, 0.2 ms, 0.3 ms, 1.1 ms, 0.2 ms with the prebuilt index every strategy here uses.
- Latency is per query on one machine, embedding the query included; agentic adds two local model calls.

## Calibrated floors

| strategy | cosine floor | coverage floor | dev balanced |
| --- | ---: | ---: | ---: |
| floor | 0.71 | 0.70 | 0.704 |
| floor+rrf | 0.71 | 0.80 | 0.701 |
| precached | 0.70 | 0.70 | 0.712 |

## Strategies

- **current**: Single pass: mem0-style semantic top 10, then full-text top 10, no floor - docket_search today.
- **current+confidence**: As current, dropping entities whose node confidence is below 0.7: the "drop low-confidence results" change.
- **floor**: As current, keeping semantic hits with cosine >= 0.71 and full-text hits covering >= 0.7 of the query's idf.
- **floor+rrf**: Relevance floor (cosine >= 0.71, coverage >= 0.8) on top 20 of each source, fused by reciprocal rank, top 10.
- **precached**: Sync-time link-aware embeddings and vocabulary; a query naming a word no entity holds returns nothing; otherwise floor (cosine >= 0.7, coverage >= 0.7) and RRF, top 10. Repeated queries come from a cache.
- **agentic**: ollama:qwen2.5:7b plans 1-3 searches and whether to follow links, the single-pass sources run them (RRF), and ollama:qwen2.5:7b judges which candidates answer the question.
