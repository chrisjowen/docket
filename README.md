<p align="center">
  <img src="docs/assets/docket-hero.svg" alt="A manila case file labelled .docket/ holding a Markdown exhibit stamped EVIDENCE, beside a cork board of exhibit cards joined by red string" width="100%">
</p>

<h1 align="center">docket</h1>

<h3 align="center">The casebook of evidence for your repository.</h3>

<p align="center">
  Every claim about your system, entered as an exhibit and cited to its source,
  kept in the repo, and a
  <a href="packages/claude-plugin/README.md">Claude Code plugin</a> that reads the
  case file first and enters new evidence as it works.
</p>

<p align="center">
  <a href="#the-case-file">The case file</a> ·
  <a href="#an-exhibit">An exhibit</a> ·
  <a href="#how-to-use-it">How to use it</a> ·
  <a href="#install">Install</a> ·
  <a href="#browse-it-docket-open">Browse it</a>
</p>

---

Which services exist, who owns them, what depends on what, why the datastore
decision went the way it did: that knowledge is usually hearsay, scattered
across people's heads, stale wikis and chat threads. docket keeps it on the
record. Each fact is an **exhibit**, a plain Markdown file with YAML
frontmatter under `.docket/`, and each claim in it cites its **evidence**:
the file and lines, manifest key, endpoint, URL or conversation it was seen in.
docket weighs that evidence into a confidence score; nobody writes one by hand.

The files are the record. Indexes, vector stores and graphs are disposable
projections of them, deleted and rebuilt byte-for-byte whenever you like:

```bash
rm -rf .docket/.index
docket rebuild
```

## The case file

`docket init` opens the case: a config file at the root and a `.docket/` tree
beside your code. Humans and agents edit the same files, and Git keeps the
history.

```text
your-repo/
├── .docket.yaml               config: where the case file lives, which adapters to feed
└── .docket/
    ├── entities.yaml          the ontology: resource types, relationships, evidence sources
    ├── resources/             exhibits, one Markdown file per thing
    │   ├── services/orders.md         id: service.orders
    │   ├── teams/platform-engineering.md
    │   ├── datasources/orders-db.md
    │   └── ...                repositories, libraries, agents, systems, environments
    ├── decisions/             why things are the way they are, losers included
    │   └── orders-on-postgres.md
    ├── constraints/           rules the system must obey
    │   └── pci-scope.md
    ├── notes/                 anything else worth keeping
    ├── .index/                projections: generated, gitignored, disposable
    │   ├── documents.jsonl
    │   ├── nodes.jsonl
    │   ├── edges.jsonl
    │   ├── manifests/         what sync handed each adapter instance: local.json, ...
    │   └── adapters/          state an adapter instance keeps for itself, if any
    └── .cache/                answers docket open's chat cached: gitignored, disposable
```

Directories are only for people: an exhibit's identity is the `id` in its
frontmatter, never its path, so files can move freely. The ontology in
`entities.yaml` is per-repository. It starts as the default SDLC ontology
(services, APIs, pipelines, clusters, incidents, runbooks, policies, teams,
decisions, constraints and more) and you extend it when your case needs a type
it does not have. [`examples/acme-platform`](examples/acme-platform) is a
complete worked case file: 21 resources and 37 links.

## An exhibit

```markdown
---
id: service.conversation-api          # <type>.<semantic-name>; never changes when the file moves
type: service                         # a resource type from entities.yaml
title: Conversation API

attributes:
  language: typescript
  lifecycle: active

links:                                # typed relationships to other exhibits
  - rel: owned_by
    target: team.platform

  - rel: depends_on
    target: datasource.sessions
    attributes:
      criticality: high
      runtime: true
    evidence:                         # where this link was seen
      - source: code
        path: src/store/sessions.ts
        lines: 12-40
        observedAt: 2026-10-05
        observedBy: claude

evidence:                             # where the service itself was seen
  - source: manifest
    path: services/conversation-api/package.json
    key: name
    observedAt: 2026-10-05
    observedBy: claude
---

# Conversation API

Handles conversation persistence and retrieval.
```

Only `id`, `type` and `title` are required. Links may point at exhibits no
file defines yet: the graph is built incrementally, so a dangling reference is
a warning until you ask for `--strict`. See
[Evidence and confidence](#evidence-and-confidence) for how evidence becomes a
score.

## How to use it

**1. Open the case.** From the root of your repository:

```bash
npx @chrisjowen/docket setup
```

This installs the Claude Code plugin, offers to run `docket init` to create
`.docket.yaml`, `.docket/` and the default ontology, and offers to install the
`docket` CLI globally. Restart Claude Code to load the plugin.
[Install](#install) covers teams, CI and doing it by hand.

**2. Enter evidence.** Ask Claude to "remember" a fact, decision or constraint,
or let it notice one: the plugin's `remember` skill writes the exhibit and cites
where it saw it, and an end-of-session review captures what a session settled.
You can write or edit exhibits by hand just as well. Either way, check them
against the ontology:

```bash
docket validate --strict
```

**3. Index the record.** Projections are what make the case file searchable:

```bash
docket sync         # project changed files into .docket/.index (and mem0 or Neo4j, if configured)
docket watch        # or keep projecting continuously as files change
docket rebuild      # throw every projection away and rebuild it from the files
```

**4. Question the witness.** Search every projection at once; each hit points
at its canonical file:

```bash
docket search who owns checkout
docket ontology show service    # a service's attributes, links and what each source is worth
```

The plugin teaches Claude to ask the docket before it greps the code.

**5. Review the case.** `docket open` serves a web UI to browse the graph, read
each exhibit with its evidence and confidence, and ask questions. See
[Browse it](#browse-it-docket-open).

## Install

One command, from the root of the repository you want to remember things:

```bash
npx @chrisjowen/docket setup
```

It installs the Claude Code plugin (through the `claude` CLI, for your user),
offers to run `docket init` if the repository has no `.docket.yaml`, and offers
to install the CLI globally so `docket` works in your shell too. Run it again
whenever you like: it updates what is already installed and leaves an existing
`.docket.yaml` alone. Restart Claude Code afterwards to load the plugin.

Without a terminal (CI, scripts) it asks nothing: it installs the plugin and
skips the rest unless told otherwise. `--yes` takes the recommended answer to
every question (set up the repository, but no global install), `--no-init`
and `--no-global` skip those offers, and `--global` installs the CLI without
asking. Node 22 or later.

### For a team

```bash
npx @chrisjowen/docket setup --team
```

installs the plugin for the repository instead of for you: it records the
marketplace and the plugin in `.claude/settings.json`. Commit that file, and
everyone who clones the repository and trusts it in Claude Code is offered the
plugin.

### Just the plugin

Without the `claude` CLI on your path, or to do it by hand, install the plugin
from inside Claude Code:

```text
/plugin marketplace add chrisjowen/docket
/plugin install docket@docket
```

The plugin needs no separate CLI install. It runs the repository's own
`docket`, or one on your path, and otherwise the CLI release it pins, through
`npx` (so Node 22 or later is still needed). Set up a repository with
`npx @chrisjowen/docket init`.

### As a dev dependency

```bash
pnpm add -D @chrisjowen/docket   # or: npm install --save-dev @chrisjowen/docket
npx docket init
```

The command is `docket`; run it through `npx` (or a `package.json` script) when
it is installed as a dev dependency. The plugin uses this copy first.

## Command reference

```bash
docket setup                # install the Claude Code plugin and set up this repository
docket init                 # scaffold .docket.yaml, .docket/ and the default ontology
docket validate             # check files against the ontology
docket validate --strict    # unresolved links become errors
docket sync                 # project changed files into .docket/.index
docket sync --adapter <id>  # sync only that adapter instance (repeatable)
docket rebuild              # reset and reproject everything
docket rebuild --adapter <id>  # reset and reproject only that instance, in its own namespace
docket watch                # reconcile continuously as files change
docket search <query...>    # ask every projection that can search
docket open                 # browse, search, ask and chat in a web UI, served on all interfaces
docket ontology list        # resource types, relationships and evidence sources
docket ontology show service  # attributes, relationships and confidence by source
docket config migrate --dry-run  # show a version 1 .docket.yaml rewritten as version 2
docket config migrate       # rewrite it, once confirmed (--write: without asking); the original is kept
docket runtime plan <id>    # validate a runtimes entry and show what it would run, secrets redacted
docket runtime up <id>      # start its containers, pulling only as its pullPolicy allows
docket runtime status <id>  # state and health of its containers, changing nothing
docket runtime down <id>    # stop and remove its containers; volumes are kept (--destroy-volumes deletes them)
```

## Browse it: `docket open`

<p align="center">
  <img src="docs/assets/docket-open.png" alt="docket open on the acme-platform example: the Browse graph with the Research Assistant agent selected, and its confidence, sources and three pieces of evidence in the Inspector" width="100%">
</p>

`docket open` serves a web UI for the repository on port 4380 and prints
`http://127.0.0.1:4380/` (or any free port when that one is taken; `--port`
picks one, `--no-open` skips launching the browser). It reads the canonical
files on every request, so it needs no projection beyond the default `jsonl`.
It listens on all interfaces (`0.0.0.0`) and answers any Host, so anyone who
can reach the machine on that port can read the repository's knowledge. The
API never changes the canonical files; its one write is chat's answer cache.

- **Graph** - every entity and relationship as a force-directed graph, each
  type drawn with its own icon and colour, filtered by type and relationship
  (each with All / None switches). Links to entities no file defines yet
  show as dashed ghosts.
- **Inspector** - an entity's frontmatter, notes and links in and out, with the
  confidence docket computes for it and for each link, the sources that
  corroborate it, and every piece of evidence - file and lines, endpoint,
  URLs, when and by whom - merged from all the files that declare its id.
  Each link expands to show the evidence for that relationship.
- **Quick search** (`⌘K` or `/`) - instant type-ahead over ids, titles, types,
  tags, attributes, notes and relationship names. `type:service`,
  `rel:depends_on` and `tag:core` narrow it down; picking a result focuses
  the graph on it.
- **Table** and **History** - beside the graph under Browse: every exhibit or
  observation as a sortable table, filtered by type, source, date observed and
  assessment; and the dated observations over time - when something happened
  (`eventAt`) and when it was observed (`observedAt`), labelled apart - with
  each chain of `supersedes` decisions.
- **Ask** - its own page: a question put to every adapter configured for
  query, each answer shown as it came - exhibits, passages, facts, counts,
  tables, timelines, graphs - with how the adapter read the question, how much
  it covered, and the evidence behind each result, which opens in the
  inspector beside it. One adapter failing leaves the others' answers in
  place, and counts that disagree are shown side by side. Until docket serves
  its adapter coordinator, Ask answers through `docket search` - the same
  search agents use - with the relationship paths that join what it found;
  "Show on the board" puts the results, and only them, on the graph. It
  answers from the projections, so run `docket sync` first; the UI says when
  the index is behind the files.
- **Adapters** - each configured adapter's roles, connection health and how
  far its index lags the files, once docket reports them. It never shows
  configuration, which can hold secrets.
- **Chat** - a conversation with the casebook. Each question runs the same
  search as Ask, then a model summarizes what it found in a few sentences,
  citing each exhibit it relies on; citations link to the exhibit, and the
  graph shows only the exhibits cited (everything found when it cites none).
  The model is Claude, through the `claude` CLI from
  [Claude Code](https://claude.com/claude-code) - nothing to configure, it uses
  your own login. docket runs it in print mode (`claude -p`) with the
  question on stdin, no tools, no MCP servers and no saved session, and gives
  up after two minutes. To pick its model, or to summarize with a local
  Ollama model instead, set `summarize` in `.docket.yaml`:

  ```yaml
  summarize:
    provider: claude
    model: sonnet                      # passed as `claude --model`; unset, Claude Code picks
    # timeoutMs: 120000
  ```

  ```yaml
  summarize:
    model: "qwen2.5:7b"                # Ollama at http://localhost:11434
    # provider: ollama                 # the default when `provider` is left out
    # url: http://localhost:11434
    # timeoutMs: 60000
  ```

  When `claude` is not installed and no Ollama model is set - or when the
  model fails - chat shows what search found, unsummarized, and says why.

  Summaries are cached in `.docket/.cache/chat/`, one JSON file per question,
  keyed by a hash of the question (ignoring case and spacing), the model and
  its provider, its instructions, the content hash of every exhibit the
  summary was built from and the relationship paths connecting them. Asking
  the same question again returns the cached answer at once, marked as such,
  while those are unchanged; editing any file that declares one of the
  exhibits, finding a different set, a change in how they connect, or
  changing the model or provider asks the model afresh and replaces the entry.
  Like `.index`, the cache is disposable: `docket init` adds `.docket/.cache/`
  to `.gitignore`, and deleting it only costs the next answer a model call.

The UI is a SvelteKit app in [`packages/docket-ui`](packages/docket-ui),
built into the npm package, so `npm i -g @chrisjowen/docket` is all it needs.

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
watch push every change into each adapter `.docket.yaml` enables for
projection, and `docket search` asks each one enabled for query.

```
.docket/**/*.md ──► docket sync / watch ──┬──► jsonl  → .docket/.index/*.jsonl
                                          ├──► mem0   → hosted or self-hosted mem0
                                          └──► neo4j  → a Neo4j graph
```

An adapter declares which canonical inputs it takes, and is handed only those
([`docs/adapter-spec.md`](docs/adapter-spec.md) §8):

- **entity** — one per id, however many files declare it, each resource and
  link carrying its evidence, evidence count, corroborating source kinds and
  confidence. Its id and revision (the merged hash) are what they always were.
  The bundled jsonl, mem0 and neo4j adapters take entities only.
- **observation** — one per distinct evidence record, of a resource or of one
  of its links: what was seen, its source locations (`path` and `lines`), the
  canonical files that record it, and `observedAt` only when the record states
  one. Canonical evidence records no event time, so none is given; a file's
  modification time is never used as one. Its id is its entity's id and a hash
  of the record, so a corrected record replaces the old observation.
- **document** — one per canonical file with a Markdown body: the text, the
  entities it declares and `[[mentions]]`, and the span of the file it is,
  `startLine` to `endLine` at the file's hash.

### Configuring adapters

`.docket.yaml` version 2 lists adapter instances
([`docs/adapter-spec.md`](docs/adapter-spec.md) §5):

```yaml
version: 2

adapters:
  - id: local                        # unique; names the instance in answers and errors
    module: "@docket/adapter-jsonl"   # a package, or ./a/file.mjs relative to .docket.yaml
    roles: [projection, query]       # default: both; a role left out never runs
    config:                          # the adapter's own settings
      output: .docket/.index

  - id: enterprise-graph
    module: "@docket/adapter-neo4j"
    roles: [query]                   # asked questions, never synced into
    config:
      uri: "neo4j+s://graph.internal.example"
      database: project-memory
      username: docket
      passwordEnv: DOCKET_GRAPH_PASSWORD
      scope: payments-project

  - id: company-memory
    module: "./tools/docket/company-memory.mjs"
    config:
      endpoint: "https://memory.internal.example"
      tokenEnv: COMPANY_MEMORY_TOKEN

query:
  defaultAdapters: [local, enterprise-graph, company-memory]   # default: every query adapter
  timeoutMs: 30000
  maxConcurrentAdapters: 3
  synthesis: true
```

An instance's `id` is its identity, separate from its module, so one package
can serve several instances — two Neo4j databases, say. docket itself checks
only this envelope, strictly: an unknown field, a repeated id, a role other than
`projection` or `query`, a `runtime` that is not defined or a default adapter
that is not configured for `query` is an error naming the instance. Everything
under `config` belongs to the adapter, which receives it as written and
validates it when the docket opens; the bundled adapters reject a field they do
not know rather than ignore it, and their errors name the instance too.

Secrets never go in the file. An adapter takes the *name* of the environment
variable holding one — `passwordEnv`, `apiKeyEnv`, `tokenEnv` — and reads the
value itself; docket never writes a value into a manifest, error, log or API
response.

`docket search` asks the instances `query.defaultAdapters` names, or every
instance with the `query` role. `timeoutMs`, `maxConcurrentAdapters` and
`synthesis` are for the shared query coordinator
([`docs/adapter-spec.md`](docs/adapter-spec.md) §10); they are checked now but
nothing reads them yet. `docket init` writes a version 2 file.

### Version 1 files

A version 1 `.docket.yaml` keeps working unchanged. Its `projections` are read
as adapter instances: each entry's `type` picks the module and names the
instance (`jsonl`, `mem0`, then `mem0#2` for a second of a type; `type: file`
still means `jsonl`), its `runtime`
moves to the instance, and every other field becomes the instance's `config`
— every mem0 mode, Neo4j setting and scope included. Both roles are enabled,
as before.

`docket config migrate --dry-run` prints the file rewritten as version 2.
`docket config migrate` shows it and asks before writing; `--write` writes
without asking, which is also the only way it writes without a terminal. Either
way it first copies the original to `.docket.yaml.v1.bak` (or `.v1.bak.2`, never
over an existing backup). Only `version` and `projections` change, and comments
stay, though comments inside the old entries keep their version 1 wording. The
rewritten file loads as exactly the same configuration, so the next sync
reprojects nothing.

### The bundled adapters

**`jsonl`** (`@docket/adapter-jsonl`) writes `documents.jsonl`, `nodes.jsonl`
and `edges.jsonl` under `output` (default `.docket/.index`) — a readable view
of exactly what projections receive. Output is deterministic, so rebuilds are
byte-identical and diffable. It is the default, and the only adapter `docket
search` has out of the box: a lexical keyword search over titles, ids, tags and
bodies.

**`mem0`** (`@docket/adapter-mem0`) stores each resource as one verbatim memory
(`infer: false`): the title, type, id, confidence, body, links, evidence and
tags as text; the id, type, paths, hash, tags, confidence and evidence count as
metadata. Rebuilds reproduce it exactly and cost no LLM calls. Documents with
`index.vector: false` are left out. It needs the optional `mem0ai` package
(`pnpm add mem0ai`).

```yaml
adapters:
  # Hosted mem0. The key comes from the environment, never the file.
  - id: memories
    module: "@docket/adapter-mem0"
    config:
      mode: platform
      apiKeyEnv: MEM0_API_KEY   # default
      # host: https://api.mem0.ai

  # mem0's self-hosted REST server.
  - id: team-memories
    module: "@docket/adapter-mem0"
    config:
      mode: server
      url: http://localhost:8888
      apiKeyEnv: MEM0_API_KEY   # optional: the server can run without auth

  # Or mem0ai/oss in-process. Its `config` goes to mem0's `Memory` constructor
  # untouched, so any embedder, vector store or LLM mem0 supports works.
  - id: local-memories
    module: "@docket/adapter-mem0"
    config:
      mode: oss
      config:
        embedder: { provider: ollama, config: { model: nomic-embed-text } }
        vectorStore: { provider: qdrant, config: { host: localhost, port: 6333 } }
        llm: { provider: ollama, config: { model: "qwen2.5:7b" } }
```

Every mode also takes `minScore` (drop hits below that similarity) and `scope`.
All modes file memories under one scope, by default
`agentId: docket-<checkout directory>-<hash>`, where the hash is taken over the
checkout's absolute path (symlinks and letter case resolved). Two clones or
worktrees with the same directory name therefore never share a scope. Moving a
checkout to a new path starts a new scope and leaves the old remote one behind.
The path is the only input, so checkouts on different machines at the same path
(devcontainers, Codespaces, CI runners) get the same default scope: if they
point at one shared mem0 or Neo4j server, each must set `scope:` (`userId`,
`agentId` and/or `runId`) explicitly. Set `scope:` too to choose your own.
`docket rebuild` deletes and repopulates the whole scope, so do not share it
with memories written by anything else. The `neo4j` adapter's
`scope` defaults the same way.

Scopes created by earlier versions (`team-memory-<directory>` in mem0, the bare
directory name in Neo4j) are left behind, not migrated or deleted: the first
`docket sync` projects everything into the new scope. Delete the old scope by
hand if you no longer want it, or set `scope:` to the old value to keep using
it. Set
`MEM0_TELEMETRY=false` to turn off the mem0 SDK's telemetry.

**`neo4j`** (`@docket/adapter-neo4j`) writes one `(:Memory:<Type>)` node per
resource and one relationship per (source, rel, target), with `confidence`,
`evidenceCount`, `sources` and `evidence` on both, so a query can ask for what
rests on code alone — and a full-text index over the documents. It needs the
optional `neo4j-driver` package and a running Neo4j server, local or hosted.
`docket search` asks it with a full-text query, or, with `cypher` set, has a
local Ollama model write a read-only Cypher query against the graph's schema
(falling back to full-text when that fails or finds nothing).

```yaml
adapters:
  - id: graph
    module: "@docket/adapter-neo4j"
    config:
      uri: bolt://localhost:7687        # default; any driver scheme, e.g. neo4j+s://
      username: neo4j                   # default
      passwordEnv: NEO4J_PASSWORD       # unset: connect without auth
      # database: neo4j
      # scope: payments-project
      # cypher:
      #   model: "qwen2.5:7b"           # Ollama at http://localhost:11434
```

`uri` is also accepted as `url`, its name in version 1 entries.

### Sync manifests

Each adapter instance enabled for projection has its own manifest,
`<state.dir>/manifests/<id>.json` (default `.docket/.index`), recording the
revision of every input it acknowledged and the files behind each entity. Sync
plans each instance against its own manifest, so an input is handed again
whenever its revision changes — one of its files, or a confidence rule in the
ontology — and an instance that is behind catches up on its own.

- **Failures stay with their instance.** Instances sync concurrently and
  independently. A manifest is written only after its instance flushed, and
  only with what the instance's `ApplyReceipt` acknowledged: a change it
  failed, or left out of the receipt, keeps its previous entry and is retried
  (once more in the same pass when retryable, then on the next sync). An
  instance that cannot be reached, or throws, is reported and its manifest
  left as it was; every other instance still syncs. `docket sync` then exits
  non-zero, naming what failed.
- **Batches are not transactions.** Changes are handed over in batches of up
  to 100, each carrying the checkpoint the instance is at once every change in
  it is acknowledged — a hash identifying exactly the records it then holds.
  Replaying a change an instance already applied must not duplicate it, which
  is how a pass that failed before its manifest was written recovers.
- **Configuration is fingerprinted.** A manifest is tied to its instance's
  module, configuration (as the adapter read it) and scope. Changing an
  instance's endpoint, scope or any setting makes its next sync reset that
  instance's own namespace — never a shared store globally — and project
  everything into it; other instances are untouched. Adding an instance
  projects everything into it alone. Renaming an instance of a bundled adapter
  (jsonl, mem0, neo4j) keeps its manifest; renaming an instance of any other
  module starts it afresh, because its state directory moves with its id.
- **Upgrading reprojects nothing.** Earlier versions kept one manifest,
  `<state.dir>/manifest.json`, for every projection together. When an
  instance has no manifest of its own and that file was written for exactly
  the projections configured now, the instance takes its entity records over
  and is not reset; input kinds it never received before are projected as
  new. The shared file is deleted once every configured instance has its own.
  If the projections changed in the same upgrade, the shared file vouches for
  none of them, and each instance is reset and reprojected as on a first sync.

### Writing an adapter

New engines plug in as memory adapters, through the contracts in
[`packages/contracts`](packages/contracts) (`@docket/contracts`, not published
on its own; its code ships bundled inside `@chrisjowen/docket`, which also
exports its types). The three adapters above are packages too, each with its
own configuration and driver dependency, sharing
[`@docket/adapter-kit`](packages/adapter-kit). docket's core imports none of
them: an instance's `module` is loaded only when it is configured.

The standard `@chrisjowen/docket` package ships all three, bundled in
`dist/bundled`. The drivers stay optional: install `neo4j-driver` or `mem0ai`
next to docket only for the adapter you configure. A jsonl-only project needs
neither, nor Docker, Python or network access. A project's own install of an
adapter package (from a private registry or a workspace) is used in preference
to the bundled copy. For a minimal core, build docket with only the adapters
you want bundled — `DOCKET_BUNDLED_ADAPTERS=jsonl pnpm build`, or empty for
none. The `@docket/adapter-*` packages are not published to npm, so a project
using a minimal core cannot `npm install` the adapters it left out: a
configured adapter that is neither installed nor bundled fails with an error
saying it is not included in this build, and that a build with
`DOCKET_BUNDLED_ADAPTERS` unset or listing it includes it.

A project-local adapter is a compiled `.js` or `.mjs` module whose default
export is an `AdapterDefinition`
([`docs/adapter-spec.md`](docs/adapter-spec.md) §7, §12), named by its path in
`module`. A program can also open a docket with more adapters than the file
lists:

```ts
import { createDocket } from '@chrisjowen/docket'

const docket = await createDocket({
  projectRoot,
  // A compiled module relative to .docket.yaml, or a package installed in the project.
  adapters: [{ id: 'company-memory', module: './tools/docket/company-memory.mjs', config }],
  // Or a definition passed in directly.
  registrations: [{ id: 'other-memory', definition, config }]
})
```

docket never installs an adapter package, and runs a `.ts` adapter only with a
TypeScript runner passed as `typescript`.

Two recall engines are adapter packages loaded this way, not bundled with the
CLI: [`@docket/adapter-memvid`](packages/adapter-memvid) (a memvid `.mv2`
file, searched lexically through the memvid CLI) and
[`@docket/adapter-mempalace`](packages/adapter-mempalace) (drawers in a
MemPalace wing, recalled through its MCP server). Each answers with source
passages and the canonical records they came from; their READMEs list the
engine versions they were tested against, what each needs installed, and what
each does not do.

## Local runtimes

An adapter connects to a service; docket does not start one unless asked.
Hosted and already-running services need nothing more, and no command but
`docket runtime` ever calls Docker - not sync, watch, search, `open` or
loading an adapter, even with a `runtimes` section configured.

To have docket manage local containers explicitly, write your own Compose file
with the images you approve, and name it in a `runtimes` group. An adapter
instance's `runtime:` says which group it connects to (in a version 1 file, a
projection's `runtime:` does):

```yaml
adapters:
  - id: dev-graph
    module: "@docket/adapter-neo4j"
    runtime: graph-dev
    config:
      uri: bolt://127.0.0.1:17687
      passwordEnv: DOCKET_GRAPH_PASSWORD

runtimes:
  graph-dev:
    provider: docker-compose
    composeFile: ./infra/docket-memory.compose.yaml   # relative to .docket.yaml
    projectName: docket-payments
    pullPolicy: never        # never (default) | missing | always
    services: [graph]        # default: every service in the file
```

```yaml
# infra/docket-memory.compose.yaml - yours; docket never writes or rewrites it
services:
  graph:
    image: ${DOCKET_NEO4J_IMAGE:?Set the approved image reference}
    ports:
      - "127.0.0.1:17687:7687"
    environment:
      NEO4J_AUTH: ${DOCKET_NEO4J_AUTH:?Set the local authentication value}
    volumes:
      - graph-data:/data
volumes:
  graph-data: {}
```

docket has no images of its own: the image is exactly what the Compose file
resolves, an internal registry tag or digest included, and registry logins are
Docker's own. Commands, entrypoints, health checks, networks and extra services
all go in the Compose file.

- `docket runtime plan <id>` checks the group and the Compose file (through
  `docker compose config`, which starts nothing) and prints each service's
  image, ports, volumes and environment variable names - never their values -
  with the exact commands `up`, `status` and `down` run.
- `docket runtime up <id>` runs `docker compose up --detach --pull <pullPolicy>
  --no-build`: Compose enforces the pull policy, and a Compose too old to
  support it fails rather than pulling. docket never builds images.
- `docket runtime status <id>` lists the project's containers by Compose
  label (`docker ps`), so it changes nothing and needs none of the Compose
  file's variables set.
- `docket runtime down <id>` runs `docker compose --project-name <projectName>
  down` without the Compose file, so it too needs none of the file's variables
  set, and keeps named volumes. Only `--destroy-volumes` adds `--volumes`;
  `docket rebuild` never touches containers or volumes.

## Claude Code plugin

`packages/claude-plugin/` contains skills and hooks that let Claude capture
durable project knowledge by editing the same canonical files a human would.
Agents never write to an index. See its
[README](packages/claude-plugin/README.md).

## Development

```bash
pnpm install
pnpm typecheck   # sources and tests
pnpm build       # the adapter contracts, kit and adapters and the web UI
                 # first, then docket, which ships copies of them; the
                 # end-to-end tests run the built CLI, so build first
pnpm test        # the contracts', adapters', CLI's and plugin's suites
```

To work on the web UI with hot reload, run `docket open --no-open` in a
repository with a `.docket/`, then `pnpm -C packages/docket-ui dev`; the dev
server proxies `/api` to it (set `DOCKET_API` if it is not on port 4380).

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

1. Bump `version` in `packages/docket/package.json`, and `CLI_VERSION` in
   `packages/claude-plugin/scripts/cli.js` to match (the plugin's tests fail
   until they agree), and merge it.
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

---

<sub>The case-file illustration at the top, `docs/assets/docket-hero.svg`, is
original artwork drawn for this repository; it uses no third-party images. The
`docket open` screenshot shows the [`examples/acme-platform`](examples/acme-platform)
case file.</sub>
