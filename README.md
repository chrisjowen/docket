<h1 align="center">docket</h1>

<h3 align="center">Your repo remembers. So does Claude.</h3>

<p align="center">
  Capture and classify project knowledge in your repository, and a
  <a href="packages/claude-plugin/README.md">Claude Code plugin</a> that reads it first and
  keeps it current.
</p>

---

Canonical knowledge is plain Markdown with YAML frontmatter, committed to the repo
under `.docket/`. Everything else — indexes, graphs, caches — is a disposable
projection that can be deleted and rebuilt byte-for-byte:

```bash
rm -rf .docket/.index
docket rebuild
```

A repo-defined ontology at `.docket/entities.yaml` says what resource types and
relationships mean. Humans and agents edit the same files.

## Install

```bash
pnpm add -D @chrisjowen/docket   # or: npm install --save-dev @chrisjowen/docket
npx docket init
```

Node 22 or later. The command is `docket`; run it through `npx` (or a
`package.json` script) when it is installed as a dev dependency.

## Use

```bash
docket init                 # scaffold .docket.yaml, .docket/ and the default ontology
docket validate             # check files against the ontology
docket validate --strict    # unresolved links become errors
docket sync                 # project changed files into .docket/.index
docket rebuild              # reset and reproject everything
docket watch                # reconcile continuously as files change
docket ontology list        # what resource types and relationships exist
docket ontology show service
```

## A docket file

```markdown
---
id: service.conversation-api
type: service
title: Conversation API

attributes:
  language: typescript
  lifecycle: active

links:
  - rel: owned_by
    target: team.platform

  - rel: depends_on
    target: datasource.sessions
    attributes:
      criticality: high
      runtime: true
---

# Conversation API

Handles conversation persistence and retrieval.
```

`id` is `<type>.<semantic-name>` and never depends on the file's path — moving
the file does not change what it identifies. Only `id`, `type` and `title` are
required.

## How it fits together

```
ontology + canonical files
          │ authoritative
          ▼
    reconciliation
          ▼
      projections
   disposable / rebuildable
```

The filesystem is the durable memory protocol. The ontology defines what
structured knowledge means. The watcher turns file changes into normalized
resource changes. Projections provide query capability, and nothing in them is
a source of truth.

Links may point at resources that do not exist yet — the graph is expected to
be built incrementally, so a dangling reference is a warning until you ask for
`--strict`.

## Projections

The Markdown files are the source. A projection is a destination: sync and
watch push every change into each projection listed in `.docket.yaml`.

```
.docket/**/*.md ──► docket sync / watch ──┬──► jsonl → .docket/.index/*.jsonl
                                          └──► mem0  → hosted or self-hosted mem0
```

**`jsonl`** writes `documents.jsonl`, `nodes.jsonl` and `edges.jsonl` — a
readable view of exactly what projections receive. Output is deterministic, so
rebuilds are byte-identical and diffable. (`type: file` is still accepted.)

**`mem0`** stores each document as one verbatim memory (`infer: false`): the
title, type, id, body, links and tags as text; the id, type, path, hash, tags
and provenance as metadata. Rebuilds reproduce it exactly and cost no LLM
calls. Documents with `index.vector: false` are left out. It needs the optional
`mem0ai` package (`pnpm add mem0ai`).

```yaml
projections:
  # Hosted mem0. The key comes from the environment, never the file.
  - type: mem0
    mode: platform
    apiKeyEnv: MEM0_API_KEY   # default
    # host: https://api.mem0.ai

  # Or self-hosted. `config` goes to mem0's `Memory` constructor untouched,
  # so any embedder, vector store or LLM mem0 supports works.
  - type: mem0
    mode: oss
    config:
      embedder: { provider: ollama, config: { model: nomic-embed-text } }
      vectorStore: { provider: qdrant, config: { host: localhost, port: 6333 } }
      llm: { provider: ollama, config: { model: "qwen2.5:7b" } }
```

Both modes file memories under one scope, by default
`agentId: docket-<checkout directory>-<hash>`, where the hash is taken over the
checkout's absolute path (symlinks and letter case resolved). Two clones or
worktrees with the same directory name therefore never share a scope. Moving a
checkout to a new path starts a new scope and leaves the old remote one behind.
The path is the only input, so checkouts on different machines at the same path
(devcontainers, Codespaces, CI runners) get the same default scope: if they
point at one shared mem0 or Neo4j server, each must set `scope:` (`userId`,
`agentId` and/or `runId`) explicitly. Set `scope:` too to choose your own.
`docket rebuild` deletes and repopulates the whole scope, so do not share it
with memories written by anything else. The `neo4j` projection's
`scope` defaults the same way.

Scopes created by earlier versions (`team-memory-<directory>` in mem0, the bare
directory name in Neo4j) are left behind, not migrated or deleted: the first
`docket sync` projects everything into the new scope. Delete the old scope by
hand if you no longer want it, or set `scope:` to the old value to keep using
it. Set
`MEM0_TELEMETRY=false` to turn off the mem0 SDK's telemetry.

The manifest that makes sync skip unchanged files lives in `state.dir`
(default `.docket/.index`), independent of any projection. Adding, removing or
reconfiguring a projection makes the next sync reproject everything, so a newly
added mem0 receives the whole repository.

Graph and full-text projections are not built yet; the `MemoryProjection`
interface is where they plug in.

## Claude Code plugin

`packages/claude-plugin/` contains skills and hooks that let Claude capture
durable project knowledge by editing the same canonical files a human would.
Agents never write to an index. See its
[README](packages/claude-plugin/README.md).

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Layout, phases and track ownership are in [`PLAN.md`](PLAN.md). The full
specification is [`docs/SPEC.md`](docs/SPEC.md).

## Releasing

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) stages
`@chrisjowen/docket` on npm, with provenance, when a `v<version>` tag is pushed
(or a GitHub release creates one). It typechecks, builds and tests first, and
refuses a tag that does not match `packages/docket/package.json`. npm does not
allow publishing from CI without 2FA, so the workflow runs `npm stage publish`:
the version lands in npm's staging area and goes live only once a maintainer
approves it.

1. Bump `version` in `packages/docket/package.json` and merge it.
2. Tag that commit `v<version>` and push the tag, or publish a GitHub release
   for it.
3. Approve the staged version with 2FA: `npm stage approve <stage-id>`, or the
   Staged Packages tab on npmjs.com.

The workflow authenticates with the `NPM_TOKEN` repository secret (an npm token
with publish rights to `@chrisjowen/docket`, already configured) and signs
provenance through GitHub's OIDC token. The first stage of a new package also
creates a public `0.0.0-stage` placeholder version on npm.

Check what a release will contain with `npm pack --dry-run` in
`packages/docket`.
