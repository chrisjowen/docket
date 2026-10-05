---
name: docket
description: Use the `docket` CLI to query and maintain this repository's docket of project knowledge under .docket/. Use when you need existing project knowledge (which services, APIs, pipelines, clusters, incidents, runbooks, permits, policies, projects, teams, decisions or constraints exist, who owns what, what depends on what), to look up the ontology, to check docket files after writing them, or when projections look stale. To write to the docket, use the `remember` skill.
---

# Docket CLI

Canonical knowledge is Markdown under `.docket/`. The `docket` CLI searches it,
checks it against the ontology in `.docket/entities.yaml`, and keeps the
projections in `.docket/.index/` in step with it. The CLI never writes docket
files; to capture something, use the `remember` skill.

If `docket` is not on the path, try `npx --no-install docket`. If neither
works, do not install it: read and grep `.docket/` directly.

## Find what is known

```bash
docket search <query...>            # e.g. docket search local model
docket search -n 5 <query...>       # fewer hits per projection (default 10)
docket search --json <query...>     # full result, including each hit's path
```

Search asks every projection (semantic and graph) and prints each hit's `id`,
score and canonical file path, grouped by projection. A hit is a pointer:
read the file it names before relying on it.

Use search first when you need to know how the system works, who owns
something, or whether a resource already exists. Grep `.docket/` only when
search finds nothing, or to confirm an exact `id` is unused.

## Look up the ontology

```bash
docket ontology list                # every resource type and relationship
docket ontology show <type>         # one type: attributes, allowed relationships
```

Run `show` before writing a resource of that type, so attributes and `links`
match what the ontology allows. Never assume a fixed ontology; it differs per
repository.

## Check the docket after writing to it

```bash
docket validate                     # structure, types, attributes, relationships
docket validate --strict            # also fail on links to missing resources
```

Run `validate` after any edit under `.docket/` and fix what it reports. A link
to a resource that does not exist yet is a warning unless `--strict`.

## Keep projections in step

```bash
docket sync                         # one reconciliation pass
docket rebuild                      # drop every projection and reproject
```

The developer normally runs `docket watch` in the foreground and it projects
file edits as they happen; the session-start hook also runs one `sync`. Do not
start `watch` yourself. If search returns stale or missing results for a file
you know exists, run `sync`; if that does not fix it, `rebuild`.

Never write, edit or delete anything under `.docket/.index/`, and never treat
it as the source of truth.

## Setup

`docket init` creates `.docket.yaml`, the `.docket/` tree and a starting
ontology. Run it only when the developer asks to set up docket in a
repository that has none; `--force` overwrites an existing config and
ontology, so never pass it without being told to.
