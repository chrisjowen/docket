# @docket/adapter-mempalace

docket's MemPalace adapter: entity, observation and document inputs filed
verbatim as drawers in one wing of a MemPalace palace, and questions answered
with MemPalace's own search, as passages with their canonical references
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §8, §9, §11).

Its default export is the `AdapterDefinition`. A private workspace package: it
is not published, and `@chrisjowen/docket` does not bundle it.

## Integrated against

- **mempalace 3.10.0** (PyPI, MIT, Python >= 3.9), tested with the chromadb
  1.5.9 it installs.
- MemPalace is Python-only. The adapter keeps Python out of process and
  drives MemPalace's MCP server over stdio: newline-delimited JSON-RPC 2.0,
  MCP protocol `2025-06-18`. Its CLI has no machine-readable search output,
  so the MCP server is the only machine-readable surface.
- The recorded fixtures under `fixtures/` come from that version.

## Runtime requirements

Install MemPalace yourself; docket never installs it:

```sh
pip install mempalace==3.10.0
```

The default `command` is `mempalace-mcp` on PATH. Alternatively, set
`command: python3` and `args: ["-m", "mempalace.mcp_server"]`.

MemPalace embeds drawers with a model it downloads on first use; docket never
lets it. The default `minilm` model (all-MiniLM-L6-v2, about 80 MB) must
already be in chromadb's cache at
`~/.cache/chroma/onnx_models/all-MiniLM-L6-v2/onnx`. Until it is there,
`status` reports `unavailable`, and the server is never started. Fetch it
explicitly, in MemPalace's Python environment:

```sh
python -c "from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2 as M; M()(['warm up'])"
```

`embeddingModel: embeddinggemma` must already be in the Hugging Face cache.
The server runs with `HF_HUB_OFFLINE=1`, so a missing copy fails rather than
downloads.

## Loading it

Install the package into the project, for example as a workspace or file
dependency. Then reference it through the module references the current
loader accepts:

```ts
import { createDocket } from '@chrisjowen/docket'

const docket = await createDocket({
  projectRoot,
  adapters: [{ id: 'palace', module: '@docket/adapter-mempalace', config: { palace: '/home/me/.mempalace/palace' } }]
})
```

v1 `.docket.yaml` `projections` cannot name it yet; configuring adapters there
is config v2 (spec §15 step 3).

| Option | Default | Meaning |
| --- | --- | --- |
| `command`, `args` | `mempalace-mcp`, `[]` | The MCP server. `--palace <dir>` is always appended. |
| `palace` | `palace` in the instance's state directory | The palace directory, relative to the directory holding `.docket.yaml`. Point it at a shared palace to file docket's drawers beside others. |
| `wing` | `docket-<checkout>-<hash>` | The wing this instance's scope is filed under. It is unique to the checkout, so two projects sharing a palace never share a wing. |
| `configDir` | `mempalace` in the state directory | MemPalace's `MEMPALACE_CONFIG_DIR`, holding its `config.json` and write log. Kept apart from the user's own. |
| `embeddingModel` | `minilm` | `minilm` or `embeddinggemma`. It must match the palace and already be downloaded. |
| `maxDistance` | MemPalace's 1.5 | Native cosine-distance cut-off for search. |
| `startupTimeoutMs`, `timeoutMs` | `60000` | Bounds on starting the server and on each call. An ask is also bounded by its deadline. |

Unknown options are refused, not dropped.

## How canonical inputs map to drawers

- **One drawer per input revision.** It goes in the instance's wing, in a
  room named for the entity's type, or `observations` or `documents` for
  other inputs.
- **Identity.** It is stored in the drawer's `source_file`, as
  `docket:<wing>:<kind>:<id>:<revision>` with each part percent-encoded. It
  contains no `/`, because MemPalace cuts `source_file` to its basename in
  some responses. The mapping is read back from the palace (`list_drawers`),
  so there is no separate map to lose.
- **Header.** MemPalace names a drawer by a hash of its wing, room and
  content, and treats identical content as already filed. Each drawer
  therefore starts with one header line naming the input and revision, so
  two inputs, or two revisions, with the same text never share a drawer. The
  header is stripped from every hit.
- **Replay** of a revision already filed changes nothing.
- **Updates.** A new revision is filed first. Every other drawer of that
  input is deleted after it, including drawers a crash left behind.
- **Deletes** use `delete_drawer`, which removes all of a drawer's chunks.
- **Reset.** MemPalace has no delete-wing tool, so reset lists the wing and
  deletes each drawer docket filed there. Drawers others filed in the wing are
  left alone.
- **Checkpoints.** The last checkpoint acknowledged in full is kept in
  `checkpoint.json` in the state directory. It is tied to the palace, wing and
  embedding model.
- **Opted-out entities.** An entity with `index.vector: false` is not filed.

## Answers

- **Query.** The question goes to `mempalace_search`, filtered to the wing,
  which is MemPalace's native scope. It is ranked by MemPalace's hybrid of
  vector similarity and BM25.
- **Blocks.** Every hit, a physical chunk of up to 800 characters, becomes
  passage evidence and is shown in one `passages` block. Projected entities
  among the hits are listed in an `entities` block.
- **Scores** are MemPalace's `similarity`, comparable only with each other.
- **Coverage** is always `top-k`, with at most 100 results. It is never
  `exhaustive`. With the default `maxDistance`, even an unrelated question
  returns the nearest drawers. That is what a top-k means; set `maxDistance`
  to cut weak matches.
- **Stale hits.** Each hit is checked against the canonical records. A hit
  whose input the files now hold at another revision, or an entity they no
  longer hold, is dropped with a `stale-native-records` warning.
- **Times.** MemPalace's `filed_at` is ingestion time, in local time without
  a zone, and is never reported as an event or observation time. Times come
  only from the canonical record.
- **Notes.** When MemPalace shortens a long question or searches without
  vectors, the answer carries an info diagnostic saying so.

## Kept apart and offline

- **Environment.** The server runs with:
  - `MEMPALACE_CONFIG_DIR` set to the adapter's own directory;
  - `MEMPALACE_EMBEDDING_MODEL` set to the configured model;
  - `MEMPALACE_HUB_FORWARD=0`, so it never forwards to a running
    `mempalace serve` hub;
  - `HF_HUB_OFFLINE=1`;
  - `ANONYMIZED_TELEMETRY=False`.
- **`--palace`** is always passed, which also keeps MemPalace's knowledge
  graph file inside the palace rather than in `~/.mempalace`.
- **Verified.** The whole recorded scenario and the end-to-end path through
  docket's loader ran with network access denied (a macOS `sandbox-exec`
  profile) once the model was cached.

## What it does not do

- **No temporal knowledge graph.** MemPalace's `kg_*` triples span the whole
  palace, not a wing, so they cannot be scoped. They also cannot be deleted,
  only invalidated. Answering from them needs entity resolution the question
  does not give. The adapter neither projects nor queries them.
- **No mining.** The adapter files canonical inputs only. It does not use
  `mempalace_mine` (project or conversation mining), closets, halls, tunnels
  or diaries.
- **No counts, aggregates, tables or graphs.** A top-k recall cannot answer
  "how many".
- **Size limit.** A drawer holds at most 100,000 characters. A longer input
  fails without retry.
- **One writer per palace.** MemPalace lets one server write a palace at a
  time. A second docket process writing the same palace is refused (`-32001`,
  retried later). Reading alongside a writer is fine.
- **Cancellation.** MemPalace cannot stop a call it has started. On abort or
  timeout the adapter abandons the call, sends `notifications/cancelled` and
  ignores the late answer.
- **Startup cost.** The server is started on first use and stopped on
  `close`. Starting it loads chromadb, which takes about a second or more.

## Tests

- `src/mempalace-mcp.test.ts` runs a whole projection lifecycle and the
  shared contract check, `assertAdapterContract`. It covers:
  - replay, revision update and removal of a chunked document;
  - two wings through one server;
  - a scoped reset.

  By default it replays the MCP session recorded in
  `fixtures/mempalace-3.10.0*.json`. With
  `MEMPALACE_TEST_PYTHON=/path/to/python`, a Python with mempalace 3.10.0 and
  its model, it runs the same tests against the real server; adding
  `MEMPALACE_RECORD_FIXTURE=1` re-records the fixtures.
- `src/mempalace.test.ts` covers:
  - configuration, identity encoding, wing and room names, and the model
    check;
  - the stdio client, against `fixtures/fake-mcp-server.mjs`;
  - scope refusals and deadlines.
