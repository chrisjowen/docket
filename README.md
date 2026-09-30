# Team Memory

Local-first team memory for software repositories.

Canonical memory is plain Markdown with YAML frontmatter, committed to the repo
under `.memory/`. Everything else — indexes, graphs, caches — is a disposable
projection that can be deleted and rebuilt byte-for-byte:

```bash
rm -rf .memory/.index
memory rebuild
```

A repo-defined ontology at `.memory/entities.yaml` says what resource types and
relationships mean. Humans and agents edit the same files.

## Install

```bash
pnpm add -D @team-memory/cli
```

## Use

```bash
memory init                 # scaffold .memory.yaml, .memory/ and the default ontology
memory validate             # check files against the ontology
memory validate --strict    # unresolved links become errors
memory sync                 # project changed files into .memory/.index
memory rebuild              # reset and reproject everything
memory watch                # reconcile continuously as files change
memory ontology list        # what resource types and relationships exist
memory ontology show service
```

## A memory file

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

v0 ships one: a file projection writing `documents.jsonl`, `nodes.jsonl`,
`edges.jsonl` and a manifest under `.memory/.index/`. Output is deterministic —
records are sorted and no timestamps or absolute paths reach the files — so
rebuilds are byte-identical and diffable.

Graph, full-text, vector and Mem0 projections are deliberately out of scope for
v0. The `MemoryProjection` interface exists so they can be added without
touching the canonical format.

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
