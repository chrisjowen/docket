# @docket/adapter-mem0

docket's mem0 adapter: one verbatim memory per entity (`infer: false`), on
hosted mem0 (`mode: platform`), mem0's self-hosted REST server
(`mode: server`) or `mem0ai/oss` (`mode: oss`).

Its default export is the `AdapterDefinition`
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7); its configuration is
a v1 `projections` entry of `type: mem0`. `mem0ai` is its dependency, imported
only when an instance connects in platform or oss mode.

A private workspace package: it is not published on its own.
`@chrisjowen/docket` bundles it into `dist/bundled/adapter-mem0`, and keeps
`mem0ai` an optional peer dependency.
