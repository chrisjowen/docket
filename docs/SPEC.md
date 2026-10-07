Here’s a self-contained implementation spec you can hand directly to a coding agent.

# Docket: Local-First Project Knowledge System

## 1. Purpose

Build a local-first team memory system for software repositories.

The system must use files committed to the repository as the only canonical source of memory.

Derived memory systems such as graph databases, vector databases, full-text search indexes, Mem0, or other future systems must be treated only as disposable projections of the canonical files.

The first implementation should provide:

- A Node.js/TypeScript CLI built with Commander.
- A filesystem watcher for continuous projection after files change.
- Markdown memory files with YAML frontmatter.
- A repository-defined resource/ontology registry at `.docket/entities.yaml`.
- Validation of memory files against that registry.
- A generic projection plugin API.
- An initial file-based projection for development and testing.
- A Claude Code plugin containing skills and hooks for capturing durable project knowledge.
- Default SDLC resource types installed during initialization.
- The ability for users and agents to extend the ontology.

Do not implement a graph database, vector database, FTS database, or Mem0 integration in the first version.

The design must make those future integrations straightforward.

---

# 2. Core Principles

## 2.1 Files are authoritative

Canonical memory exists only under:

```text
.docket/
```

A memory is not authoritative merely because it exists inside:

- Mem0
- a graph database
- SQLite
- a vector database
- an FTS index
- an agent session
- a projection cache

All derived stores must be rebuildable from `.docket/`.

---

## 2.2 Projections are disposable

The following must always be safe:

```bash
rm -rf .docket/.index
docket rebuild
```

After rebuilding, the resulting logical projection must contain the same information represented by the canonical files.

---

## 2.3 The ontology is data, not code

Resource types and relationships must not be hardcoded into the memory engine.

They are defined in:

```text
.docket/entities.yaml
```

The CLI ships with a default SDLC ontology only as an initialization template.

After `docket init`, the repository-owned `entities.yaml` is authoritative.

---

## 2.4 Agents write files, not databases

Claude or any other agent must persist memory by creating or editing files under `.docket/`.

Agents must never directly mutate a projection backend.

Correct:

```text
agent
  ↓
.docket/resources/services/orders.md
  ↓
watcher
  ↓
projection
```

Incorrect:

```text
agent
  ↓
graph database
```

---

## 2.5 Watchers provide continuous synchronization

The system must not depend only on startup ingestion.

After `docket watch` starts, changes made to canonical memory files must be reflected in active projections automatically.

Changes may come from:

- Claude
- a human editor
- another agent
- a script
- `git pull`
- merges
- code generation

The watcher is the synchronization mechanism.

Claude hooks are not the synchronization mechanism.

---

# 3. High-Level Architecture

```text
                    repository
                        │
              .docket/entities.yaml
                        │
               ontology / schema
                        │
                        ▼
               .docket/**/*.md
               canonical memory
                        │
              ┌─────────┴─────────┐
              │                   │
         startup scan       filesystem watch
              │                   │
              └─────────┬─────────┘
                        ▼
                    reconciler
                        │
                parse + validate
                        │
                        ▼
                MemoryDocument
                        │
                projection manager
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
 FileProjection    future Graph     future Vector
        │               │                │
 .docket/.index       Kuzu/etc       Mem0/etc
```

---

# 4. Repository Layout

After initialization, a repository should look approximately like:

```text
.docket/
├── entities.yaml
│
├── resources/
│   ├── repositories/
│   ├── services/
│   ├── libraries/
│   ├── agents/
│   ├── systems/
│   ├── environments/
│   ├── datasources/
│   └── teams/
│
├── decisions/
├── constraints/
├── notes/
│
└── .index/
    ├── manifest.json
    ├── documents.jsonl
    ├── nodes.jsonl
    └── edges.jsonl

.docket.yaml
```

`.docket/.index/` must be generated and should normally be added to `.gitignore`.

Resource directories are conventions rather than schema.

A custom resource type does not require changing the CLI.

For example:

```text
.docket/resources/feature-flags/
```

may be introduced by a project.

---

# 5. Root Configuration

Create:

```text
.docket.yaml
```

Initial format:

```yaml
version: 1

source:
  root: .docket
  include:
    - "**/*.md"

  exclude:
    - ".index/**"

ontology:
  file: .docket/entities.yaml

watch:
  debounceMs: 300

projections:
  - type: file
    output: .docket/.index
```

Future projection configuration may look like:

```yaml
projections:
  - type: file
    output: .docket/.index

  - type: kuzu
    database: .docket/.cache/graph

  - type: mem0
    config: .docket/mem0.yaml
```

The initial implementation only needs `file`.

---

# 6. Ontology Registry

## 6.1 Location

The ontology must live at:

```text
.docket/entities.yaml
```

The default may be changed through `.docket.yaml`, but all implementation should resolve the ontology path through configuration.

---

# 7. Ontology Format

Use:

```yaml
version: 1

resourceTypes: {}

relationships: {}
```

Resource types and relationships are independent registries.

---

# 8. Resource Type Definition

Example:

```yaml
resourceTypes:

  service:
    description: >
      Independently deployable or operated software capability.

    icon: server

    attributes:
      language:
        type: string

      repository:
        type: string

      lifecycle:
        type: string
        enum:
          - experimental
          - active
          - deprecated
          - retired

    extraction:
      instructions: >
        Capture a service when software has a distinct operational,
        deployment, or runtime lifecycle.

      clues:
        - service
        - API
        - backend
        - deployment
        - runtime

      doNotConfuseWith:
        - library
        - repository
```

`icon` is optional: the Lucide icon (https://lucide.dev/icons), by its
kebab-case name, that `docket open` draws the type with. The web UI bundles a
curated set - listed in `packages/docket/src/ontology/icons.ts` - and an icon
outside it loads with an `unknown-icon` warning. A type without an icon uses
docket's built-in icon for the starter ontology's type of that name, and
otherwise a generic one, so ontologies written before `icon` existed still
show every type.

---

# 9. Attribute Types

The first version should support:

```text
string
number
boolean
string[]
number[]
```

And optional:

```yaml
enum:
  - value-a
  - value-b
```

Example:

```yaml
attributes:
  zone:
    type: string
    enum:
      - public
      - private
      - restricted
```

Do not build a complex schema language.

The registry should remain understandable to both humans and LLMs.

---

# 10. Relationship Definition

Relationships should be globally defined.

Example:

```yaml
relationships:

  owned_by:
    description: >
      Identifies the team responsible for a resource.

    from:
      - service
      - repository
      - agent
      - datasource

    to:
      - team

  depends_on:
    description: >
      Represents a runtime, build, or operational dependency.

    from:
      - service
      - agent

    to:
      - service
      - datasource
      - system

    attributes:
      criticality:
        type: string
        enum:
          - low
          - medium
          - high

      runtime:
        type: boolean

  uses:
    description: >
      Represents a resource consuming, invoking, or making use of another.

    from: "*"
    to: "*"

  supersedes:
    from:
      - decision

    to:
      - decision
```

`"*"` means any registered resource type.

---

# 11. Default SDLC Ontology

`docket init` should create a useful but intentionally small starting ontology.

Include at least:

```text
repository
service
library
agent
system
environment
datasource
team
decision
constraint
```

Do not create a huge ontology.

Projects are expected to extend it.

---

# 12. Suggested Default Definitions

## repository

Represents a source-code repository.

Suggested attributes:

```text
url
defaultBranch
```

---

## service

Represents independently deployable or operated software.

Suggested attributes:

```text
language
lifecycle
```

---

## library

Represents reusable code that is normally consumed by other software rather than deployed independently.

Suggested attributes:

```text
language
package
```

---

## agent

Represents an AI or autonomous software agent.

Suggested attributes:

```text
package
runtime
modes
```

---

## system

Represents an internal or external technical system.

---

## environment

Represents an execution or deployment environment.

Suggested attribute:

```yaml
environmentType:
  type: string
  enum:
    - local
    - dev
    - test
    - staging
    - production
```

---

## datasource

Represents a source of information consumed by software or agents.

Suggested attributes:

```yaml
zone:
  type: string
  enum:
    - public
    - private
    - restricted
```

---

## team

Represents an organisational team responsible for resources.

---

## decision

Represents a durable technical or architectural decision.

An extraction instruction should explicitly state:

> Capture a decision only where a concrete choice has been made. Do not capture open questions as decisions.

---

## constraint

Represents a meaningful durable limitation affecting architecture, implementation, deployment, security, operations, or development.

---

# 13. Canonical Memory File Format

Use Markdown with YAML frontmatter.

Minimum valid file:

```markdown
---
id: service.conversation-api
type: service
title: Conversation API
---

# Conversation API

Handles conversation persistence and retrieval.
```

Required fields:

```text
id
type
title
```

---

# 14. Full Memory File Example

```markdown
---
id: agent.research-assistant
type: agent
title: Research Assistant

tags:
  - research
  - agents

attributes:
  package: RA.agent
  runtime: in-process
  modes:
    - fast
    - slow

links:
  - rel: uses
    target: datasource.public-market-1

  - rel: uses
    target: datasource.private-market-3

  - rel: owned_by
    target: team.research-platform

provenance:
  authority: repo
  confidence: 1.0
  capturedBy: human

index:
  graph: true
  fts: true
  vector: true
---

# Research Assistant

The Research Assistant performs research across public and private market data.

## Behaviour

Fast mode prioritizes latency.

Slow mode performs a broader research process.
```

---

# 15. Stable IDs

IDs are globally unique within the repository's memory namespace.

Recommended pattern:

```text
<type>.<semantic-name>
```

Examples:

```text
service.conversation-api
agent.research-assistant
team.platform-engineering
datasource.private-market-3
decision.agent-runtime
constraint.no-outbound-internet
```

IDs must not depend on filesystem path.

Moving:

```text
.docket/resources/services/foo.md
```

to:

```text
.docket/resources/platform/foo.md
```

must not change its identity.

---

# 16. Links

Links represent explicit graph relationships.

Example:

```yaml
links:
  - rel: deployed_to
    target: environment.production
```

A relationship may contain attributes:

```yaml
links:
  - rel: depends_on
    target: service.identity
    attributes:
      criticality: high
      runtime: true
```

The parser must preserve arbitrary validated relationship attributes.

---

# 17. Dangling References

Links may reference resources that have not yet been created.

Example:

```yaml
links:
  - rel: owned_by
    target: team.some-future-team
```

This should produce a validation warning, not a hard error by default.

Reason:

The memory graph may be built incrementally.

`docket validate --strict` may treat unresolved references as errors.

---

# 18. Markdown Body

The Markdown body represents human-readable durable knowledge.

It should be suitable for:

- humans
- FTS
- vector embedding
- LLM retrieval

The frontmatter represents structured metadata and graph information.

Do not require duplicate prose for information already clearly represented in attributes unless it improves human understanding.

---

# 19. Inline Resource References

Optionally recognize:

```text
[[service.identity]]
```

inside Markdown.

These references should initially generate weak/derived references only.

Do not automatically convert them into semantic graph relationships such as `depends_on`.

A future graph projection may represent these as:

```text
MENTIONS
```

Explicit frontmatter links represent asserted semantic relationships.

---

# 20. Provenance

Optional:

```yaml
provenance:
  capturedBy: claude
```

Initial schema:

```text
authority: string        (legacy; not used to judge confidence)
confidence: number 0-1   (stated; stands in only where nothing has evidence)
capturedBy: string
```

Do not make provenance mandatory.

## 20.1 Evidence

A resource and each of its links may carry `evidence`: one entry per
observation, saying where it was seen.

```yaml
evidence:
  - source: code
    path: services/orders/src/k8s.ts
    lines: 14-30
    symbol: ordersDeployment
    commit: 3f2c1d0
    urls:
      - https://github.com/acme/platform/blob/3f2c1d0/services/orders/src/k8s.ts#L14-L30
    observedAt: 2026-10-05
    observedBy: claude
    session: 6c1f0e2a
    note: Builds the Deployment manifest for the orders API.

links:
  - rel: depends_on
    target: secret.orders-db-password
    evidence:
      - source: code
        path: services/orders/src/k8s.ts
        lines: 22
```

`source` names a kind registered under `evidence.sources` in the ontology.
Location fields are `repository`, `path`, `lines`, `symbol`, `key`, `method`,
`endpoint`, `urls` and `commit`; a source kind declares which it `requires`
(all) or `requiresAny` (one of), and validation rejects evidence without them.
Unknown fields are warned about and dropped.

Evidence is append-only: a new sighting adds an entry and never rewrites an
earlier one. Agent-captured files (`capturedBy` other than `human`) are warned
about when the resource or a link records no evidence.

## 20.2 Confidence

Confidence is computed, never written by hand. One observation is worth its
source kind's `confidence`, unless the resource type or relationship declares a
`confidence:` rule for that kind:

```yaml
resourceTypes:
  pod:
    confidence:
      code: 0.3
      runtime: 0.9
```

Observations of one kind do not corroborate each other: the strongest counts.
Independent kinds combine as `1 - Π(1 - c)`, rounded to two decimals. With no
evidence, a resource or link takes the highest stated `provenance.confidence`
of the files that declare it, or `evidence.unevidenced`.

An ontology without `evidence.sources` uses docket's built-in kinds, and a
type or relationship without a `confidence:` block uses docket's built-in rule
for that name, if any. Both come from the default ontology.

---

# 21. Index Controls

Optional:

```yaml
index:
  graph: true
  fts: true
  vector: true
```

Default when omitted:

```yaml
graph: true
fts: true
vector: true
```

These flags are hints for projection implementations.

The file remains canonical regardless of indexing configuration.

---

# 22. Internal Normalized Model

All files must be parsed into one normalized representation before reaching projections.

```ts
export interface MemoryDocument {
  id: string
  type: string
  title: string

  path: string
  hash: string

  tags: string[]

  attributes: Record<string, unknown>

  links: MemoryLink[]

  content: string

  provenance?: MemoryProvenance

  index: {
    graph: boolean
    fts: boolean
    vector: boolean
  }
}
```

Relationships:

```ts
export interface MemoryLink {
  rel: string
  target: string
  attributes?: Record<string, unknown>
}
```

Provenance:

```ts
export interface MemoryProvenance {
  authority?: string
  confidence?: number
  capturedBy?: string
}
```

Each file also normalizes its `evidence` (§20.1), on the document and on each
link.

Projections do not receive documents. Every document that declares an id is
merged into one `MemoryEntity` (§66): links deduplicated per (rel, target),
evidence unioned, and an assessment computed for the entity and each link:

```ts
export interface Assessment {
  confidence: number
  basis: 'evidence' | 'stated' | 'unevidenced'
  evidenceCount: number
  sources: string[]
}
```

The entity's `paths` lists every file, `path` is the first, and `hash` is over
the merged entity, so it changes whenever what is projected does.

Projections must not parse Markdown or YAML themselves.

---

# 23. Parser

Use:

```text
gray-matter
```

for Markdown frontmatter parsing.

Use:

```text
zod
```

for core structural validation.

Ontology-dependent validation should be handled separately.

Parser responsibilities:

1. Parse frontmatter.
2. Parse Markdown content.
3. Normalize omitted optional fields.
4. Generate content hash.
5. Record source path.
6. Return `MemoryDocument`.
7. Report structural validation failures.

---

# 24. Content Hash

Use SHA-256 over the canonical file contents.

Example:

```text
sha256:b84...
```

The hash exists to avoid unnecessary re-projection.

If the hash has not changed, no projection update should occur.

---

# 25. Projection API

Define:

```ts
export interface MemoryProjection {
  readonly name: string

  init?(context: ProjectionContext): Promise<void>

  upsert(entity: MemoryEntity): Promise<void>

  remove(id: string): Promise<void>

  reset?(): Promise<void>

  close?(): Promise<void>
}
```

Context:

```ts
export interface ProjectionContext {
  projectRoot: string
  memoryRoot: string
  stateRoot: string
}
```

Future projection implementations may include:

```text
FileProjection
KuzuProjection
SQLiteFtsProjection
VectorProjection
Mem0Projection
```

None except `FileProjection` are required in v0.

---

# 26. Projection Manager

Implement a manager responsible for fan-out.

Pseudo-code:

```ts
class ProjectionManager {
  constructor(
    private readonly projections: MemoryProjection[]
  ) {}

  async upsert(document: MemoryDocument) {
    await Promise.all(
      this.projections.map(
        projection => projection.upsert(document)
      )
    )
  }

  async remove(id: string) {
    await Promise.all(
      this.projections.map(
        projection => projection.remove(id)
      )
    )
  }
}
```

Failure policy for v0:

- Report failures clearly.
- Do not silently ignore a failed projection.
- A failed projection must not corrupt canonical files.
- Other projections may still succeed.

Future versions may introduce retries or durable queues.

---

# 27. File Projection

The initial projection exists primarily to prove the architecture and inspect normalized output.

Output directory:

```text
.docket/.index/
```

Files:

```text
manifest.json
documents.jsonl
nodes.jsonl
edges.jsonl
```

---

# 28. `documents.jsonl`

One JSON object per entity - every file that declares an id, merged.

Example:

```json
{"content":"The Research Assistant performs research...","id":"agent.research-assistant","path":".docket/resources/agents/research-assistant.md","paths":[".docket/resources/agents/research-assistant.md"],"tags":["research","agents"],"title":"Research Assistant","type":"agent"}
```

---

# 29. `nodes.jsonl`

One node per entity, with its evidence and assessment (§22).

Example:

```json
{"attributes":{"modes":["fast","slow"],"package":"RA.agent","runtime":"in-process"},"basis":"evidence","confidence":0.6,"evidence":[{"path":"agents/ra/src/agent.ts","source":"code"}],"evidenceCount":1,"id":"agent.research-assistant","sources":["code"],"title":"Research Assistant","type":"agent"}
```

---

# 30. `edges.jsonl`

One line per (source, rel, target), however many times it was declared, with
its evidence and assessment.

Example:

```json
{"basis":"unevidenced","confidence":0.5,"evidence":[],"evidenceCount":0,"rel":"uses","source":"agent.research-assistant","sources":[],"target":"datasource.public-market-1"}
```

Relationship attributes:

```json
{"attributes":{"criticality":"high","runtime":true},"basis":"evidence","confidence":0.95,"evidence":[{"key":"dependencies.identity-client","path":"package.json","source":"manifest"}],"evidenceCount":1,"rel":"depends_on","source":"service.orders","sources":["manifest"],"target":"service.identity"}
```

---

# 31. Manifest

Example:

```json
{
  "version": 1,
  "documents": {
    "agent.research-assistant": {
      "path": ".docket/resources/agents/research-assistant.md",
      "hash": "sha256:abc123"
    }
  }
}
```

The manifest maps stable identity to path and last projected hash.

---

# 32. CLI

Package name:

```text
@chrisjowen/docket
```

Binary:

```text
docket
```

Use Commander.

Commands:

```bash
docket init
docket watch
docket sync
docket rebuild
docket validate
docket ontology
```

---

# 33. `docket init`

Creates:

```text
.docket/
.docket/entities.yaml
.docket.yaml
```

It should also create the basic directory structure.

If `.gitignore` exists, offer or automatically add:

```text
.docket/.index/
```

Do not overwrite an existing ontology without explicit force.

Support:

```bash
docket init --force
```

only where behavior is clearly documented.

---

# 34. `docket watch`

Run a foreground filesystem watcher.

Use:

```text
chokidar
```

Watch configured Markdown files.

Example output:

```text
Memory watcher started
Source: .docket/**/*.md
Ontology: .docket/entities.yaml
Projections: file

✓ service.orders updated
✓ decision.agent-runtime added
✓ service.old-api removed
```

Do not daemonize in v0.

The developer environment or process supervisor should own lifecycle.

---

# 35. Filesystem Events

Do not directly expose Chokidar event semantics to projections.

Never assume:

```text
unlink = deleted resource
change = update resource
```

Editors may save files by:

1. writing temporary file
2. deleting original
3. renaming temporary file

Instead:

```text
filesystem event
      ↓
debounce canonical path
      ↓
inspect current filesystem state
      ↓
reconcile desired state
```

Default debounce:

```text
300 ms
```

Configurable through `.docket.yaml`.

---

# 36. Reconciliation Algorithm

For each affected path:

```text
Does file exist?
   │
   ├── yes
   │    ↓
   │   parse
   │    ↓
   │   validate
   │    ↓
   │   hash
   │    ↓
   │   compare with manifest
   │    ↓
   │   changed?
   │      ├── no → stop
   │      └── yes → projection.upsert()
   │
   └── no
        ↓
   find previous document by path
        ↓
   projection.remove(id)
```

Renames are naturally represented as:

```text
old path disappears
new path appears
```

Because identity is stored inside the file, a rename should ultimately preserve the same ID.

The reconciler should avoid deleting and recreating a resource unnecessarily where it can determine that the same ID moved.

---

# 37. Ontology Changes

The watcher must also watch:

```text
.docket/entities.yaml
```

When the ontology changes:

1. Reload ontology.
2. Revalidate existing documents.
3. Report invalid resources.
4. Re-project resources if normalized interpretation changes.

For v0 it is acceptable to perform a full `sync` when ontology changes.

---

# 38. `docket sync`

Perform one complete reconciliation pass.

Algorithm:

```text
load configuration
load ontology
scan canonical files
parse all documents
validate all documents
compare against manifest
upsert changed/new documents
remove missing documents
persist manifest
exit
```

This command should be safe to run:

- at startup
- in CI
- after git pull
- after branch change

---

# 39. `docket rebuild`

Semantics:

```text
load files
validate
reset projections
project every canonical document
create new manifest
```

Equivalent logical behavior:

```bash
rm -rf .docket/.index
docket sync
```

but implemented through the projection interface.

---

# 40. `docket validate`

Validate:

- Markdown/frontmatter structure.
- Required fields.
- files that share an ID but disagree on its type (§66).
- registered resource type.
- attributes against type definitions.
- relationship existence.
- source resource allowed for relationship.
- target type where target exists.
- evidence source kinds and the locations they require (§20.1).
- relationship attributes.
- confidence range.
- unresolved references.

Example:

```text
✓ 42 resources
✓ 91 relationships
⚠ 2 unresolved relationships

WARN service.orders
  owned_by → team.payments-platform
  Target resource does not currently exist.
```

Return non-zero for actual structural/schema failures.

Warnings do not produce failure unless:

```bash
docket validate --strict
```

---

# 41. `docket ontology`

Provide simple inspection tooling.

Required:

```bash
docket ontology list
docket ontology show service
```

Optional later:

```bash
docket ontology diff-defaults
docket ontology upgrade
```

Do not automatically upgrade the repository ontology when the CLI changes.

---

# 42. Package Layout

Recommended:

```text
packages/
└── docket/
    ├── src/
    │   ├── cli.ts
    │   │
    │   ├── commands/
    │   │   ├── init.ts
    │   │   ├── watch.ts
    │   │   ├── sync.ts
    │   │   ├── rebuild.ts
    │   │   ├── validate.ts
    │   │   └── ontology.ts
    │   │
    │   ├── config/
    │   │   ├── config.ts
    │   │   └── defaults.ts
    │   │
    │   ├── ontology/
    │   │   ├── model.ts
    │   │   ├── loader.ts
    │   │   ├── validator.ts
    │   │   └── default-sdlc.yaml
    │   │
    │   ├── source/
    │   │   ├── parser.ts
    │   │   ├── scanner.ts
    │   │   └── hashing.ts
    │   │
    │   ├── watcher/
    │   │   ├── watcher.ts
    │   │   ├── debounce.ts
    │   │   └── reconciler.ts
    │   │
    │   ├── projection/
    │   │   ├── projection.ts
    │   │   ├── manager.ts
    │   │   ├── registry.ts
    │   │   └── file/
    │   │       └── file-projection.ts
    │   │
    │   ├── manifest/
    │   │   └── manifest.ts
    │   │
    │   └── model/
    │       ├── document.ts
    │       ├── ontology.ts
    │       └── relationship.ts
    │
    ├── package.json
    └── tsconfig.json
```

---

# 43. Dependencies

Prefer a small dependency set.

Suggested:

```json
{
  "dependencies": {
    "chokidar": "...",
    "commander": "...",
    "gray-matter": "...",
    "zod": "...",
    "yaml": "..."
  }
}
```

Do not add a database dependency in core.

---

# 44. Projection Registration

Projection implementations should be loaded through configuration.

For v0, built-in registry is sufficient:

```ts
const projectionFactories = {
  file: createFileProjection
}
```

Do not dynamically load arbitrary Node packages yet unless needed.

Design the interface so this can be introduced later.

Future syntax could support:

```yaml
projections:
  - type: "@company/memory-kuzu"
```

but this is not required now.

---

# 45. Claude Code Plugin

Create a Claude Code plugin separately from the CLI.

Suggested layout:

```text
plugins/
└── docket/
    ├── .claude-plugin/
    │   └── plugin.json
    │
    ├── skills/
    │   ├── docket/
    │   │   └── SKILL.md
    │   ├── remember/
    │   │   └── SKILL.md
    │   └── ontology/
    │       └── SKILL.md
    │
    ├── hooks/
    │   └── hooks.json
    │
    └── scripts/
        └── session-start.js
```

---

# 46. Claude Plugin Responsibilities

The Claude plugin is responsible for agent behavior.

It should teach Claude:

- where memory is stored
- how memory files work
- how to inspect the ontology
- what information deserves durable capture
- how to update existing resources
- how to create new resource types
- how to create relationships
- when not to create memory

It must not own:

- indexing
- filesystem synchronization
- projection lifecycle
- graph persistence
- vector persistence

Those belong to the CLI.

---

# 47. Main `docket` Skill

The skill must state clearly:

```text
Repository memory is stored under .docket/.

.docket/entities.yaml defines the resource types and relationships available
for this repository.

Never assume a fixed ontology.

Read .docket/entities.yaml before performing structured memory extraction.
```

It should instruct Claude to capture durable knowledge including:

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
- information trivially discoverable from nearby code unless its meaning is non-obvious or strategically important

---

# 48. Memory Extraction Procedure

The skill should instruct the agent:

1. Read `.docket/entities.yaml`.
2. Search `.docket/` for existing matching resources.
3. Identify durable new information.
4. Match concepts to existing resource types.
5. Update existing resources where possible.
6. Create new resources only when necessary.
7. Add explicit relationships.
8. Keep Markdown concise.
9. Never directly edit `.docket/.index/`.
10. Allow the watcher to update projections.

---

# 49. Updating Existing Memory

The agent should prefer:

```text
update existing canonical memory
```

over:

```text
create another conflicting memory
```

Example:

If:

```text
agent.research-assistant
```

moves from an in-process runtime to Databricks, modify the existing file.

Do not create:

```text
agent.research-assistant-v2
```

unless it is genuinely a different resource.

---

# 50. Ontology Extension

The agent is allowed to extend `.docket/entities.yaml`.

Instruction:

> Prefer existing resource types where semantics are genuinely equivalent. Add a new resource type when an important durable concept cannot be represented accurately using existing types.

Before creating a new resource type, check for semantic duplication.

Avoid proliferation such as:

```text
service
backend_service
microservice
api_service
application_service
```

unless the project explicitly needs those distinctions.

---

# 51. Ontology Extension Example

If a project introduces feature flags:

```yaml
resourceTypes:

  feature_flag:
    description: >
      Runtime configurable feature controlling software behaviour.

    attributes:
      key:
        type: string

      default:
        type: boolean

    extraction:
      instructions: >
        Capture significant feature flags whose existence or lifecycle
        matters across development sessions.
```

Relationships:

```yaml
relationships:

  controls:
    description: >
      Indicates that a resource controls availability or behaviour
      of another resource.

    from:
      - feature_flag

    to:
      - service
      - agent
```

---

# 52. Explicit `remember` Skill

Provide an explicit skill for requests such as:

```text
remember this
capture this
add this to the docket
record this decision
```

Procedure:

1. Read ontology.
2. Search existing memory.
3. Determine whether update or create.
4. Modify canonical Markdown.
5. Add relationships where meaningful.
6. Do not manually update derived indexes.

---

# 53. Ontology Skill

Provide an ontology-oriented skill for instructions such as:

```text
add a new resource type
extend the memory model
how should this concept be represented?
```

The skill should:

- inspect current ontology
- prefer reuse
- identify missing semantics
- add resource type or relationships conservatively
- retain backwards compatibility where practical
- avoid destructive ontology rewrites without clear need

---

# 54. Session Start Hook

On Claude session start, inject context similar to:

```text
This repository uses local-first team memory.

Canonical memory is stored under `.docket/`.

`.docket/entities.yaml` defines the repository's resource types,
relationship types, attributes, and extraction guidance.

When durable project knowledge is needed, consult `.docket/`.

When durable project knowledge is established or materially changed,
capture it by updating canonical files under `.docket/`.

Never edit `.docket/.index/`; it is generated.
```

The hook may also run:

```bash
docket sync
```

if the local CLI is available.

Failure to run `docket sync` should not prevent Claude from working.

Do not start a permanent daemon from the Claude hook.

---

# 55. Stop Hook

On stopping a substantial Claude session, invoke an LLM/prompt-based review.

Prompt intent:

```text
Review the session for durable project knowledge.

Read `.docket/entities.yaml`.

Determine whether this session established or materially changed:

- resource instances
- attributes
- relationships
- architectural decisions
- durable constraints
- significant conventions

If so, update the canonical `.docket/` files before completing.

Do not capture transient debugging details, unresolved speculation,
or ordinary conversational information.

If an important concept cannot be represented by the current ontology,
extend `.docket/entities.yaml` conservatively first.
```

The stop hook should not blindly create files.

The LLM must exercise judgement.

---

# 56. Do Not Use Tool Hooks for Projection

Do not use Claude `PostToolUse` hooks to update indexes.

The filesystem watcher is responsible for projection.

This ensures memory changes from all tools and humans are handled consistently.

Correct:

```text
Claude Write/Edit
       ↓
filesystem
       ↓
docket watch
```

not:

```text
Claude PostToolUse
       ↓
database update
```

---

# 57. Claude Plugin Manifest

Create:

```text
.claude-plugin/plugin.json
```

Example:

```json
{
  "name": "docket",
  "version": "0.1.0",
  "description": "Local-first project knowledge, captured and classified as Markdown",
  "author": {
    "name": "Platform Engineering"
  }
}
```

---

# 58. CLI Installation

The CLI should normally be a project development dependency.

Example:

```json
{
  "devDependencies": {
    "@chrisjowen/docket": "^0.1.0"
  },
  "scripts": {
    "docket:watch": "docket watch",
    "docket:sync": "docket sync",
    "docket:validate": "docket validate"
  }
}
```

Do not make Claude plugin installation responsible for secretly modifying the repository's npm dependencies.

---

# 59. Claude Plugin Installation

Support installation through the organization's Claude plugin distribution mechanism.

Expected usage should eventually look similar to:

```text
/plugin install docket@docket
```

Local development of the plugin may use an unpacked plugin directory.

The CLI and Claude plugin are separate artifacts.

---

# 60. Developer Workflow

A normal development session should look like:

```text
git clone
npm install
npm run docket:watch
```

Or as part of an existing dev command:

```text
npm run dev
```

which may supervise:

```text
application
frontend
docket watch
```

---

# 61. Example Flow: Human Edit

Developer edits:

```text
.docket/resources/services/orders.md
```

Flow:

```text
save file
  ↓
chokidar event
  ↓
debounce
  ↓
parse
  ↓
validate against entities.yaml
  ↓
hash comparison
  ↓
FileProjection.upsert()
  ↓
.index updated
```

---

# 62. Example Flow: Claude Learns a Decision

Conversation establishes:

> Databricks will host the Research Assistant.

Claude:

1. Reads ontology.
2. Finds `agent.research-assistant`.
3. Updates its relationships.
4. Optionally updates relevant decision memory.
5. Saves Markdown.

Watcher automatically projects changes.

---

# 63. Example Flow: Unknown Concept

Claude discovers that feature flags are strategically important.

No `feature_flag` resource type exists.

Claude:

1. Reads ontology.
2. Determines existing types do not represent it accurately.
3. Adds `feature_flag`.
4. Adds appropriate relationships.
5. Creates the relevant resource file.
6. Saves both files.

Watcher detects ontology change and resource change.

---

# 64. Branch Semantics

Because memory is stored in Git-controlled files, branch state naturally determines team memory.

Example:

```text
main
  .docket decision says runtime = AWS

feature/databricks
  .docket decision says runtime = Databricks
```

Checking out the branch should cause:

```text
docket sync
```

or watcher filesystem events to reconcile projections to the checked-out state.

No special branch-aware database logic should be required.

---

# 65. Merge Conflicts

Memory files should behave like normal source-controlled files.

Do not build custom merge semantics in v0.

Human or agent resolves Git conflicts normally.

Stable IDs let two branches that captured the same resource merge into one
entity rather than two (§66).

---

# 66. Files That Share an ID

Several files may define the same ID:

```text
.docket/services/foo.md
.docket/captured/foo-running.md
```

both containing:

```yaml
id: service.foo
```

They are observations of one resource - two branches capturing the same
service, or a later sighting written separately - and are merged into one
entity (§22), not rejected:

- The first file by path is primary: its type and title stand, and so do its
  attribute values; a later file that disagrees gets a `conflicting-attribute`
  warning.
- Tags, mentions, links and evidence are unioned, never overwritten. Links are
  deduplicated per (rel, target), their evidence combined.
- Bodies are kept in path order, each distinct body once.
- A file that gives the ID a different type describes something else: it gets
  a `conflicting-type` error and is left out of the entity.

A broken file holds the whole entity it contributed to at its previous
projection (§67) until it is fixed.

---

# 67. Error Handling During Watch

If a developer temporarily creates invalid YAML while editing:

- report the error
- retain the previous valid projection
- do not remove the existing indexed resource
- retry when another filesystem event occurs

Example:

```text
ERROR .docket/resources/services/orders.md
Invalid frontmatter at line 7.

Previous projection retained.
```

This is important.

Editing a temporarily invalid file should not erase known memory.

---

# 68. Atomic Projection Updates

Where practical, FileProjection should write generated output atomically.

Recommended pattern:

```text
write temporary file
fsync/close
rename over final file
```

Avoid leaving half-written JSONL indexes.

---

# 69. Projection Ordering

Do not rely on filesystem event ordering.

The desired state is always derived from the current canonical filesystem.

For correctness:

```text
current files
+
current ontology
=
desired projection state
```

Events are merely hints that reconciliation is needed.

---

# 70. Testing Strategy

Implement unit tests for:

- Markdown parsing.
- normalization.
- hashing.
- ontology loading.
- type validation.
- relationship validation.
- dangling relationships.
- merging files that share an ID, and the confidence their evidence earns.
- manifest behavior.
- create/update/delete reconciliation.
- rename handling.
- temporary invalid files.
- ontology changes.
- FileProjection output.

---

# 71. Watcher Integration Tests

Test:

```text
start watcher
create memory
verify projection
edit memory
verify projection
delete memory
verify projection
```

Also test common editor behavior:

```text
temporary file
unlink original
rename temporary
```

The resulting projection must remain correct.

---

# 72. Rebuild Determinism

Create a test proving:

```text
docket rebuild
```

from identical canonical files produces logically identical:

```text
documents
nodes
edges
```

Do not require byte-identical ordering unless deliberately specified.

Prefer deterministic ordering where easy.

---

# 73. Performance Expectations

The initial target is typical engineering repositories, not internet-scale knowledge graphs.

Assume:

```text
10–10,000 memory documents
```

Startup scan and sync should be efficient enough for local development.

Do not introduce distributed infrastructure.

---

# 74. Security

Canonical memory is repository content.

Never automatically capture:

- credentials
- secrets
- tokens
- private keys
- passwords

Claude skill instructions must explicitly state this.

If such information appears during a session, it must not be persisted to `.docket/`.

---

# 75. Future Projection: Graph

The design should support later implementation:

```ts
class KuzuProjection implements MemoryProjection
```

Mapping:

```text
MemoryDocument
    ↓
node(id, type, attributes)

MemoryLink
    ↓
edge(source, rel, target, attributes)
```

The canonical schema must not depend on Kuzu, Cypher, Neo4j, or another graph implementation.

---

# 76. Future Projection: FTS

Expected mapping:

```text
id
type
title
tags
content
path
```

Searchable fields:

```text
title
tags
content
```

Potential implementation:

```text
SQLite FTS5
```

Not required in v0.

---

# 77. Future Projection: Vector

Expected chunking may use Markdown headings.

Example derived chunk:

```json
{
  "id": "agent.research-assistant#behaviour",
  "documentId": "agent.research-assistant",
  "heading": "Behaviour",
  "content": "Fast mode prioritizes latency..."
}
```

The vector projection chooses chunking.

Canonical memory files do not contain embedding implementation details.

---

# 78. Future Projection: Mem0

Mem0 should be implemented as another `MemoryProjection`.

It must not become the canonical store.

Potential behavior:

```text
upsert document
  ↓
remove previous memories associated with document ID
  ↓
extract/index latest contents
```

Store canonical `document.id` and source hash in Mem0 metadata.

Implementation is outside v0.

> Implemented after v0 as `type: mem0` with `mode: platform | oss`; see the
> README. The file projection is now named `jsonl` (`file` is still accepted),
> and the manifest lives in `state.dir` rather than inside it.

---

# 79. Future Projection: Remote Team Memory

A future organization may consume the same canonical files centrally:

```text
Git repository
     ↓
central ingestion
     ↓
enterprise graph/vector/FTS
```

The local file format must not need to change.

This is a major architectural goal.

---

# 80. Non-Goals for V0

Do not implement:

- web UI
- central server
- authentication
- Neo4j
- Kuzu
- Mem0
- embeddings
- vector search
- FTS search
- cloud sync
- GitHub webhooks
- merge conflict resolution
- automatic ontology migrations
- arbitrary third-party plugin loading
- sophisticated event persistence
- distributed message queues

Keep v0 focused on proving the canonical-file and projection model.

---

# 81. V0 Acceptance Criteria

The implementation is complete when all of the following work.

## Initialization

```bash
docket init
```

creates:

```text
.docket.yaml
.docket/entities.yaml
.docket/resources/
.docket/decisions/
.docket/constraints/
```

with a default SDLC ontology.

---

## Validation

Given:

```markdown
---
id: service.orders
type: service
title: Orders
---
```

`docket validate` succeeds.

Unknown type:

```yaml
type: spaceship
```

fails unless `spaceship` exists in `entities.yaml`.

---

## Projection

Running:

```bash
docket rebuild
```

creates:

```text
.docket/.index/documents.jsonl
.docket/.index/nodes.jsonl
.docket/.index/edges.jsonl
.docket/.index/manifest.json
```

---

## Continuous update

With:

```bash
docket watch
```

running, editing a canonical file automatically updates the file projection without restarting the process.

---

## Delete

Deleting a canonical file removes its corresponding generated projection.

---

## Invalid intermediate save

Temporarily invalid Markdown/YAML does not erase the previously valid projection.

---

## Ontology extension

Adding:

```yaml
feature_flag:
```

to `entities.yaml` permits creation of:

```yaml
type: feature_flag
```

without changing application code.

---

## Relationship extension

Adding a relationship to the registry immediately allows valid resources to use it.

---

## Claude integration

The Claude plugin:

- explains the memory convention at session start
- reads `entities.yaml`
- captures durable knowledge by editing canonical files
- can extend the ontology
- performs memory review at session completion
- never writes derived indexes directly

---

# 82. Initial Implementation Order

Implement in this order:

1. TypeScript models.
2. Configuration loading.
3. Default SDLC ontology.
4. `docket init`.
5. Frontmatter parser.
6. Ontology validator.
7. Scanner.
8. Manifest.
9. Projection API.
10. FileProjection.
11. `docket sync`.
12. `docket rebuild`.
13. `docket validate`.
14. Chokidar watcher.
15. Reconciler.
16. `docket watch`.
17. Ontology CLI inspection.
18. Claude plugin.
19. Tests.
20. Example repository.

Do not begin graph/vector integrations until the above contract is stable.

---

# 83. Key Architectural Invariant

The implementation must preserve this model:

```text
          ontology
             +
        canonical files
             │
             │ authoritative
             ▼
        reconciliation
             │
             ▼
         projections
             │
      disposable / rebuildable
```

Or stated another way:

> The filesystem is the durable memory protocol.

> The ontology defines what structured knowledge means.

> The watcher turns filesystem changes into normalized resource changes.

> Projections provide query capabilities.

> Agents participate by editing the same canonical representation as humans.

This invariant is more important than any specific library or database choice.

I’d use this as the build spec and keep Kuzu/Mem0/FTS explicitly out of the first implementation so the projection contract gets proven before any backend starts shaping the model.