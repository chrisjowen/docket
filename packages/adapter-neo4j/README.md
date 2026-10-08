# @docket/adapter-neo4j

docket's Neo4j adapter: one `(:Memory:<Type>)` node per entity and one typed
relationship per (source, rel, target), with a full-text index, searched
full-text or through a read-only Cypher query a local Ollama model writes.

Its default export is the `AdapterDefinition`
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7); its configuration is
a v1 `projections` entry of `type: neo4j`. `neo4j-driver` is its dependency,
imported only when an instance is created.

A private workspace package: it is not published on its own.
`@chrisjowen/docket` bundles it into `dist/bundled/adapter-neo4j`, and keeps
`neo4j-driver` an optional peer dependency.

`src/neo4j-projection.integration.test.ts` runs against a real server when
`NEO4J_TEST_URL` is set (e.g. `bolt://localhost:7687`, auth off).
