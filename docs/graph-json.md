# `docket graph --json`: the graph contract

`docket graph --json` prints every exhibit and link in a docket as one JSON
document. It is the graph `docket open` draws, served there at `GET /api/graph`,
under a schema name and version, so other tools can read a docket without
parsing `.docket/` themselves or re-implementing how docket merges files and
computes confidence.

```bash
docket graph --json                    # the docket this directory belongs to
docket graph --json --root <dir>       # the docket <dir> belongs to
```

`--json` is required: the command has no other output format. Without it,
`docket graph` prints its usage on stderr, nothing on stdout, and exits 1.

## Behaviour

- **Read from the canonical files.** Every run scans `.docket/`, validates it
  against the ontology and merges files that share an id, exactly as
  `docket validate` does. It never reads an index for the graph, so the output
  is current whether or not anyone has run `docket sync`.
- **Read-only.** It writes nothing, syncs nothing, starts nothing and connects
  to no adapter's engine. To report index lag it loads the configured adapter
  modules and reads each projection's sync manifest under `.docket/.index/`.
- **Finding the docket.** Like every docket command it looks for `.docket.yaml`
  in the starting directory - `--root`, else the working directory - and then
  in each parent. `project.root` says where it found one. A `--root` that does
  not exist, or is not a directory, is an error rather than a search from
  somewhere above it.
- **No docket.** Where no `.docket.yaml` is found, the command prints nothing
  on stdout, prints `No .docket.yaml found in <dir> or any parent directory...`
  on stderr and exits 1. A reader can tell "this project keeps no docket" from
  an empty docket, which prints a graph with no entities.
- **Diagnostics never fail it.** Invalid files, unresolved links and a missing
  ontology are reported in `diagnostics`, and the command still exits 0. A file
  with an error is left out of `entities`; without an ontology `entities` is
  empty. Exit 1 means no graph was printed.
- **Output.** One JSON document, pretty-printed, on stdout. Nothing else is
  written to stdout.

## Versioning

`schema` is always `"docket.graph"`. `version` is a whole number, `1` today.
It goes up only for a breaking change: a field removed, renamed or retyped, or
its meaning changed. New fields can appear in any release without a new
version, so ignore fields you do not know. Readers should check both fields
and refuse a `version` they were not written for.

## Version 1

The TypeScript definitions are `GraphContract` (exported from
`@chrisjowen/docket`) and the `Ui*` types in
[`packages/docket/src/open/types.ts`](../packages/docket/src/open/types.ts).

```jsonc
{
  "schema": "docket.graph",
  "version": 1,
  "project": { "name": "acme-platform", "root": "/abs/path/to/acme-platform" },
  "entities": [ /* Entity */ ],
  "edges": [ /* Edge */ ],
  "types": [ { "name": "service", "description": "...", "icon": "server" } ],
  "relationships": [ { "name": "depends_on", "description": "..." } ],
  "diagnostics": [ /* Diagnostic */ ],
  "index": { "synced": true, "behind": 0 }
}
```

| Field | Meaning |
|---|---|
| `project.name` | The directory name of the project root. |
| `project.root` | Absolute path of the directory holding `.docket.yaml`. |
| `entities` | One per id, every file declaring that id merged into one, in path order. |
| `edges` | Every link of every entity, as `source -rel-> target`. |
| `types` | The resource types the ontology registers, sorted by name, each with the [Lucide](https://lucide.dev) icon to draw it with: its own, else docket's built-in one for the name, else a generic one. |
| `relationships` | The relationships the ontology registers, sorted by name. |
| `diagnostics` | What `docket validate` would report. |
| `index.synced` | The configured projections were synced at least once. |
| `index.behind` | Entities added, changed or removed since the last sync. Search answers from the index, so this explains a search that misses what the graph shows. |

**Entity**

| Field | Meaning |
|---|---|
| `id`, `type`, `title` | From the frontmatter. |
| `path` | Repo-relative path of the canonical file: the first, when several declare the id. |
| `paths` | Every file declaring the id. |
| `tags`, `attributes` | From the frontmatter, merged. |
| `links` | `{ rel, target, attributes?, evidence?, assessment? }`. |
| `mentions` | Ids referenced as `[[id]]` in the body. |
| `content` | The Markdown body, frontmatter stripped. |
| `provenance` | Who wrote it, when the file says. Optional. |
| `evidence` | Every observation of it, from all its files. |
| `assessment` | Its computed confidence. Absent when no ontology could be loaded. |
| `frontmatter` | The first file's frontmatter exactly as parsed, including fields docket does not model. |

**Edge**

| Field | Meaning |
|---|---|
| `source`, `rel`, `target` | The entity the link is declared on, the relationship and the id it points to. |
| `attributes` | The link's own attributes. Optional. |
| `evidence` | Observations of the link. |
| `assessment` | Its computed confidence. |
| `dangling` | `true` when no file defines `target`. |

**Assessment** is `{ confidence, basis, evidenceCount, sources }`:
`confidence` from 0 to 1; `basis` is `evidence` (computed from observations),
`stated` (the file's own figure) or `unevidenced` (the ontology's default);
`evidenceCount` the distinct observations behind it; `sources` the independent
source kinds that corroborate it. Docket computes it; files never store it.

**Evidence** is an open record, so fields added to the file format appear
without a new version. The fields docket defines are `source` (the kind);
where it was seen - `repository`, `path`, `lines`, `symbol`, `key`, `method`,
`endpoint`, `urls`, `commit`; when and by whom - `observedAt` (a `YYYY-MM-DD`
date or ISO 8601 timestamp) and `observedBy`; and `session` and `note`. Each is
present only when the file records it. Dates are strings, as YAML dates become
in JSON. An edge's `evidence` is an empty array when the link has none.

**Diagnostic** is `{ severity: "error" | "warning", code, message, path?, id? }`.
