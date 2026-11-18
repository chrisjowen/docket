# @docket/adapter-sqlite

docket's SQLite adapter: entities and their links in one SQLite file, which
needs no server, searched by FTS5 full-text - and, with an embedder, by
meaning - and answered with the best paths from each match through the links,
found by a recursive query.

It is an **opt-in** index. docket's default, the `jsonl` adapter, needs no
database at all and stays the default everywhere, `docket init` included; add
this one when you want ranked full-text search and graph answers from a
single local file:

```bash
docket adapter add sqlite   # asks for a file (default: in its own state directory) and an optional embedding model
```

Its default export is the `AdapterDefinition`
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7). Its configuration is
an instance's `config` in a version 2 `.docket.yaml`: `file`, `scope`,
`semantic`, `search` and `traverse`. Any other field is rejected.
`better-sqlite3` is its dependency, imported only when an instance is created.

A private workspace package: it is not published on its own.
`@chrisjowen/docket` bundles it into `dist/bundled/adapter-sqlite`, exports it
as `@chrisjowen/docket/adapters/sqlite`, and keeps `better-sqlite3` an optional
peer dependency (`pnpm add better-sqlite3`; it ships prebuilt binaries for the
usual platforms).

## Requirements

- **better-sqlite3** installed next to docket. Its SQLite has FTS5 and the
  math functions the ranking uses.
- **An Ollama embedding model**, only for semantic search: `nomic-embed-text`
  by default. No SQLite extension is needed: vectors are stored as 32-bit
  floats and compared in the adapter one by one, which suits up to tens of
  thousands of entities. sqlite-vec was not needed for that, so it is not
  used.

## Configuration

```yaml
adapters:
  - id: sqlite
    module: "@docket/adapter-sqlite"
    config:
      # file: .docket/.index/docket.sqlite   # default: index.sqlite in .docket/.index/adapters/<id>/
      # scope: payments-project              # default: one unique to the checkout
      # semantic:                            # search by meaning too
      #   model: nomic-embed-text            # default; an Ollama embedding model
      #   url: http://localhost:11434        # default
      #   dimensions: 768                    # default, nomic-embed-text's; set it to another model's
      # search: hybrid                       # lexical, semantic or hybrid; hybrid by default with semantic, else lexical
      # traverse:                            # how far an answer reaches from each match
      #   hops: 2                            # default; 1 or 2
      #   minConfidence: 0                   # default
      #   rels: [depends_on, owned_by]       # default: every link
```

The file is in WAL mode, so `docket open` and the CLI can read it while a sync
writes. Every row carries the instance's `scope`, so checkouts can share a
file; `docket rebuild` deletes only its own.

## Tables

All derived and rebuildable from the canonical files:

| Table | Holds |
|---|---|
| `entities` | One row per entity: type, title, tags, body, attributes, revision, confidence, and which of full-text, graph and embedding it takes part in. |
| `entities_fts` | FTS5 over title, type and tags, and body, stemmed by Porter's English stemmer, one row per entity searched by full-text. |
| `edges` | One row per (source, rel, target) a graph entity links. A target need not be projected: it is a stub until it is. |
| `embeddings` | With `semantic`: one vector per entity, with the model and text hash it was computed from, so only what changed is re-embedded. |
| `migrations` | The steps applied, each once. |

## Search

- **lexical** (the default): each word of the query worth matching (not a stop
  word or a single letter), quoted, any of them - as Neo4j's full-text search
  ORs a question's words - ranked by BM25 with the title weighted 5, the type
  and tags 2 and the body 1, and Lucene's idf, as Neo4j's full-text search
  ranks. FTS5's own `bm25` counts a word in more than half the rows as all but
  worthless (an idf of 1e-6), which in a small docket is most of the words that
  matter, so each word is ranked alone and reweighed by Lucene's idf, ln(1 +
  (N - n + 0.5) / (n + 0.5)), counted over the whole file.
- **semantic**: cosine similarity between the query's embedding and each
  entity's.
- **hybrid**: both, fused by reciprocal rank.

There is no title trigram lift as in the Postgres adapter. docket-server's
search fusion reads a `sqlite` instance's scores as a `lexical` signal; name an
instance set to `search: semantic` in `signals` to have them read as
`semantic`.

## Answers through the graph

As the Postgres adapter's: the search's matches and, from each, its best paths
of up to two links in either direction, ranked by the product of their links'
confidence over the log of their end's degree, three per match - the rules
Neo4j's adapter follows, held to the same `GRAPH_PATH_FIXTURE` in adapter-kit.
The query is one recursive CTE over `edges`, its paths kept as JSON arrays.

## How it compares

From the search evaluation's run on all six corpora
([RESULTS-postgres-sqlite.md](../docket/eval/search/RESULTS-postgres-sqlite.md),
`nomic-embed-text` through Ollama), each synced through this adapter and asked
through its `ask`, top 10 and no floor. `current` is the evaluation's stand-in
for Neo4j full-text plus mem0 (BM25 and cosine similarity of the same
embeddings, each source's top 10), which is what Docket Cloud searches with
today. nDCG@10 on the held-out test queries, and the median time per query on
an M-series laptop, the query's embedding included:

| corpus (entities) | current | sqlite | sqlite+hybrid |
| --- | ---: | ---: | ---: |
| people (20) | 0.932 | 0.896 | 0.896 |
| acme (21) | 0.817 | 0.809 | 0.839 |
| crm (1,044) | 0.817 | 0.848 | 0.864 |
| locomo (2,733) | 0.442 | 0.432 | 0.442 |
| scifact (5,163) | 0.655 | 0.705 | 0.761 |
| wands (4,289) | 0.724 | 0.602 | 0.679 |
| **macro average** | **0.731** | **0.715** | **0.747** |
| p50 ms | 21 | 10 | 48 |

- Full-text alone (`sqlite`) ranks nearly as well as Neo4j full-text and mem0
  together (0.715 against 0.731) in half the time, and hybrid search ranks
  better (0.747).
- Full-text alone answers fewer of the no-answer questions ("who is sophia")
  with anything (false-positive rate 0.89 against 1.00); with embeddings, like
  any top-k by similarity, it answers every one. Neither has a relevance floor.
- Syncing the largest corpus took 3.5 s for full-text and 235 s with
  embeddings, almost all of it Ollama embedding 5,163 abstracts. Comparing
  every vector in the adapter, a hybrid query there took 82 ms at the median
  (107 ms at p95), the query's embedding included.

## Tests

`src/sqlite-projection.test.ts` runs in every `pnpm test`, each test in a
temporary directory: nothing to start first. docket's adapter contract test
(`packages/docket/src/adapters/contract.test.ts`) runs it too.
