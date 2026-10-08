# @docket/adapter-jsonl

docket's default lightweight adapter: the merged entities written as
`documents.jsonl`, `nodes.jsonl` and `edges.jsonl`, deterministic and
diffable, and searched lexically over titles, ids, tags and bodies. No
service, driver or network.

Its default export is the `AdapterDefinition`
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7); its configuration is
a v1 `projections` entry of `type: jsonl` (`output`, default `.docket/.index`).

A private workspace package: it is not published on its own.
`@chrisjowen/docket` bundles it into `dist/bundled/adapter-jsonl`.
