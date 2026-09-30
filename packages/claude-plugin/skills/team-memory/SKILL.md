---
name: team-memory
description: Use the `memory` CLI to query and maintain this repository's team memory under .memory/. Use when you need existing project knowledge (which services, APIs, pipelines, clusters, incidents, runbooks, permits, policies, projects, teams, decisions or constraints exist, who owns what, what depends on what), to look up the ontology, to check memory files after writing them, or when projections look stale. To write a memory, use the `remember` skill.
---

# Team memory CLI

Canonical memory is Markdown under `.memory/`. The `memory` CLI searches it,
checks it against the ontology in `.memory/entities.yaml`, and keeps the
projections in `.memory/.index/` in step with it. The CLI never writes memory
files; to capture something, use the `remember` skill.

If `memory` is not on the path, try `npx --no-install memory`. If neither
works, do not install it: read and grep `.memory/` directly.

## Find what is known

```bash
memory search <query...>            # e.g. memory search local model
memory search -n 5 <query...>       # fewer hits per projection (default 10)
memory search --json <query...>     # full result, including each hit's path
```

Search asks every projection (semantic and graph) and prints each hit's `id`,
score and canonical file path, grouped by projection. A hit is a pointer:
read the file it names before relying on it.

Use search first when you need to know how the system works, who owns
something, or whether a resource already exists. Grep `.memory/` only when
search finds nothing, or to confirm an exact `id` is unused.

## Look up the ontology

```bash
memory ontology list                # every resource type and relationship
memory ontology show <type>         # one type: attributes, allowed relationships
```

Run `show` before writing a resource of that type, so attributes and `links`
match what the ontology allows. Never assume a fixed ontology; it differs per
repository.

## Check memory after writing it

```bash
memory validate                     # structure, types, attributes, relationships
memory validate --strict            # also fail on links to missing resources
```

Run `validate` after any edit under `.memory/` and fix what it reports. A link
to a resource that does not exist yet is a warning unless `--strict`.

## Keep projections in step

```bash
memory sync                         # one reconciliation pass
memory rebuild                      # drop every projection and reproject
```

The developer normally runs `memory watch` in the foreground and it projects
file edits as they happen; the session-start hook also runs one `sync`. Do not
start `watch` yourself. If search returns stale or missing results for a file
you know exists, run `sync`; if that does not fix it, `rebuild`.

Never write, edit or delete anything under `.memory/.index/`, and never treat
it as the source of truth.

## Setup

`memory init` creates `.memory.yaml`, the `.memory/` tree and a starting
ontology. Run it only when the developer asks to set up team memory in a
repository that has none; `--force` overwrites an existing config and
ontology, so never pass it without being told to.
