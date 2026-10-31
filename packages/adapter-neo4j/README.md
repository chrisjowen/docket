# @docket/adapter-neo4j

docket's Neo4j adapter: one `(:Memory:<Type>)` node per entity and one typed
relationship per (source, rel, target), with a full-text index. A question is
answered by one query the adapter writes itself - the full-text matches and the
best paths from each, ranked by their relationships' confidence - or through a
read-only Cypher query a local Ollama model writes.

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
