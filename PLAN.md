# Build Plan

Spec: [`docs/SPEC.md`](docs/SPEC.md). Section numbers below refer to it.
Verification record: [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md).

## Invariant

```
ontology + canonical files -> reconciliation -> projections (disposable)
```

The filesystem is the durable memory protocol. Nothing derived is authoritative.

## Status

V0 is built. Phases 2 and 3 ran as parallel tracks against frozen Phase 1
contracts, with no two tracks owning the same file.

| Phase | Track | Scope | Spec | Status |
|---|---|---|---|---|
| 0 | — | Workspace scaffold, deps, tsconfig, vitest | 42, 43 | done |
| 1 | — | Shared contracts: `model/`, `projection/projection.ts`, `config/config.ts` | 8–10, 22, 25 | done |
| 2 | A | `source/parser.ts`, `source/hashing.ts`, `source/scanner.ts` | 13–24 | done |
| 2 | B | `config/{config,defaults}.ts` loader, `ontology/default-sdlc.yaml`, `commands/init.ts` | 5, 11, 12, 33 | done |
| 2 | C | `ontology/{loader,validator}.ts` | 6–10, 17, 66 | done |
| 2 | D | `projection/{manager,registry}.ts`, `projection/file/file-projection.ts`, `manifest/manifest.ts` | 25–31, 68, 69 | done |
| 3 | E | `cli.ts` + `commands/{sync,rebuild,validate,ontology}.ts` | 32, 38–41 | done |
| 3 | F | `watcher/{watcher,debounce,reconciler}.ts`, `commands/watch.ts` | 34–37, 67 | done |
| 4 | H | Integration tests, watcher tests, rebuild determinism | 70–73 | done |
| 4 | I | Example repository + acceptance-criteria run | 81 | done |
| — | G | Claude Code plugin: skills, hooks, manifest | 45–59 | done |

## Dependency graph

```
0 -> 1 -+-> 2A parser/hash/scan --+
        +-> 2B config/init        +-> 3E cli ----+-> 4H tests
        +-> 2C ontology validate  |              +-> 4I example
        +-> 2D projection/manifest+-> 3F watcher -+
        +-> G  claude plugin (independent throughout)
```

Max concurrency 5. Phase 1 was the serial choke point.

## Track ownership (no two tracks write the same file)

- **A** `src/source/**`
- **B** `src/config/loader.ts`, `src/config/defaults.ts`, `src/ontology/default-sdlc.yaml`, `src/commands/init.ts`
- **C** `src/ontology/{loader,validator}.ts`
- **D** `src/projection/**` (except `projection.ts`), `src/manifest/**`
- **E** `src/cli.ts`, `src/commands/{sync,rebuild,validate,ontology}.ts`
- **F** `src/watcher/**`, `src/commands/watch.ts`
- **G** `packages/claude-plugin/**`
- **H** `packages/docket/test/**`
- **I** `examples/**`

Phase 1 files are frozen. A track needing a contract change raises it rather than editing in place.

## Decisions taken during the build

**`exactOptionalPropertyTypes` is off.** Zod types an optional field as
`T | undefined`, which the flag refuses to assign into a `prop?: T` property.
Two tracks independently reached for casts, so the flag was dropped once rather
than letting casts spread. `strict` and `noUncheckedIndexedAccess` stay on.

**The default ontology defines `deployed_to`.** Spec §16 uses it in its link
examples but §10 never defines it, which left `environment` with no inbound edge.

**Test files run sequentially** (`fileParallelism: false`). Several suites start
real chokidar watchers over temp directories, and concurrent watchers starve
each other in a way indistinguishable from a missed event.

**Watch validates more quietly than `validate`.** The single-file watch pass
filters out `dangling-reference` diagnostics, because one file cannot see
whether its targets exist and §17 expects the graph to be built incrementally.
`docket validate` still reports them across the whole set.

## Known gaps

Tracked as issues rather than left in conversation:

- Claude plugin integration is verified only as far as is possible from outside
  a running session; see the PARTIAL entry in `docs/ACCEPTANCE.md`.

## Non-goals for v0

No graph DB or FTS index in v0. Both were added after v0 as optional
projections: mem0 (`type: mem0`, hosted or self-hosted) and a Neo4j graph with a
full-text index (`type: neo4j`). No dynamic projection package loading. See
spec §80. The `MemoryProjection` interface is how they were added without
touching the canonical format.
