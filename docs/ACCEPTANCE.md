# V0 Acceptance Record

Every acceptance criterion in [SPEC §81](SPEC.md) run against the built
CLI. Each block below is the command as executed followed by its real
combined stdout and stderr and its exit code. Nothing here is illustrative.

The record predates the rename to docket, so it shows the `memory` command,
the `.memory/` layout, `.memory.yaml` and the `team-memory` plugin as they were
when it was run. They are now `docket`, `.docket/`, `.docket.yaml` and the
`docket` plugin.

The Claude plugin has also changed since (section 9). It was recorded at
plugin version 0.1.0, when a `Stop` hook blocked the session after a turn and
asked the model itself to review it. The review now runs in the background
as the session goes and when it ends: the `Stop`, `PreCompact` and
`SessionEnd` hooks start a detached headless `claude -p` on a small model,
over only the transcript lines no review has seen. The SessionStart sync no
longer blocks either. Section 9 still shows
what was run then; the plugin's own tests (`packages/claude-plugin/test/`)
cover the hooks as they are now.

`memory` on the path is a two-line wrapper around the built CLI:

```sh
#!/bin/sh
exec node "$ROOT/packages/memory/dist/cli.js" "$@"
```

Three working directories are used, shown in each block as `$ cd <dir>`:

- `team-memory/` - the repository root
- `examples/acme-platform/` - the committed example, see its
  [README](../examples/README.md)
- `/tmp/<name>/` - throwaway directories, so criteria that mutate or delete
  files never touch the committed example. These labels are abbreviated; the
  real paths were under a session temp directory and appear in full wherever a
  command printed one.


```console
$ cd team-memory/
$ node --version && pnpm --version
v22.22.0
10.28.2

(exit 0)
```

```console
$ cd team-memory/
$ pnpm -C /Users/chrisowen/Dev/platform/team-memory/packages/memory build

> @team-memory/cli@0.0.0 build /Users/chrisowen/Dev/platform/team-memory/packages/memory
> tsc -p tsconfig.json && mkdir -p dist/ontology && cp src/ontology/*.yaml dist/ontology/


(exit 0)
```

## Summary

| # | Criterion (§81) | Result |
|---|---|---|
| 1 | Initialization | PASS |
| 2 | Validation | PASS |
| 3 | Projection | PASS |
| 4 | Continuous update | PASS |
| 5 | Delete | PASS |
| 6 | Invalid intermediate save | PASS |
| 7 | Ontology extension | PASS |
| 8 | Relationship extension | PASS |
| 9 | Claude integration | PARTIAL - mechanically checkable parts pass, model behaviour untested |

Two further checks, neither of them §81 criteria: the §80 non-goals stayed
out, and rebuilds are byte-identical (§72).

---

## 1. Initialization

**Criterion.** `memory init` creates `.memory.yaml`, `.memory/entities.yaml`,
`.memory/resources/`, `.memory/decisions/` and `.memory/constraints/`, with
a default SDLC ontology.

Run in an empty directory.

```console
$ cd /tmp/init-demo/
$ memory init
Initialized team memory in /private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/init-demo
  created .memory/
  created .memory/resources/repositories/
  created .memory/resources/services/
  created .memory/resources/libraries/
  created .memory/resources/agents/
  created .memory/resources/systems/
  created .memory/resources/environments/
  created .memory/resources/datasources/
  created .memory/resources/teams/
  created .memory/decisions/
  created .memory/constraints/
  created .memory/notes/
  created .memory/.index/
  created .memory.yaml
  created .memory/entities.yaml

(exit 0)
```

```console
$ cd /tmp/init-demo/
$ find . | sort
.
./.memory
./.memory.yaml
./.memory/.index
./.memory/constraints
./.memory/decisions
./.memory/entities.yaml
./.memory/notes
./.memory/resources
./.memory/resources/agents
./.memory/resources/datasources
./.memory/resources/environments
./.memory/resources/libraries
./.memory/resources/repositories
./.memory/resources/services
./.memory/resources/systems
./.memory/resources/teams

(exit 0)
```

```console
$ cd /tmp/init-demo/
$ cat .memory.yaml
version: 1

source:
  root: .memory
  include:
    - "**/*.md"

  exclude:
    - ".index/**"

ontology:
  file: .memory/entities.yaml

watch:
  debounceMs: 300

projections:
  - type: file
    output: .memory/.index

(exit 0)
```

```console
$ cd /tmp/init-demo/
$ memory ontology list
/private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/init-demo/.memory/entities.yaml (version 1)

Resource types (10)
  agent        An AI or autonomous software agent.
  constraint   A meaningful durable limitation affecting architecture, implementation, deployment, security, operations, or development.
  datasource   A source of information consumed by software or agents.
  decision     A durable technical or architectural decision.
  environment  An execution or deployment environment.
  library      Reusable code consumed by other software rather than deployed independently.
  repository   A source-code repository.
  service      Independently deployable or operated software capability.
  system       An internal or external technical system.
  team         An organisational team responsible for resources.

Relationships (5)
  depends_on   service, agent → service, datasource, system
  deployed_to  service, agent → environment
  owned_by     service, repository, agent, datasource → team
  supersedes   decision → decision
  uses         * → *

(exit 0)
```

All five required paths exist. The ontology holds exactly the ten resource
types §11 asks for, and no more. **PASS.**

One behaviour worth recording because it is not in §81: `init` appends
`.memory/.index/` to a `.gitignore` that already exists but never creates
one. This directory had no `.gitignore`, so none was written.

---

## 2. Validation

**Criterion.** A minimal `service.orders` file validates. `type: spaceship`
fails unless `spaceship` exists in `entities.yaml`.

### 2a. The example repository validates

```console
$ cd examples/acme-platform/
$ memory validate
✓ 21 memory resources
✓ 37 relationships

(exit 0)
```

```console
$ cd examples/acme-platform/
$ memory validate --strict
✓ 21 memory resources
✓ 37 relationships

(exit 0)
```

21 resources, 37 relationships, no diagnostics. `--strict` is clean too, so
every link target in the example resolves to a real resource.

### 2b. The minimal file from §81 passes

```console
$ cd /tmp/validate-demo/
$ cat .memory/resources/services/orders.md
---
id: service.orders
type: service
title: Orders
---

(exit 0)
```

```console
$ cd /tmp/validate-demo/
$ memory validate
✓ 1 memory resources
✓ 0 relationships

(exit 0)
```

### 2c. An unknown type fails

```console
$ cd /tmp/validate-demo/
$ cat .memory/resources/services/orders.md
---
id: service.orders
type: spaceship
title: Orders
---

(exit 0)
```

```console
$ cd /tmp/validate-demo/
$ memory validate
✓ 1 memory resources
✓ 0 relationships

.memory/resources/services/orders.md
  ERROR unknown-type: Resource type "spaceship" is not registered in the ontology.

(exit 1)
```

Non-zero exit, the offending file named, a machine-readable code.

### 2d. Registering the type makes the same file valid

```console
$ cd /tmp/validate-demo/
$ grep -n -A2 '^  spaceship:' .memory/entities.yaml
268:  spaceship:
269-    description: >
270-      A spaceship.

(exit 0)
```

```console
$ cd /tmp/validate-demo/
$ memory validate
✓ 1 memory resources
✓ 0 relationships

(exit 0)
```

The resource file is byte-identical between 2c and 2d, and no application
code was touched. Only `entities.yaml` changed. **PASS.**

---

## 3. Projection

**Criterion.** `memory rebuild` creates `documents.jsonl`, `nodes.jsonl`,
`edges.jsonl` and `manifest.json` under `.memory/.index/`.

```console
$ cd examples/acme-platform/
$ rm -rf .memory/.index && memory rebuild
✓ 21 projected from scratch

(exit 0)
```

```console
$ cd examples/acme-platform/
$ ls -1 .memory/.index
documents.jsonl
edges.jsonl
manifest.json
nodes.jsonl

(exit 0)
```

```console
$ cd examples/acme-platform/
$ wc -l .memory/.index/*.jsonl
      21 .memory/.index/documents.jsonl
      37 .memory/.index/edges.jsonl
      21 .memory/.index/nodes.jsonl
      79 total

(exit 0)
```

All four files, 21 documents, 21 nodes, 37 edges - matching what `validate`
reported. Sample records:

```console
$ cd examples/acme-platform/
$ head -2 .memory/.index/nodes.jsonl
{"attributes":{"modes":["fast","slow"],"package":"@acme/research-assistant","runtime":"databricks"},"id":"agent.research-assistant","title":"Research Assistant","type":"agent"}
{"attributes":{},"id":"constraint.eu-data-residency","title":"Customer data stays in the EU","type":"constraint"}

(exit 0)
```

```console
$ cd examples/acme-platform/
$ grep '"source":"service.checkout"' .memory/.index/edges.jsonl
{"attributes":{"criticality":"high","runtime":true},"rel":"depends_on","source":"service.checkout","target":"service.orders"}
{"rel":"deployed_to","source":"service.checkout","target":"environment.production"}
{"rel":"guarded_by","source":"service.checkout","target":"feature_flag.checkout-rewrite"}
{"rel":"owned_by","source":"service.checkout","target":"team.platform-engineering"}
{"rel":"uses","source":"service.checkout","target":"library.order-events"}

(exit 0)
```

```console
$ cd examples/acme-platform/
$ head -c 380 .memory/.index/manifest.json
{
  "documents": {
    "agent.research-assistant": {
      "hash": "sha256:3eed55fc5068901ac3674867cd89655da56784e475e00ceed2329a30fe194da4",
      "path": ".memory/resources/agents/research-assistant.md"
    },
    "constraint.eu-data-residency": {
      "hash": "sha256:4e28989584ce0ef06e33289c5266ba0e1bfe7e0e8d028e0afe40909745b67938",
      "path": ".memory/constraints/eu-dat
(exit 0)
```

Relationship attributes survive into the edge records, and the manifest
carries the content hash and repo-relative path per document. **PASS.**

### Rebuild determinism (§72, not a §81 criterion)

The claim that projections are disposable only holds if a rebuild is
byte-identical.

```console
$ cd examples/acme-platform/
$ cp -R .memory/.index /private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/index-a && rm -rf .memory/.index && memory rebuild >/dev/null && diff -r /private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/index-a .memory/.index && echo 'byte-identical'
byte-identical

(exit 0)
```

---

## 4-6. Continuous update, delete, invalid intermediate save

These three criteria share a single long-running `memory watch` process,
because that is the thing under test: the process is never restarted
between them. They run against a throwaway copy of the example so the
committed example is not mutated.

```console
$ cd /tmp/watch-demo/
$ ls -a .memory
.
..
constraints
decisions
entities.yaml
notes
resources

(exit 0)
```

Start the watcher in the background, its combined output going to
`watch.log`:

```console
$ cd /tmp/watch-demo/
$ memory watch > watch.log 2>&1 &
```

The watcher runs a full sync before it starts watching, so the index is
already correct when the first event arrives:

```console
$ cd /tmp/watch-demo/
$ head -6 watch.log
✓ constraint.eu-data-residency added
✓ constraint.pci-scope added
✓ decision.orders-on-dynamodb added
✓ decision.orders-on-postgres added
✓ decision.research-assistant-on-databricks added
✓ agent.research-assistant added

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ wc -l .memory/.index/nodes.jsonl
      21 .memory/.index/nodes.jsonl

(exit 0)
```

### 4. Continuous update

**Criterion.** With `memory watch` running, editing a canonical file
automatically updates the file projection without restarting the process.

This is the SPEC §61 flow: a developer edits
`.memory/resources/services/orders.md`.

Projected state before the edit:

```console
$ cd /tmp/watch-demo/
$ grep '"id":"service.orders"' .memory/.index/nodes.jsonl
{"attributes":{"language":"typescript","lifecycle":"active"},"id":"service.orders","title":"Orders","type":"service"}

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep -c 'service.orders' .memory/.index/edges.jsonl
9

(exit 0)
```

Now the edit - `lifecycle` goes to `deprecated` and a second `deployed_to`
link is added:

```console
$ cd /tmp/watch-demo/
$ sed -n '9,12p;30,36p' .memory/resources/services/orders.md

attributes:
  language: typescript
  lifecycle: deprecated
  - rel: uses
    target: library.order-events

  - rel: deployed_to
    target: environment.production

  - rel: deployed_to

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ tail -2 watch.log
watching /private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/watch-demo/.memory
✓ service.orders updated

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep '"id":"service.orders"' .memory/.index/nodes.jsonl
{"attributes":{"language":"typescript","lifecycle":"deprecated"},"id":"service.orders","title":"Orders","type":"service"}

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep 'service.orders' .memory/.index/edges.jsonl | grep deployed_to
{"rel":"deployed_to","source":"service.orders","target":"environment.production"}
{"rel":"deployed_to","source":"service.orders","target":"environment.staging"}

(exit 0)
```

The attribute changed and the new edge appeared, with no restart. **PASS.**

### 5. Delete

**Criterion.** Deleting a canonical file removes its corresponding
generated projection.

Before - `service.conversation-api` is present as a node, a document and
the source of three edges:

```console
$ cd /tmp/watch-demo/
$ grep -c '"id":"service.conversation-api"' .memory/.index/nodes.jsonl
1

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep -c '"id":"service.conversation-api"' .memory/.index/documents.jsonl
1

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep '"source":"service.conversation-api"' .memory/.index/edges.jsonl
{"attributes":{"criticality":"high","runtime":true},"rel":"depends_on","source":"service.conversation-api","target":"datasource.sessions"}
{"rel":"deployed_to","source":"service.conversation-api","target":"environment.production"}
{"rel":"owned_by","source":"service.conversation-api","target":"team.platform-engineering"}

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ rm .memory/resources/services/conversation-api.md

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ tail -1 watch.log
✓ service.conversation-api removed

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep -c '"id":"service.conversation-api"' .memory/.index/nodes.jsonl
0

(exit 1)
```

```console
$ cd /tmp/watch-demo/
$ grep -c '"id":"service.conversation-api"' .memory/.index/documents.jsonl
0

(exit 1)
```

```console
$ cd /tmp/watch-demo/
$ grep -c '"source":"service.conversation-api"' .memory/.index/edges.jsonl
0

(exit 1)
```

```console
$ cd /tmp/watch-demo/
$ grep -c 'service.conversation-api' .memory/.index/manifest.json
0

(exit 1)
```

Node, document, outbound edges and manifest entry are all gone (`grep -c`
exits 1 when it counts zero). **PASS.**

Note what is *not* removed: inbound edges from other files that still
reference the deleted id, and prose mentions of it in other documents.
That is correct - those files were not edited, and §17 treats an
unresolved reference as a warning, not an error:

```console
$ cd /tmp/watch-demo/
$ grep '"target":"service.conversation-api"' .memory/.index/edges.jsonl; echo "(exit $?)"
(exit 1)

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ memory validate; true
✓ 20 memory resources
✓ 35 relationships

(exit 0)
```

### 6. Invalid intermediate save

**Criterion.** Temporarily invalid Markdown/YAML does not erase the
previously valid projection.

The state that has to survive:

```console
$ cd /tmp/watch-demo/
$ grep '"id":"service.orders"' .memory/.index/nodes.jsonl
{"attributes":{"language":"typescript","lifecycle":"deprecated"},"id":"service.orders","title":"Orders","type":"service"}

(exit 0)
```

Save `orders.md` halfway through an edit - unterminated frontmatter and an
unclosed flow sequence:

```console
$ cd /tmp/watch-demo/
$ cat .memory/resources/services/orders.md
---
id: service.orders
type: service
title: Orders
attributes:
  language: typescript
  lifecycle: [deprecated
links:
  - rel: depends_on

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ tail -3 watch.log
ERROR .memory/resources/services/orders.md Unparseable frontmatter: missed comma between flow collection entries at line 8, column 1:
    links:
    ^

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep '"id":"service.orders"' .memory/.index/nodes.jsonl
{"attributes":{"language":"typescript","lifecycle":"deprecated"},"id":"service.orders","title":"Orders","type":"service"}

(exit 0)
```

Reported, not projected, and the previous record is untouched.

The other kind of invalid save - parseable YAML that violates the ontology.
This one matters more, because the document parses fine and a naive
implementation would happily project it:

```console
$ cd /tmp/watch-demo/
$ tail -1 watch.log
ERROR .memory/resources/services/orders.md Relationship "telepathically_linked_to" is not registered in the ontology.

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep '"id":"service.orders"' .memory/.index/nodes.jsonl
{"attributes":{"language":"typescript","lifecycle":"deprecated"},"id":"service.orders","title":"Orders","type":"service"}

(exit 0)
```

`lifecycle` is still `deprecated`, not the `retired` in the invalid save -
the bad version was rejected whole rather than partially applied.

Finishing the edit re-projects it, so the watcher recovers without a
restart:

```console
$ cd /tmp/watch-demo/
$ tail -1 watch.log
✓ service.orders updated

(exit 0)
```

```console
$ cd /tmp/watch-demo/
$ grep '"id":"service.orders"' .memory/.index/nodes.jsonl
{"attributes":{"language":"typescript","lifecycle":"retired"},"id":"service.orders","title":"Orders","type":"service"}

(exit 0)
```

**PASS.**

The complete watcher log for the whole 4-6 session, one process throughout:

```console
$ cd /tmp/watch-demo/
$ cat watch.log
✓ constraint.eu-data-residency added
✓ constraint.pci-scope added
✓ decision.orders-on-dynamodb added
✓ decision.orders-on-postgres added
✓ decision.research-assistant-on-databricks added
✓ agent.research-assistant added
✓ datasource.market-data added
✓ datasource.orders-db added
✓ datasource.sessions added
✓ environment.production added
✓ environment.staging added
✓ feature_flag.checkout-rewrite added
✓ library.order-events added
✓ repository.acme-platform added
✓ service.checkout added
✓ service.conversation-api added
✓ service.orders added
✓ system.databricks added
✓ system.stripe added
✓ team.platform-engineering added
✓ team.research-platform added
watching /private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/watch-demo/.memory
✓ service.orders updated
✓ service.conversation-api removed
ERROR .memory/resources/services/orders.md Unparseable frontmatter: missed comma between flow collection entries at line 8, column 1:
    links:
    ^
ERROR .memory/resources/services/orders.md Relationship "telepathically_linked_to" is not registered in the ontology.
✓ service.orders updated

(exit 0)
```

---

## 7. Ontology extension

**Criterion.** Adding `feature_flag:` to `entities.yaml` permits creation
of `type: feature_flag` without changing application code.

This is the SPEC §63 flow. It runs against a fresh `memory init`
repository, so the starting ontology is provably the default and contains
no `feature_flag`:

```console
$ cd /tmp/ext-demo/
$ grep -c 'feature_flag' .memory/entities.yaml
0

(exit 1)
```

```console
$ cd /tmp/ext-demo/
$ cat .memory/resources/checkout-rewrite.md
---
id: feature_flag.checkout-rewrite
type: feature_flag
title: Checkout rewrite

attributes:
  key: checkout.rewrite
  rollout: percentage
---

# Checkout rewrite

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory validate
✓ 1 memory resources
✓ 0 relationships

.memory/resources/checkout-rewrite.md
  ERROR unknown-type: Resource type "feature_flag" is not registered in the ontology.

(exit 1)
```

Rejected, as it should be. Now add the type to `entities.yaml` and change
nothing else:

```console
$ cd /tmp/ext-demo/
$ sed -n '/^  feature_flag:/,/^relationships:/p' .memory/entities.yaml
  feature_flag:
    description: >
      A named runtime switch that changes system behaviour without a deploy.

    attributes:
      key:
        type: string

      rollout:
        type: string
        enum:
          - "off"
          - internal
          - percentage
          - "on"

relationships:

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory validate
✓ 1 memory resources
✓ 0 relationships

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory ontology show feature_flag
/private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/ext-demo/.memory/entities.yaml (version 1)

feature_flag
  A named runtime switch that changes system behaviour without a deploy.

  attributes
    key      string
    rollout  string (off, internal, percentage, on)

  relationships from
    uses → *

  relationships to
    uses ← *

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory sync && cat .memory/.index/nodes.jsonl
✓ 1 projected, 0 removed, 0 unchanged
{"attributes":{"key":"checkout.rewrite","rollout":"percentage"},"id":"feature_flag.checkout-rewrite","title":"Checkout rewrite","type":"feature_flag"}

(exit 0)
```

The new type is validated, described and projected. The `enum` on its new
attribute is enforced as well, which shows the definition is actually being
read rather than the unknown type merely being tolerated:

```console
$ cd /tmp/ext-demo/
$ memory validate
✓ 1 memory resources
✓ 0 relationships

.memory/resources/checkout-rewrite.md
  ERROR attribute-enum-violation: Attribute "rollout" on type "feature_flag" has value "sideways"; allowed: off, internal, percentage, on.

(exit 1)
```

The only edit between failure and success was to `entities.yaml`. No CLI
rebuild, no code change, no restart. **PASS.**

---

## 8. Relationship extension

**Criterion.** Adding a relationship to the registry immediately allows
valid resources to use it.

Same repository as §7. Add a service that wants to point at the new flag:

```console
$ cd /tmp/ext-demo/
$ cat .memory/resources/services/checkout.md
---
id: service.checkout
type: service
title: Checkout

links:
  - rel: guarded_by
    target: feature_flag.checkout-rewrite
---

# Checkout

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory validate
✓ 2 memory resources
✓ 1 relationships

.memory/resources/services/checkout.md
  ERROR unknown-relationship: Relationship "guarded_by" is not registered in the ontology.

(exit 1)
```

Add `guarded_by` to the registry:

```console
$ cd /tmp/ext-demo/
$ tail -12 .memory/entities.yaml
      - environment

  guarded_by:
    description: >
      Records that a resource's behaviour is gated by a feature flag.

    from:
      - service
      - agent

    to:
      - feature_flag

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory validate
✓ 2 memory resources
✓ 1 relationships

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory ontology list
/private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/ext-demo/.memory/entities.yaml (version 1)

Resource types (11)
  agent         An AI or autonomous software agent.
  constraint    A meaningful durable limitation affecting architecture, implementation, deployment, security, operations, or development.
  datasource    A source of information consumed by software or agents.
  decision      A durable technical or architectural decision.
  environment   An execution or deployment environment.
  feature_flag  A named runtime switch that changes system behaviour without a deploy.
  library       Reusable code consumed by other software rather than deployed independently.
  repository    A source-code repository.
  service       Independently deployable or operated software capability.
  system        An internal or external technical system.
  team          An organisational team responsible for resources.

Relationships (6)
  depends_on   service, agent → service, datasource, system
  deployed_to  service, agent → environment
  guarded_by   service, agent → feature_flag
  owned_by     service, repository, agent, datasource → team
  supersedes   decision → decision
  uses         * → *

(exit 0)
```

```console
$ cd /tmp/ext-demo/
$ memory sync && cat .memory/.index/edges.jsonl
✓ 1 projected, 0 removed, 1 unchanged
{"rel":"guarded_by","source":"service.checkout","target":"feature_flag.checkout-rewrite"}

(exit 0)
```

Registered, usable and projected on the next pass. The `from` and `to`
constraints are enforced too, so the relationship is genuinely defined
rather than waved through - a flag cannot guard a service:

```console
$ cd /tmp/ext-demo/
$ memory validate
✓ 2 memory resources
✓ 2 relationships

.memory/resources/checkout-rewrite.md
  ERROR relationship-from-violation: Relationship "guarded_by" cannot originate from type "feature_flag"; allowed: service, agent.
  ERROR relationship-to-violation: Relationship "guarded_by" cannot target type "service" ("service.checkout"); allowed: feature_flag.

(exit 1)
```

**PASS.**

---

## 9. Claude integration

**Criterion.** The Claude plugin explains the memory convention at session
start, reads `entities.yaml`, captures durable knowledge by editing
canonical files, can extend the ontology, performs memory review at session
completion, and never writes derived indexes directly.

Claude Code cannot be driven from this environment. This criterion is
therefore split: what is mechanically verifiable here is verified below,
and what is not is listed plainly at the end. Read the two together - this
is a PARTIAL pass, not a pass.

### 9a. Plugin files exist and parse

```console
$ cd team-memory/packages/claude-plugin/
$ find . -type f | sort
./.claude-plugin/plugin.json
./README.md
./hooks/hooks.json
./scripts/session-start.js
./scripts/stop-review.js
./skills/ontology/SKILL.md
./skills/remember/SKILL.md
./skills/team-memory/SKILL.md

(exit 0)
```

```console
$ cd team-memory/packages/claude-plugin/
$ node -e "console.log(JSON.stringify(require('./.claude-plugin/plugin.json'),null,2))"
{
  "name": "team-memory",
  "version": "0.1.0",
  "description": "Local-first repository team memory",
  "author": {
    "name": "Platform Engineering"
  }
}

(exit 0)
```

```console
$ cd team-memory/packages/claude-plugin/
$ node -e "const h=require('./hooks/hooks.json'); console.log('hook events:', Object.keys(h.hooks).join(', ')); console.log(JSON.stringify(h.hooks,null,1))"
hook events: SessionStart, Stop
{
 "SessionStart": [
  {
   "matcher": "startup|resume|clear|compact",
   "hooks": [
    {
     "type": "command",
     "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js\""
    }
   ]
  }
 ],
 "Stop": [
  {
   "hooks": [
    {
     "type": "command",
     "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-review.js\""
    }
   ]
  }
 ]
}

(exit 0)
```

```console
$ cd team-memory/packages/claude-plugin/
$ node --check scripts/session-start.js && node --check scripts/stop-review.js && echo 'both hook scripts parse'
both hook scripts parse

(exit 0)
```

Manifest and hook configuration are valid JSON; both hook scripts are
valid JavaScript; the events declared are `SessionStart` and `Stop`, which
are the two §54 and §55 specify. No tool hooks are registered, which is
what §56 requires.

### 9b. Skills exist with valid frontmatter

```console
$ cd team-memory/packages/claude-plugin/
$ ls -1 skills/*/SKILL.md
skills/ontology/SKILL.md
skills/remember/SKILL.md
skills/team-memory/SKILL.md

(exit 0)
```

```console
$ cd team-memory/packages/claude-plugin/
$ node -e "
const fs=require('fs');
for (const d of fs.readdirSync('skills')) {
  const raw=fs.readFileSync('skills/'+d+'/SKILL.md','utf8');
  const m=/^---\n([\s\S]*?)\n---\n/.exec(raw);
  if(!m){console.log(d+': NO FRONTMATTER');continue;}
  const fm=Object.fromEntries(m[1].split('\n').filter(l=>/^\w+:/.test(l)).map(l=>[l.slice(0,l.indexOf(':')),l.slice(l.indexOf(':')+1).trim()]));
  console.log(d+':');
  console.log('  keys        '+Object.keys(fm).join(', '));
  console.log('  name        '+fm.name+(fm.name===d?'  (matches directory)':'  (MISMATCH)'));
  console.log('  description '+fm.description.length+' chars');
  console.log('  body        '+raw.slice(m[0].length).split('\n').length+' lines');
}"
ontology:
  keys        name, description
  name        ontology  (matches directory)
  description 310 chars
  body        95 lines
remember:
  keys        name, description
  name        remember  (matches directory)
  description 278 chars
  body        42 lines
team-memory:
  keys        name, description
  name        team-memory  (matches directory)
  description 414 chars
  body        172 lines

(exit 0)
```

Three skills, each with a parseable YAML frontmatter block carrying `name`
and `description`, and each `name` matching its directory.

### 9c. Every `memory` command the plugin references exists in the CLI

The built CLI surface:

```console
$ cd team-memory/
$ memory --help
Usage: memory [options] [command]

Local-first team memory: files are authoritative, indexes are disposable.

Options:
  -h, --help          display help for command

Commands:
  init [options]      Create .memory.yaml, the .memory/ tree and a starting
                      ontology
  watch               Watch the canonical files and reconcile continuously
  sync [options]      Reconcile the projections with the canonical files
  rebuild [options]   Drop every projection and reproject from the canonical
                      files
  validate [options]  Check the canonical files against the ontology
  ontology            Inspect the resource types and relationships (spec §41)
  help [command]      display help for command

(exit 0)
```

```console
$ cd team-memory/
$ memory ontology --help
Usage: memory ontology [options] [command]

Inspect the resource types and relationships (spec §41)

Options:
  -h, --help      display help for command

Commands:
  list            List every registered resource type and relationship
  show <type>     Show one resource type, its attributes and its relationships
  help [command]  display help for command

(exit 0)
```

Every `memory <command>` token appearing anywhere in the plugin, extracted
and cross-checked against that surface. `check-commands.sh` is:

```sh
PLUGIN=packages/claude-plugin
TOP=$(memory --help | sed -n '/^Commands:/,$p' | awk 'NR>1 && $1 ~ /^[a-z]/ {print $1}')
SUB=$(memory ontology --help | sed -n '/^Commands:/,$p' | awk 'NR>1 && $1 ~ /^[a-z]/ {print $1}')
FOUND=$(grep -rhoE '\bmemory (init|sync|rebuild|validate|watch|ontology( +(list|show))?)\b' "$PLUGIN" | sort -u)
# then: for each line, assert its verb is in $TOP and its subcommand, if any, is in $SUB
```

```console
$ cd team-memory/
$ bash /private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/check-commands.sh
OK       memory init
OK       memory ontology
OK       memory ontology list
OK       memory ontology show
OK       memory rebuild
OK       memory sync
OK       memory validate
OK       memory watch

result: every memory command referenced by the plugin exists in the CLI

(exit 0)
```

### 9d. The SessionStart hook explains the convention

Run the hook script the way Claude Code would, with `CLAUDE_PROJECT_DIR`
pointed at the example repository, and print the context it injects:

```console
$ cd examples/acme-platform/
$ CLAUDE_PROJECT_DIR=/Users/chrisowen/Dev/platform/team-memory/examples/acme-platform node /Users/chrisowen/Dev/platform/team-memory/packages/claude-plugin/scripts/session-start.js | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s).hookSpecificOutput;console.log('hookEventName: '+o.hookEventName);console.log('---');console.log(o.additionalContext)})"
hookEventName: SessionStart
---
This repository uses local-first team memory.

Canonical memory is stored under `.memory/`.

`.memory/entities.yaml` defines the repository's resource types,
relationship types, attributes, and extraction guidance.

When durable project knowledge is needed, consult `.memory/`.

When durable project knowledge is established or materially changed,
capture it by updating canonical files under `.memory/`.

Never edit `.memory/.index/`; it is generated.

(exit 0)
```

It names `.memory/`, points at `entities.yaml` as the source of the
ontology, and tells the model not to edit `.memory/.index/`. In a directory
with no `.memory/` it stays silent and exits 0 rather than failing the
session:

```console
$ cd /tmp/
$ CLAUDE_PROJECT_DIR=/private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run node /Users/chrisowen/Dev/platform/team-memory/packages/claude-plugin/scripts/session-start.js; echo "exit=$?  (no JSON above)"
exit=0  (no JSON above)

(exit 0)
```

### 9e. The Stop hook performs memory review

> Superseded. `stop-review.js` below no longer exists, and the `Stop` hook no
> longer blocks the turn; the review now runs in the background from the
> `Stop`, `PreCompact` and `SessionEnd` hooks (`review.js`). See the note at
> the top of this record.

The hook only fires for a substantial session, so feed it a fake transcript
long enough to qualify:

```console
$ cd /tmp/
$ echo '{"cwd":"/Users/chrisowen/Dev/platform/team-memory/examples/acme-platform","transcript_path":"/private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/transcript.jsonl"}' | node /Users/chrisowen/Dev/platform/team-memory/packages/claude-plugin/scripts/stop-review.js | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log('decision: '+o.decision);console.log('---');console.log(o.reason)})"
decision: block
---
Review the session for durable project knowledge.

Read `.memory/entities.yaml`.

Determine whether this session established or materially changed:

- resource instances
- attributes
- relationships
- architectural decisions
- durable constraints
- significant conventions

If so, update the canonical `.memory/` files before completing.

Do not capture transient debugging details, unresolved speculation,
or ordinary conversational information.

If an important concept cannot be represented by the current ontology,
extend `.memory/entities.yaml` conservatively first.

If nothing in this session qualifies, say so in one line and stop.

(exit 0)
```

It blocks the stop and asks the model to review the session against
`entities.yaml`, update canonical files, and extend the ontology if the
existing one cannot represent something. It refuses to loop on itself:

```console
$ cd /tmp/
$ echo '{"stop_hook_active":true,"cwd":"/Users/chrisowen/Dev/platform/team-memory/examples/acme-platform","transcript_path":"/private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/transcript.jsonl"}' | node /Users/chrisowen/Dev/platform/team-memory/packages/claude-plugin/scripts/stop-review.js; echo "exit=$?  (no JSON above)"
exit=0  (no JSON above)

(exit 0)
```

And it stays out of the way of a short session:

```console
$ cd /tmp/
$ printf '{"role":"user"}\n' > short.jsonl; echo '{"cwd":"/Users/chrisowen/Dev/platform/team-memory/examples/acme-platform","transcript_path":"/private/tmp/claude-501/-Users-chrisowen-Dev-platform-braindump/76074c26-8818-4a13-b0d0-97380b97e28e/scratchpad/run/short.jsonl"}' | node /Users/chrisowen/Dev/platform/team-memory/packages/claude-plugin/scripts/stop-review.js; echo "exit=$?  (no JSON above)"
exit=0  (no JSON above)

(exit 0)
```

### 9f. Nothing in the plugin writes a derived index

Every mention of `.index` anywhere in the plugin:

```console
$ cd team-memory/packages/claude-plugin/
$ grep -rn '\.index' . --include='*.md' --include='*.js'
./README.md:62:edit Markdown under `.memory/`; `memory watch` reconciles `.memory/.index/`.
./scripts/session-start.js:22:Never edit \`.memory/.index/\`; it is generated.`;
./skills/ontology/SKILL.md:98:revalidates and reprojects affected resources. Never edit `.memory/.index/`.
./skills/team-memory/SKILL.md:25:.memory/.index/              GENERATED. Never read as truth, never edit.
./skills/team-memory/SKILL.md:67:9. Never directly edit `.memory/.index/`.
./skills/team-memory/SKILL.md:153:edit .memory/**.md  ->  watcher  ->  .memory/.index/
./skills/team-memory/SKILL.md:156:Never write, edit or delete anything under `.memory/.index/`, and never treat
./skills/remember/SKILL.md:31:7. Do not manually update derived indexes. Never touch `.memory/.index/`. The

(exit 0)
```

All of them are prohibitions or explanations. There is no write path to
`.memory/.index/` in the plugin - the only thing it invokes is `memory
sync`, and the CLI owns the index.

### What is NOT verified

These parts of the criterion need a live Claude Code session and are
**unverified**:

- that Claude Code discovers and loads the plugin from this layout;
- that the SessionStart hook output actually reaches the model context;
- that the skills trigger in the situations their `description` claims -
  skill selection is model behaviour, not a property of the files;
- that Claude reads `entities.yaml` before extracting, writes canonical
  Markdown rather than indexes, and extends the ontology when the existing
  types genuinely do not fit;
- that the Stop hook review produces useful captures rather than noise.

Verified here: the manifest and hook configuration parse; both hook scripts
parse and behave correctly when invoked directly, including their
no-memory, no-loop and short-session guards; three skills exist with valid
frontmatter; every `memory` command the plugin references exists in the
built CLI; and nothing in the plugin writes to `.memory/.index/`.

(As recorded at plugin 0.1.0; the hooks have changed since - see the note at
the top of this record.)

**PARTIAL.** Everything checkable from here passes. The model-behaviour half
is untested and must not be read as passing.

---

## §80 non-goals

Not a §81 criterion, but §80 forbids Neo4j, Kuzu, Mem0, embeddings, vector
search and FTS search in v0. Declared dependencies:

```console
$ cd team-memory/packages/memory/
$ node -e "const p=require('./package.json'); console.log('dependencies:'); console.log(JSON.stringify(p.dependencies,null,2)); console.log('devDependencies:'); console.log(JSON.stringify(p.devDependencies,null,2))"
dependencies:
{
  "chokidar": "^4.0.3",
  "commander": "^14.0.1",
  "gray-matter": "^4.0.3",
  "yaml": "^2.8.1",
  "zod": "^4.1.12"
}
devDependencies:
{
  "@types/node": "^22.10.2",
  "typescript": "^5.7.2",
  "vitest": "^3.2.4"
}

(exit 0)
```

Five runtime dependencies: a watcher, an argument parser, a frontmatter
splitter, a YAML parser and a schema validator. Nothing that stores or
searches anything.

The full resolved tree, including transitives, searched for the forbidden
names:

```console
$ cd team-memory/
$ node -e "
const {execSync}=require('child_process');
const out=execSync('pnpm -C /Users/chrisowen/Dev/platform/team-memory/packages/memory ls --depth Infinity 2>/dev/null || true',{encoding:'utf8'});
const bad=/neo4j|kuzu|mem0|lancedb|chroma|qdrant|pinecone|weaviate|faiss|hnsw|sqlite|lunr|flexsearch|minisearch|elasticsearch|opensearch|embedding|openai|@xenova|transformers|tantivy|duckdb/i;
const lines=out.split('\n').filter(l=>l.trim());
const hits=lines.filter(l=>bad.test(l));
console.log('lines in resolved tree: '+lines.length);
console.log('forbidden matches: '+hits.length);
hits.forEach(h=>console.log(h));
"
lines in resolved tree: 325
forbidden matches: 0

(exit 0)
```

Source search across both packages:

```console
$ cd team-memory/
$ grep -rniE 'neo4j|kuzu|mem0|vector|embedding|lancedb|chroma|qdrant|pinecone|weaviate|sqlite|lunr|flexsearch|elasticsearch|duckdb' packages/memory/src packages/claude-plugin | sed 's|^packages/||'
memory/src/source/parser.test.ts:51:  vector: true
memory/src/source/parser.test.ts:72:      index: { graph: true, fts: true, vector: true }
memory/src/model/document.ts:21:  vector: boolean
memory/src/model/document.ts:58:  vector: true
memory/src/model/document.ts:78:  vector: z.boolean().default(true)
memory/src/projection/manager.test.ts:19:  index: { graph: true, fts: true, vector: true }
memory/src/projection/manager.test.ts:89:      createProjection({ type: 'kuzu', output: 'x' } as unknown as { type: 'file'; output: string })
memory/src/projection/manager.test.ts:90:    ).toThrow(/Unknown projection type "kuzu"/)
memory/src/projection/file/file-projection.test.ts:29:    index: { graph: true, fts: true, vector: true },
memory/src/projection/file/file-projection.test.ts:170:      makeDocument({ ...agent, index: { graph: false, fts: true, vector: true } })
memory/src/projection/file/file-projection.ts:99:    // `fts` and `vector` flags have no counterpart in this projection in v0 -
memory/src/projection/file/file-projection.ts:100:    // they are hints for the future FTS and vector projections.
memory/src/projection/registry.ts:9: * `type: "@company/memory-kuzu"` - would be a fallback on this lookup miss.

(exit 0)
```

Every hit is one of three things and none of them is an implementation:

- the `index.vector` / `index.fts` hint flags from §21, which are fields in
  the canonical file format that the file projection deliberately ignores;
- a comment or test naming a future projection type to show the registry
  rejects it (`Unknown projection type "kuzu"`);
- documentation saying these are out of scope.

No graph database, vector database, FTS index or Mem0 exists in the
dependency tree or the source.

---

## The example repository against SPEC §61-63

`examples/acme-platform/` is a small but real system - three services, a
library, an agent, two teams, three datasources, two environments, two
external systems, a feature flag, three decisions and two constraints, with
links between them. It exists so the three worked flows in the spec have
something concrete to happen to.

```console
$ cd examples/acme-platform/
$ find .memory -name '*.md' | sort
.memory/constraints/eu-data-residency.md
.memory/constraints/pci-scope.md
.memory/decisions/orders-on-dynamodb.md
.memory/decisions/orders-on-postgres.md
.memory/decisions/research-assistant-on-databricks.md
.memory/resources/agents/research-assistant.md
.memory/resources/datasources/market-data.md
.memory/resources/datasources/orders-db.md
.memory/resources/datasources/sessions.md
.memory/resources/environments/production.md
.memory/resources/environments/staging.md
.memory/resources/feature-flags/checkout-rewrite.md
.memory/resources/libraries/order-events.md
.memory/resources/repositories/acme-platform.md
.memory/resources/services/checkout.md
.memory/resources/services/conversation-api.md
.memory/resources/services/orders.md
.memory/resources/systems/databricks.md
.memory/resources/systems/stripe.md
.memory/resources/teams/platform-engineering.md
.memory/resources/teams/research-platform.md

(exit 0)
```

```console
$ cd examples/acme-platform/
$ memory validate
✓ 21 memory resources
✓ 37 relationships

(exit 0)
```

**§61, human edit.** Criterion 4 above is this flow verbatim: a developer
edits `.memory/resources/services/orders.md`, the watcher debounces,
parses, validates, compares hashes and upserts into the file projection.

**§62, Claude learns a decision.** The conversation establishes that
Databricks will host the Research Assistant. The end state is in the
example: `agent.research-assistant` carries `runtime: databricks` and a
`depends_on` link to `system.databricks`, and
`decision.research-assistant-on-databricks` records the choice with its
context and consequences.

```console
$ cd examples/acme-platform/
$ sed -n '1,30p' .memory/resources/agents/research-assistant.md
---
id: agent.research-assistant
type: agent
title: Research Assistant

tags:
  - research
  - agents

attributes:
  package: "@acme/research-assistant"
  runtime: databricks
  modes:
    - fast
    - slow

links:
  - rel: owned_by
    target: team.research-platform

  - rel: depends_on
    target: system.databricks
    attributes:
      criticality: high
      runtime: true

  - rel: uses
    target: datasource.market-data

  - rel: uses

(exit 0)
```

```console
$ cd examples/acme-platform/
$ head -24 .memory/decisions/research-assistant-on-databricks.md
---
id: decision.research-assistant-on-databricks
type: decision
title: Host the Research Assistant on Databricks

tags:
  - runtime
  - agents

links:
  - rel: applies_to
    target: agent.research-assistant

  - rel: applies_to
    target: system.databricks

provenance:
  authority: repo
  confidence: 1.0
  capturedBy: claude
---

# Host the Research Assistant on Databricks


(exit 0)
```

```console
$ cd examples/acme-platform/
$ grep -E 'research-assistant|databricks' .memory/.index/edges.jsonl
{"attributes":{"criticality":"high","runtime":true},"rel":"depends_on","source":"agent.research-assistant","target":"system.databricks"}
{"rel":"deployed_to","source":"agent.research-assistant","target":"environment.production"}
{"rel":"owned_by","source":"agent.research-assistant","target":"team.research-platform"}
{"rel":"uses","source":"agent.research-assistant","target":"datasource.market-data"}
{"rel":"uses","source":"agent.research-assistant","target":"datasource.sessions"}
{"rel":"uses","source":"agent.research-assistant","target":"library.order-events"}
{"rel":"uses","source":"datasource.market-data","target":"system.databricks"}
{"rel":"applies_to","source":"decision.research-assistant-on-databricks","target":"agent.research-assistant"}
{"rel":"applies_to","source":"decision.research-assistant-on-databricks","target":"system.databricks"}

(exit 0)
```

Note `capturedBy: claude` and `confidence: 0.9` in the agent file against
`capturedBy: human` and `confidence: 1.0` on `service.orders`. Provenance
(§20) is how a reader tells the two apart.

**§63, unknown concept.** Feature flags turned out to matter durably and no
existing type represented one. `feature_flag` and `guarded_by` were added
to the example ontology and the resource file created. Criteria 7 and 8
above are that same extension performed from a clean default ontology; this
is the result carried in the example.

```console
$ cd examples/acme-platform/
$ grep -n -A4 '^  feature_flag:' .memory/entities.yaml
274:  feature_flag:
275-    description: >
276-      A named runtime switch that changes system behaviour without a deploy.
277-
278-    attributes:

(exit 0)
```

```console
$ cd examples/acme-platform/
$ cat .memory/resources/feature-flags/checkout-rewrite.md
---
id: feature_flag.checkout-rewrite
type: feature_flag
title: Checkout rewrite

attributes:
  key: checkout.rewrite
  rollout: percentage
  temporary: true
---

# Checkout rewrite

Routes a percentage of sessions to the rewritten checkout flow. Currently at
10% of traffic in production.

Temporary: the flag is removed once the old flow is deleted. It exists in
memory because "is the rewrite on?" is a question every incident review asks,
and the answer is not in the code.

(exit 0)
```

```console
$ cd examples/acme-platform/
$ memory ontology show feature_flag
/Users/chrisowen/Dev/platform/team-memory/examples/acme-platform/.memory/entities.yaml (version 1)

feature_flag
  A named runtime switch that changes system behaviour without a deploy.

  attributes
    key        string
    rollout    string (off, internal, percentage, on)
    temporary  boolean

  relationships from
    uses → *

  relationships to
    uses ← *
    guarded_by ← service, agent
    applies_to ← decision, constraint

  extraction
    Capture a feature flag when a named switch durably shapes which code path runs in production. Do not capture short-lived local toggles.

(exit 0)
```

---

## Regression check

This work added `examples/**` and this file only; `packages/` was not
modified. The suite is re-run to show the tree is still green.

```console
$ cd team-memory/
$ pnpm -C /Users/chrisowen/Dev/platform/team-memory/packages/memory typecheck

> @team-memory/cli@0.0.0 typecheck /Users/chrisowen/Dev/platform/team-memory/packages/memory
> tsc -p tsconfig.json --noEmit


(exit 0)
```

```console
$ cd team-memory/
$ pnpm -C /Users/chrisowen/Dev/platform/team-memory/packages/memory test 2>&1 | tail -18
 ✓ src/watcher/reconciler.test.ts (11 tests) 290ms
 ✓ src/watcher/debounce.test.ts (4 tests) 308ms
 ✓ src/commands/validate.test.ts (5 tests) 107ms
 ✓ src/commands/init.test.ts (4 tests) 76ms
 ✓ src/source/scanner.test.ts (5 tests) 64ms
 ✓ src/ontology/default-sdlc.test.ts (3 tests) 25ms
 ✓ src/manifest/manifest.test.ts (3 tests) 40ms
 ✓ src/ontology/loader.test.ts (4 tests) 43ms
 ✓ src/config/loader.test.ts (4 tests) 25ms
 ✓ src/source/parser.test.ts (8 tests) 10ms
 ✓ src/projection/manager.test.ts (5 tests) 6ms
 ✓ src/ontology/validator.test.ts (12 tests) 10ms

 Test Files  19 passed (19)
      Tests  114 passed (114)
   Start at  22:23:30
   Duration  45.24s (transform 154ms, setup 0ms, collect 1.06s, tests 41.49s, environment 3ms, prepare 721ms)


(exit 0)
```

---

## Notes and deviations

Everything below was observed during this run. None of it invalidates a
criterion above, but a reader of this record should know it.

### The root `.gitignore` does not cover the example's index

`.gitignore` at the repository root contains:

```text
.memory/.index/
```

Git anchors a pattern containing a separator anywhere other than at the end to
the directory of the `.gitignore` that declares it. `.memory/.index/` therefore
matches `<root>/.memory/.index/` only, and does **not** match
`examples/acme-platform/.memory/.index/`.

`memory init` did not close the gap either: per §33 it appends the entry to a
`.gitignore` that already exists and never creates one, and the example
directory had none.

Handled by adding `examples/acme-platform/.gitignore` containing
`.memory/.index/`, which is anchored to the example directory and does cover
it. That file is part of this change.

The root pattern is still narrower than it reads. Changing it to
`**/.memory/.index/` would cover any future nested memory root, but
`.gitignore` is outside this track's ownership so it was left alone and is
raised here instead.

### `memory watch` startup output does not match the §34 example

§34 illustrates:

```text
Memory watcher started
Source: .memory/**/*.md
Ontology: .memory/entities.yaml
Projections: file
```

What it actually prints is a single line, `watching <absolute memory root>`,
and it prints it *after* the initial full sync rather than before, so the
banner appears below the first batch of `✓ ... added` lines (visible in the
complete log under §6). Cosmetic, and §34 says "example output" rather than
specifying it, so this is recorded rather than failed.

### Delete removes outbound edges, not inbound ones

Criterion 5 passes: the node, document, manifest entry and every edge
*originating* from the deleted resource are removed. Edges *targeting* it from
other files are not, because those files did not change. That is the behaviour
§17 asks for - a link to a resource that does not exist is a warning, and the
graph is expected to be built incrementally - but it is worth stating plainly,
because "removes its corresponding generated projection" could be read as
removing every trace of the id.

In this run the deleted `service.conversation-api` happened to have no inbound
edges, so the check showed zero for both directions.

### Test count

The brief for this track said 89 unit tests. The suite now reports 114 across
19 files; other tracks landed while this record was being produced. All pass.

