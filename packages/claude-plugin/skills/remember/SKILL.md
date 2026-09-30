---
name: remember
description: Capture something into team memory on explicit request. Use when the user says "remember this", "capture this", "save this as team memory", "record this decision", "add this to memory", or otherwise asks for a fact, decision or constraint to be written down for future sessions.
---

# Remember

The user asked for something to be persisted. Write it to canonical Markdown
under `.memory/`.

## Procedure

1. Read `.memory/entities.yaml` to see the registered resource types and
   relationships. Never assume a fixed ontology.
2. Search `.memory/` for an existing resource covering this concept. Grep for
   the subject's name and for the likely `id`.
3. Decide update or create:
   - existing resource, new or changed facts -> update that file
   - genuinely new resource -> create one file
   - no existing type fits -> extend the ontology first (see step 6)
4. Modify the canonical Markdown. Follow the file format and rules in the
   `team-memory` skill: required `id`, `type`, `title`; `id` as
   `<type>.<semantic-name>`; attributes matching the type definition. Set
   `provenance.capturedBy: claude`.
5. Add relationships in `links` where meaningful - ownership, dependency, use,
   deployment, supersession. A relationship the user stated is part of what
   they asked you to remember.
6. If the concept has no accurate resource type, use the `ontology`
   skill to extend `.memory/entities.yaml` conservatively, then write the
   resource file.
7. Do not manually update derived indexes. Never touch `.memory/.index/`. The
   watcher projects your file edits.
8. Run `memory validate` if the CLI is available, and report the file path you
   wrote.

## Judgement

Capture: decisions, ownership, dependencies, constraints, conventions,
services, agents, systems, environments, datasources, teams.

Refuse politely and say why when asked to remember transient debugging state,
speculation, or a temporary implementation detail. Offer the durable version
instead if there is one.

Prefer one accurate update over several overlapping new files.
