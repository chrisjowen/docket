# @docket/adapter-kit

What docket's own adapters share, so each adapter package stays small:

- `entityProjectionDefinition` / `entityProjectionAdapter` - present an
  `EntityProjection` (upsert, remove, flush, reset, search) as an
  `AdapterDefinition` and `MemoryAdapter` from
  [`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7: entity inputs only,
  answers as one entities block.
- `checkoutScope`, `stableStringify`, `writeFileAtomic`, `ollamaChat` and
  `ollamaModelSchema`, `packageVersion`.
- `@docket/adapter-kit/testing` - `entityInput` and `entityLink` fixtures.

A private workspace package: it is not published on its own. `@chrisjowen/docket`
bundles its runtime code (not `testing`) into `dist/bundled/adapter-kit`.
