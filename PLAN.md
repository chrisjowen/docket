# Build Plan

Spec: [`docs/SPEC.md`](docs/SPEC.md). Section numbers below refer to it.

## Invariant

```
ontology + canonical files -> reconciliation -> projections (disposable)
```

The filesystem is the durable memory protocol. Nothing derived is authoritative.

## Phases

| Phase | Track | Scope | Spec |
|---|---|---|---|
| 0 | — | Workspace scaffold, deps, tsconfig, vitest | 42, 43 |
| 1 | — | Shared contracts: `model/`, `projection/projection.ts`, `config/config.ts` | 8–10, 22, 25 |
| 2 | A | `source/parser.ts`, `source/hashing.ts`, `source/scanner.ts` | 13–24 |
| 2 | B | `config/{config,defaults}.ts` loader, `ontology/default-sdlc.yaml`, `commands/init.ts` | 5, 11, 12, 33 |
| 2 | C | `ontology/{loader,validator}.ts` | 6–10, 17, 66 |
| 2 | D | `projection/{manager,registry}.ts`, `projection/file/file-projection.ts`, `manifest/manifest.ts` | 25–31, 68, 69 |
| 3 | E | `cli.ts` + `commands/{sync,rebuild,validate,ontology}.ts` | 32, 38–41 |
| 3 | F | `watcher/{watcher,debounce,reconciler}.ts`, `commands/watch.ts` | 34–37, 67 |
| 4 | H | Integration tests, watcher tests, rebuild determinism | 70–72 |
| 4 | I | Example repository + acceptance-criteria run | 81 |
| — | G | Claude Code plugin: skills, hooks, manifest | 45–59 |

## Dependency graph

```
0 -> 1 -+-> 2A parser/hash/scan --+
        +-> 2B config/init        +-> 3E cli ----+-> 4H tests
        +-> 2C ontology validate  |              +-> 4I example
        +-> 2D projection/manifest+-> 3F watcher -+
        +-> G  claude plugin (independent throughout)
```

Max concurrency 5. Phase 1 is the serial choke point and is already done.

## Track ownership (no two tracks write the same file)

- **A** `src/source/**`
- **B** `src/config/loader.ts`, `src/config/defaults.ts`, `src/ontology/default-sdlc.yaml`, `src/commands/init.ts`
- **C** `src/ontology/{loader,validator}.ts`
- **D** `src/projection/**` (except `projection.ts`), `src/manifest/**`
- **E** `src/cli.ts`, `src/commands/{sync,rebuild,validate,ontology}.ts`
- **F** `src/watcher/**`, `src/commands/watch.ts`
- **G** `packages/claude-plugin/**`
- **H** `packages/memory/test/**`
- **I** `examples/**`

Phase 1 files are frozen. A track needing a contract change raises it rather than editing in place.

## Non-goals for v0

No graph DB, vector DB, FTS index, or Mem0. No dynamic projection package loading. See spec §80.
