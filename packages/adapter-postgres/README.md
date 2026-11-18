# @docket/adapter-postgres

docket's Postgres adapter: entities and their links in tables of its own in
Postgres 16 or later, searched by full-text and title trigrams - and, with
pgvector and an embedder, by meaning - and answered with the best paths from
each match through the links, found by a recursive query.

It is an **opt-in** index. docket's default, the `jsonl` adapter, needs no
database at all and stays the default everywhere, `docket init` included; add
this one when you want a full-text and graph index in a Postgres you already
run, without Neo4j, mem0 or Qdrant:

```bash
docket adapter add postgres   # asks for the URL variable, schema, scope and an optional embedding model
```

Its default export is the `AdapterDefinition`
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7). Its configuration is
an instance's `config` in a version 2 `.docket.yaml`: `url` or `urlEnv`,
`passwordEnv`, `schema`, `scope`, `language`, `trigram`, `semantic`, `search`
and `traverse`. Any other field is rejected. `pg` is its dependency, imported
only when an instance is created.

A private workspace package: it is not published on its own.
`@chrisjowen/docket` bundles it into `dist/bundled/adapter-postgres`, exports it
as `@chrisjowen/docket/adapters/postgres`, and keeps `pg` an optional peer
dependency.

## Requirements

- **Postgres 16 or later.** The adapter refuses an older server when it opens.
- **A role that may create a schema** in the database, or a schema created for
  it beforehand. The tables are its own, in the schema named by `schema`
  (`docket_index` by default), migrated forward when an instance opens.
- **pg_trgm** for the title lift. It is a trusted extension, so the adapter
  adds it when the role may create in the database; without it, titles are
  not lifted and search is otherwise the same.
- **pgvector**, only for semantic search. It usually needs a superuser to add:
  run `CREATE EXTENSION vector` once, or run Postgres from an image that has
  it, such as `pgvector/pgvector:pg17`. With `semantic` set and no pgvector,
  the instance fails to open and says so.
- **An Ollama embedding model**, only for semantic search: `nomic-embed-text`
  by default, the model Docket Cloud embeds with.

A local server for trying it out:

```bash
docker run -d --name docket-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_PASSWORD=change-me pgvector/pgvector:pg17
export DOCKET_POSTGRES_URL=postgres://postgres:change-me@127.0.0.1:5432/postgres
```

## Configuration

```yaml
adapters:
  - id: postgres
    module: "@docket/adapter-postgres"
    config:
      urlEnv: DOCKET_POSTGRES_URL     # the connection URL, password included, from the environment
      # url: postgres://docket@db.internal:5432/docket   # or the URL itself, without a password
      # passwordEnv: DOCKET_POSTGRES_PASSWORD             # with url: the password, from the environment
      # schema: docket_index          # default; created when missing
      # scope: payments-project       # default: one unique to the checkout
      # language: english             # default; any text search configuration, e.g. simple, german
      # trigram: true                 # default; lift titles close to the query through pg_trgm
      # semantic:                     # search by meaning too; needs pgvector
      #   model: nomic-embed-text     # default; an Ollama embedding model
      #   url: http://localhost:11434 # default
      #   dimensions: 768             # default, nomic-embed-text's; set it to another model's
      #   prefixes: { document: "search_document: ", query: "search_query: " }  # default for nomic-embed-text only
      # search: hybrid                # lexical, semantic or hybrid; hybrid by default with semantic, else lexical
      # traverse:                     # how far an answer reaches from each match
      #   hops: 2                     # default; 1 or 2
      #   minConfidence: 0            # default; follow only links this well supported
      #   rels: [depends_on, owned_by]  # default: every link
```

With neither `url` nor `urlEnv`, the connection comes from the libpq
environment (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`), as `psql`
reads it. Secrets are only ever read from the environment.

Every row carries the instance's `scope`, by default
`docket-<checkout directory>-<hash>` as for Neo4j and mem0, so checkouts can
share one database. `docket rebuild` (`reset`) deletes only its own scope.

## Tables

All derived and rebuildable from the canonical files, in `schema`:

| Table | Holds |
|---|---|
| `entities` | One row per entity: type, title, tags, body, attributes, revision, confidence, which of full-text, graph and embedding it takes part in (`index.fts`, `index.graph`, `index.vector`), its full-text vector - title weighted A, type and tags B, body C - and how many words that holds. A GIN index answers full-text queries, a trigram GIN index the title lift. |
| `edges` | One row per (source, rel, target) a graph entity links, with confidence, corroborating sources, attributes and evidence. A target need not be projected: it is a stub until it is. |
| `embeddings` | With `semantic` only: one vector per entity, with the model and the text hash it was computed from, so a changed entity or model is re-embedded at the next sync and nothing else is. An HNSW index per vector size (up to 2,000 dimensions). |
| `scopes` | The text search configuration each scope's vectors were built with: changing `language` rebuilds them when the instance next opens. |
| `migrations` | The steps applied, so each runs once, under an advisory lock. |

## Search

- **lexical** (the default): `websearch_to_tsquery` reads the query - quoted
  phrases, `or`, `-word` to exclude - in `language`, stemming and dropping stop
  words; each remaining AND is loosened to OR, as Neo4j's full-text search ORs a
  question's words, so a match need not hold them all and one with more ranks
  higher. Matches rank by BM25, as Lucene - and so Neo4j - and SQLite's FTS5
  rank: each of the query's lexemes counts its idf, ln(1 + (N - n + 0.5) /
  (n + 0.5)) over the scope's entities, times its frequency in the entity - 5
  in the title, 2 in the type or tags, 1 in the body - saturated (k1 1.2) and
  weighed by the entity's length against the scope's average (b 0.75). A word
  in most entities counts for little, a rare one for a lot. With pg_trgm, a title close to some run of
  the query's words (word similarity at least 0.6) adds that similarity, and a
  title close to the whole query is a match even when no word matches exactly:
  names, and names misspelt.
- **semantic**: cosine similarity between the query's embedding and each
  entity's, through the HNSW index.
- **hybrid**: both, fused by reciprocal rank.

A hit's score is its rank's own (BM25 plus the lift, cosine
similarity, or the fused reciprocal rank), comparable only within one search.
docket-server's search fusion reads a `postgres` instance's scores as a
`lexical` signal, as it does Neo4j's full-text score; name an instance set to
`search: semantic` in `signals` to have them read as `semantic`.

## Answers through the graph

`ask` answers with the search's matches and, from each, its best paths
through the links, found by one recursive query over `edges`: up to
`traverse.hops` links (2 by default, at most 2) in either direction, each of
confidence at least `traverse.minConfidence` and, when set, of a `rel` in
`traverse.rels`, never visiting an entity twice. A path ranks by the product of
its links' confidence divided by the log of its end's degree, so the
best-connected entities do not end every path; each match keeps its best
three, less any path another one extends. These are the rules Neo4j's
adapter follows, so the same graph gives the same paths: adapter-kit's
`GRAPH_PATH_FIXTURE` holds the paths Neo4j keeps for a fixture graph, and both
adapters' integration suites are held to it.

The answer is an entities block of the matches, a graph block of the paths -
every link in its stored direction with its confidence - and a passages block
of what each match says. Each path is a derived fact citing the entities on
it: `service.orders -depends_on-> service.ledger (0.95, code+manifest)`. The
entities a path reaches are context, never matches.

## How it compares

From the search evaluation's run on all six corpora
([RESULTS-postgres-sqlite.md](../docket/eval/search/RESULTS-postgres-sqlite.md),
Postgres 17 with pgvector 0.8, `nomic-embed-text` through Ollama), each
synced through this adapter and asked through its `ask`, top 10 and no floor.
`current` is the evaluation's stand-in for Neo4j full-text plus mem0 (BM25 and
cosine similarity of the same embeddings, each source's top 10), which is what
Docket Cloud searches with today. nDCG@10 on the held-out test queries, and the
median time per query on an M-series laptop, the query's embedding included:

| corpus (entities) | current | postgres | postgres+hybrid |
| --- | ---: | ---: | ---: |
| people (20) | 0.932 | 0.896 | 0.896 |
| acme (21) | 0.817 | 0.878 | 0.864 |
| crm (1,044) | 0.817 | 0.841 | 0.854 |
| locomo (2,733) | 0.442 | 0.396 | 0.432 |
| scifact (5,163) | 0.655 | 0.715 | 0.781 |
| wands (4,289) | 0.724 | 0.622 | 0.687 |
| **macro average** | **0.731** | **0.725** | **0.752** |
| p50 ms | 21 | 60 | 71 |

- Full-text alone (`postgres`) ranks about as well as Neo4j full-text and mem0
  together (0.725 against 0.731), and hybrid search ranks best of the three
  (0.752), ahead on four of the six corpora.
- Full-text alone answers fewer of the no-answer questions ("who is sophia")
  with anything (false-positive rate 0.83 against 1.00), since a question none
  of whose words appear finds nothing; with embeddings, like any top-k by
  similarity, it answers every one. Neither has a relevance floor.
- Its times include the round trip to Postgres and the answer's graph query;
  `current` is an in-memory stand-in. Syncing the largest corpus took 17 s for
  full-text and 273 s with embeddings, almost all of it Ollama embedding 5,163
  abstracts.

## Integration tests

`src/postgres-projection.integration.test.ts` runs against a real server when
`DOCKET_TEST_PG_URL` names a role that may create databases; each suite makes
a database of its own and drops it afterwards. Without it the suites are
skipped, except in CI, where that fails the run. The semantic suite also needs
pgvector there, and is skipped without it, so CI runs the
`pgvector/pgvector:pg17` image.

```bash
docker run -d --name docket-pg-test -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg17
DOCKET_TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter @docket/adapter-postgres test
```

docket's adapter contract test (`packages/docket/src/adapters/contract.test.ts`)
runs this adapter too when `DOCKET_TEST_PG_URL` is set.
