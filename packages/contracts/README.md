# @docket/contracts

The contracts between docket and its memory adapters, from
[`docs/adapter-spec.md`](../../docs/adapter-spec.md) §4 and §7-9: the
`AdapterDefinition` an adapter module exports by default, the `MemoryAdapter`
it creates with its projection and query ports, and every record that crosses
that boundary.

- `@docket/contracts` - the types, runtime validators (`validateAdapterDefinition`,
  `validateAdapterAnswer`, `validateApplyReceipt`, ...) and the zod schemas
  behind them. No engine drivers, no UI.
- `@docket/contracts/testing` - contract test helpers: `assertAdapterContract`
  drives a definition through config, create, describe, status, apply, replay,
  reset, ask and close; `fakeServices`, `sampleBatch` and `sampleAskRequest`
  supply what it needs, and `sampleObservation` and `sampleDocument` give the
  other two input kinds for adapters that declare them.

A private workspace package: it is not published on its own. `@chrisjowen/docket` bundles
its runtime code and types (not `testing`) into its own `dist/bundled/contracts`.
