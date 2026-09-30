---
name: remember
description: Write durable knowledge into team memory under .memory/. Use when the user says "remember this", "capture this", "save this as team memory", "record this decision", "add this to memory", or otherwise asks for a fact, decision or constraint to be written down for future sessions, and when an end-of-session review finds durable knowledge worth capturing.
---

# Remember

Write durable knowledge to canonical Markdown under `.memory/`. Use the
`team-memory` skill for the CLI commands referenced here.

## Procedure

1. Find existing memory with `memory search <subject>`, then grep `.memory/`
   for the likely `id` to confirm it is unused.
2. Decide update or create:
   - existing resource, new or changed facts -> update that file
   - genuinely new resource -> create one file
   - no existing type fits -> use the `ontology` skill to extend
     `.memory/entities.yaml` conservatively, then write the file
3. Run `memory ontology show <type>` for the type you are writing, so
   attributes and `links` match what it allows. Never assume a fixed ontology.
4. Write the file in the format below.
5. Add relationships in `links` where meaningful - ownership, dependency, use,
   deployment, supersession. A relationship the user stated is part of what
   they asked you to remember.
6. Run `memory validate`, fix what it reports, and report the file path you
   wrote. Never touch `.memory/.index/`; the watcher projects your edits.

## File format

Markdown with YAML frontmatter. Required fields: `id`, `type`, `title`.

```markdown
---
id: agent.research-assistant
type: agent
title: Research Assistant

tags:
  - research

attributes:
  package: RA.agent
  runtime: in-process

links:
  - rel: uses
    target: datasource.private-market-3

  - rel: owned_by
    target: team.research-platform

provenance:
  authority: repo
  confidence: 1.0
  capturedBy: claude
---

# Research Assistant

Performs research across public and private market data.
```

- `id` is `<type>.<semantic-name>`, globally unique, and independent of the
  file's path; moving a file must not change its `id`.
- Directories under `.memory/` are convention. `type:` decides what a file is.
- Each `links` entry needs `rel` and `target`, and may carry `attributes` when
  the relationship defines them. A target that does not exist yet is a warning,
  not an error.
- `provenance` and `index` are optional. Set `capturedBy: claude` when you
  wrote the file.
- Body prose is for humans and retrieval. Do not restate attributes in it.
- `[[service.identity]]` inline references are weak mentions only. Assert real
  relationships in `links`.

## Updating

Edit the existing file when a resource changes. Do not create
`agent.research-assistant-v2` unless it is genuinely a different resource.

When a decision replaces an earlier one, keep both files and link the new one
with `rel: supersedes`.

## Judgement

Capture: decisions, ownership, dependencies, constraints, conventions,
services, agents, systems, environments, datasources, teams.

Do not capture transient debugging state, speculation, temporary
implementation details, or what nearby code already says plainly. When asked
to, refuse politely, say why, and offer the durable version if there is one.

Prefer one accurate update over several overlapping new files.
