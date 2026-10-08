# @docket/adapter-kit

What docket's own adapters share, so each adapter package stays small:

- `entityProjectionDefinition` / `entityProjectionAdapter` - present an
  `EntityProjection` (upsert, remove, flush, reset, search) as an
  `AdapterDefinition` and `MemoryAdapter` from
  [`docs/adapter-spec.md`](../../docs/adapter-spec.md) §7: entity inputs only,
  answers as one entities block.
- For recall engines that store every input kind as text (memvid, MemPalace):
  - `canonicalPassage` - the passage stored for an entity, observation or
    document, and the canonical reference back to it.
  - `NativeOwnership` over a `NativeStore` - the canonical-to-native mapping
    read back from identities the engine keeps on its own records, giving
    idempotent replay, revision updates and deletes (§8).
  - `applyChanges`, `appliedWhole` and `CheckpointFile` - per-change
    receipts, scope refusal, and checkpoints tied to a configuration
    fingerprint.
  - `resolveNativeHits`, `staleDiagnostic` and `recallAnswer` - hits checked
    against canonical revisions, answered as passages and entities blocks
    with top-k coverage (§9).
- `checkoutScope`, `stableStringify`, `writeFileAtomic`, `ollamaChat` and
  `ollamaModelSchema`, `packageVersion`.
- `@docket/adapter-kit/testing` - `entityInput` and `entityLink` fixtures.

A private workspace package: it is not published on its own. `@chrisjowen/docket`
bundles its runtime code (not `testing`) into `dist/bundled/adapter-kit`.
