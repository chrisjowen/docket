---
name: team-memory
description: Read and write this repository's durable team memory under .memory/. Use when you need existing project knowledge (which services, APIs, pipelines, clusters, incidents, runbooks, permits, policies, projects, teams, decisions or constraints exist, who owns what, what depends on what), or when a session establishes durable knowledge worth keeping - an architectural decision, a new service or agent, an ownership or dependency change, a lasting constraint or convention.
---

# Team memory

Repository memory is stored under `.memory/`.

`.memory/entities.yaml` defines the resource types and relationships available
for this repository.

Never assume a fixed ontology.

Read `.memory/entities.yaml` before performing structured memory extraction.

## Layout

```text
.memory/entities.yaml        ontology: resource types + relationships
.memory/resources/<plural>/  resource files (services, agents, teams, ...)
.memory/decisions/           decision files
.memory/constraints/         constraint files
.memory/notes/               free-form durable notes
.memory/.index/              GENERATED. Never read as truth, never edit.
```

Directories are convention, not schema. The `type:` field in frontmatter
determines what a file is; its path does not.

## Capture

Capture durable knowledge:

- architectural decisions
- services
- systems
- agents
- important data sources
- ownership
- dependencies
- significant development constraints
- environments
- durable project conventions
- meaningful relationships between resources

Do not capture:

- transient debugging state
- speculation
- conversational filler
- temporary implementation details
- information trivially discoverable from nearby code, unless its meaning is
  non-obvious or strategically important

## Extraction procedure

1. Read `.memory/entities.yaml`.
2. Search `.memory/` for existing matching resources (grep for the concept name
   and for candidate IDs).
3. Identify durable new information.
4. Match concepts to existing resource types.
5. Update existing resources where possible.
6. Create new resources only when necessary.
7. Add explicit relationships.
8. Keep Markdown concise.
9. Never directly edit `.memory/.index/`.
10. Allow the watcher to update projections.

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

Rules:

- `id` follows `<type>.<semantic-name>` and is globally unique in the
  repository. IDs are independent of file path; moving a file must not change
  its `id`.
- `type` must be a resource type registered in `.memory/entities.yaml`.
- `attributes` must match the attribute definitions for that type.
- Each `links` entry needs `rel` and `target`. `rel` must be a registered
  relationship whose `from` allows this resource's type and whose `to` allows
  the target's type. A link may carry `attributes` when the relationship
  defines them.
- A link may target a resource that does not exist yet. That is a warning, not
  an error.
- `provenance` and `index` are optional. Set `capturedBy: claude` when you
  wrote the file.
- Body prose is for humans and retrieval. Do not restate attributes in prose
  unless it aids understanding.
- `[[service.identity]]` inline references are weak mentions only. Assert real
  relationships in `links`.

## Updating existing memory

Prefer updating existing canonical memory over creating another, conflicting
memory.

If `agent.research-assistant` moves from an in-process runtime to Databricks,
edit that existing file. Do not create `agent.research-assistant-v2` unless it
is genuinely a different resource.

When a decision replaces an earlier one, keep both files and link the new one:

```yaml
links:
  - rel: supersedes
    target: decision.agent-runtime
```

## Missing resource types

If an important durable concept cannot be represented accurately by an existing
resource type, extend `.memory/entities.yaml` first, then write the resource
file. Use the `ontology` skill.

## Never write indexes

You write files. The `memory watch` watcher projects them.

```text
edit .memory/**.md  ->  watcher  ->  .memory/.index/
```

Never write, edit or delete anything under `.memory/.index/`, and never treat
it as the source of truth. If projections look stale, the fix is `memory sync`
(one pass) or `memory rebuild` (from scratch), never hand-editing an index.

## Commands

Available when the `@team-memory/cli` dev dependency is installed:

```bash
memory validate          # check structure, types, attributes, relationships
memory ontology list     # list resource types and relationships
memory ontology show service
memory sync              # one reconciliation pass
memory rebuild           # discard and rebuild projections
memory watch             # foreground watcher (the developer runs this)
memory init              # first-time setup of .memory/ and .memory.yaml
```

Run `memory validate` after writing memory files. If the CLI is not installed,
do not install it; the files are still correct and authoritative.
