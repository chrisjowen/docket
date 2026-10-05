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
docket search <query...>    # ask every projection that can search
docket ontology list        # resource types, relationships and evidence sources
docket ontology show service  # attributes, relationships and confidence by source
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

## Evidence and confidence

A captured resource or link says exactly where it was seen, as `evidence`: a
source kind and the location — file, line range and symbol; config key; API
method and endpoint; URL — with when, by whom and in which session.

```yaml
evidence:
  - source: infrastructure
    path: deploy/k8s/orders/deployment.yaml
    lines: 1-48
    symbol: Deployment/orders-api
    urls:
      - https://github.com/acme/platform/blob/3f2c1d0/deploy/k8s/orders/deployment.yaml#L1-L48
    observedAt: 2026-10-05
    observedBy: claude
    session: 6c1f0e2a
    note: Deployment with 3 replicas of the orders-api image.
```

Links take an `evidence` list of their own. Evidence is append-only: seeing
something again adds an entry and never rewrites an earlier one.

Confidence is computed, never written. The ontology says what one observation
from each source is worth, per resource type and relationship — a dependency
declared in a manifest is close to certain, a pod or secret named in code is
not much until something independent confirms it:

```yaml
# .docket/entities.yaml
evidence:
  sources:
    code: { confidence: 0.6, requires: [path] }
    runtime: { confidence: 0.85, requiresAny: [urls, endpoint, symbol] }

resourceTypes:
  pod:
    confidence: { code: 0.3, infrastructure: 0.7, runtime: 0.9 }

relationships:
  depends_on:
    confidence: { manifest: 0.95, code: 0.65 }
```

Observations of one source kind do not corroborate each other — the strongest
counts — while independent kinds combine as `1 - (1 - a)(1 - b)`: a pod read
from code (0.3) and seen running (0.9) is 0.93. A resource with no evidence
takes its `provenance.confidence`, or `evidence.unevidenced` (0.5). The
default ontology ships the source kinds `code`, `manifest`, `config`,
`infrastructure`, `api`, `runtime`, `docs`, `conversation` and `human`, and
rules for the types where it matters; an ontology written before evidence
existed gets the same defaults. `docket ontology show <type>` prints the
confidence each source earns for that type, and `docket validate` rejects
evidence that does not give the location its source requires.

Several files may declare the same `id` — two branches capturing the same
service, say. They are one resource: projections receive a single merged
entity with every file's evidence, one relationship per (source, rel, target),
and the confidence the combined evidence earns. The first file by path names
it and its attribute values stand; a file that disagrees gets a warning, and
one that gives the id another type is left out with an error.

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
.docket/**/*.md ──► docket sync / watch ──┬──► jsonl  → .docket/.index/*.jsonl
                                          ├──► mem0   → hosted or self-hosted mem0
                                          └──► neo4j  → a Neo4j graph
```

Every projection receives merged entities — one per id, however many files
declare it — each resource and link carrying its evidence, evidence count,
corroborating source kinds and confidence.

**`jsonl`** writes `documents.jsonl`, `nodes.jsonl` and `edges.jsonl` — a
readable view of exactly what projections receive. Output is deterministic, so
rebuilds are byte-identical and diffable. (`type: file` is still accepted.)
It is the default, and the only projection `docket search` has out of the box:
a lexical keyword search over titles, ids, tags and bodies.

**`mem0`** stores each resource as one verbatim memory (`infer: false`): the
title, type, id, confidence, body, links, evidence and tags as text; the id,
type, paths, hash, tags, confidence and evidence count as metadata. Rebuilds
reproduce it exactly and cost no LLM calls. Documents with
`index.vector: false` are left out. It needs the optional `mem0ai` package
(`pnpm add mem0ai`).

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

**`neo4j`** writes one `(:Memory:<Type>)` node per resource and one
relationship per (source, rel, target), with `confidence`, `evidenceCount`,
`sources` and `evidence` on both, so a query can ask for what rests on code
alone — and a full-text index over the documents. It needs the optional
`neo4j-driver` package and a running Neo4j server. `docket search` asks it with
a full-text query, or, with `cypher` set, has a local Ollama model write a
read-only Cypher query against the graph's schema (falling back to full-text
when that fails or finds nothing).

```yaml
projections:
  - type: neo4j
    url: bolt://localhost:7687        # default
    username: neo4j                   # default
    passwordEnv: NEO4J_PASSWORD       # unset: connect without auth
    # database: neo4j
    # cypher:
    #   model: "qwen2.5:7b"           # Ollama at http://localhost:11434
```

The manifest that makes sync skip unchanged resources lives in `state.dir`
(default `.docket/.index`), independent of any projection. A resource is
reprojected whenever what it projects changes — one of its files, or a
confidence rule in the ontology. Adding, removing or reconfiguring a projection
makes the next sync reproject everything, so a newly added mem0 receives the
whole repository.

New projections plug in through the `MemoryProjection` interface.

## Claude Code plugin

`packages/claude-plugin/` contains skills and hooks that let Claude capture
durable project knowledge by editing the same canonical files a human would.
Agents never write to an index. See its
[README](packages/claude-plugin/README.md).

## Development

```bash
pnpm install
pnpm typecheck   # sources and tests
pnpm build       # the end-to-end tests run the built CLI, so build first
pnpm test        # the CLI's suite and the plugin's hook tests
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
