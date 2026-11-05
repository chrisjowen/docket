# @docket/adapter-neo4j

docket's Neo4j adapter: one `(:Memory:<Type>)` node per entity and one typed
relationship per (source, rel, target), with a full-text index. A question is
answered by one query the adapter writes itself - the full-text matches and the
best paths from each, ranked by their relationships' confidence - or, with a
model, through a hand-written query template the model chooses and fills in,
or failing that a read-only Cypher query the model writes. The model is the
local Ollama model `cypher` names, or, when `cypher` is unset, the `cypher`
model docket offers (`AdapterServices.models.cypher`), if it offers one.

Its default export is the `AdapterDefinition`
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7). Its configuration is
an instance's `config` in a version 2 `.docket.yaml`, or a v1 `projections`
entry of `type: neo4j`: `uri` (or v1's `url`), `database`, `username`,
`passwordEnv`, `scope`, `traverse` and `cypher`. Any other field is rejected. `neo4j-driver` is its dependency,
imported only when an instance is created.

A private workspace package: it is not published on its own.
`@chrisjowen/docket` bundles it into `dist/bundled/adapter-neo4j`, and keeps
`neo4j-driver` an optional peer dependency.

## Search without a model

`src/subgraph-search.ts` holds the query and how its rows become an answer. One
round trip finds the full-text matches in scope and, for each, its paths of up
to `traverse.hops` relationships (default 2) in either direction, each of
confidence at least `traverse.minConfidence` (default 0) and, when set, of a
`rel` in `traverse.rels`. A path ranks by the product of its relationships'
confidence divided by the log of its end node's degree, so the best-connected
nodes do not end every path; each match keeps its best three, less any path
another one extends.

The answer is an entities block of the matches with their Lucene scores, a
graph block of the paths - every relationship in its stored direction with its
stored confidence - and a passages block of what each match says. Each path is
a derived fact citing the entities on it, the "why" its relationships hold:
`service.orders -depends_on-> service.ledger (0.95, code+manifest)`. The nodes
a path reaches are context, never matches. The query is the adapter's own, so
a unit test holds it to the same scope check a model-written query must pass.

## Query templates

`src/cypher-templates.ts` holds ten hand-written, read-only queries for the
questions asked most. With a model, it is asked first to choose one and fill in
its parameters, as one JSON object; it never writes Cypher for them.

| Template | Parameters | Answers | Coverage |
|---|---|---|---|
| `dependencies` | `entity`, `transitive` | what it depends on, along `depends_on`; transitively up to 6 hops, each by its shortest chain | exhaustive; transitively, only when nothing was reached at the 6th hop |
| `dependents` | `entity`, `transitive` | what depends on it, the same way | as `dependencies` |
| `owner` | `entity` | its `owned_by` targets | exhaustive |
| `path` | `from`, `to` | the shortest paths between them, up to 4 relationships in either direction | top-k: never every connection |
| `count_related` | `entity`, `rel`, `direction`, `type`? | how many things one relationship links to it | exhaustive |
| `list_related` | the same | those things | exhaustive |
| `count_of_type` | `type` | how many recorded resources of a type | exhaustive |
| `list_of_type` | `type` | those resources | exhaustive |
| `low_confidence` | `type`?, `below`? (0.5) | resources below a confidence, weakest first | exhaustive |
| `single_source` | `type`?, `source`? | resources one kind of evidence alone corroborates | exhaustive |

A result its row cap cut short is a top-k, and one holding rows from another
scope unknown. A name the model gives - `entity`, `from`, `to` - is the entity
with that id, else with that title, else the best match in the full-text index;
the answer says how each was read, and warns when another entity matched
nearly as well. A type or relationship must be one the graph has. Nothing the
model gives is written into a query: every value is a parameter, every query
binds every pattern to the scope (a unit test holds each to the same scope
check a model-written query must pass), and a template that finds nothing
still answers, since it asked exactly what was meant. When the model chooses
no template, or one that does not parse, fit the graph's schema or name
anything in it, the model writes the query instead, and the answer's
diagnostics say why.

## Model-written Cypher

When no template fits, a model writes the query from the question and the graph's schema; the adapter
checks it reads only and only in scope, caps its rows, and runs it. A query
that finds nothing runs once more with every relationship undirected, which
can change what it means. Nothing checks that the query asks what was meant,
so its result is never `exhaustive`: it is a `top-k` when its row cap cut it
short and `unknown` otherwise, and `coverage.unverifiedQuery` carries the
query as it ran, who wrote it and whether it was retried undirected. Synthesis
then says the answer relies on an unverified query, and hedges its counts and
lists.

## Integration tests against a local Neo4j

`src/neo4j-projection.integration.test.ts` runs against a real server when
`NEO4J_TEST_URL` is set, and is skipped without it, so CI without Neo4j stays
green. With `NEO4J_PASSWORD` set it logs in as `neo4j` with that password, the
variable the adapter's own `passwordEnv` names in the examples; without it,
it connects with auth off. Every test works in a scope of its own and clears
it afterwards, so a shared server is safe to use.

One way to run a server for them: the official image in Docker, bound to
127.0.0.1 only, with a generated password kept in an env file outside the
repository.

```bash
env_file=~/.config/docket/neo4j-test.env   # anywhere outside the repository
umask 077
printf 'NEO4J_TEST_URL=bolt://127.0.0.1:27687\nNEO4J_PASSWORD=%s\n' "$(openssl rand -hex 24)" > "$env_file"
set -a; . "$env_file"; set +a

docker run -d --name docket-neo4j-test \
  -p 127.0.0.1:27687:7687 -p 127.0.0.1:27474:7474 \
  -e NEO4J_AUTH="neo4j/$NEO4J_PASSWORD" \
  neo4j:5.26-community

pnpm --filter @docket/adapter-neo4j test   # once the log says "Started."
```

Later shells load the same file before testing: `set -a; . "$env_file"; set +a`.
