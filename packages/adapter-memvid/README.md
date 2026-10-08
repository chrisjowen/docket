# @docket/adapter-memvid

docket's memvid adapter: entity, observation and document inputs stored as
frames of one memvid `.mv2` file, and questions answered with memvid's own
lexical (BM25) search, as passages with their canonical references
([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §8, §9, §11).

Its default export is the `AdapterDefinition`. A private workspace package: it
is not published, and `@chrisjowen/docket` does not bundle it.

## Integrated against

- **memvid-cli 2.0.160** (npm, Apache-2.0). Its native binary reports itself
  as `memvid-cli 2.0.140`, which is the memvid-core version it is built from.
  The recorded fixtures under `fixtures/` come from that binary on
  darwin-arm64.
- The adapter drives the CLI with `--json` rather than using the
  `@memvid/sdk` Node binding, for three reasons:
  - the SDK has hard dependencies on langchain, llamaindex and other heavy
    packages;
  - it has no `close()` to release the file's writer lock;
  - it sends usage telemetry by default.

  A CLI call is one short-lived process, so the adapter holds no lock between
  calls.

## Runtime requirement

Install the CLI yourself; docket never installs it:

```sh
npm install -g memvid-cli@2.0.160
```

Alternatively, set `command` to its path. memvid-cli ships binaries for
darwin-arm64, darwin-x64, linux-x64 and win32-x64. A missing CLI makes
`status` report `unavailable` with that instruction, and makes writes fail as
retryable.

The memory file is embedded, so the adapter needs no service, no runtime
group, no Docker and no network.

## Loading it

Install the package into the project, for example as a workspace or file
dependency. Then reference it through the module references the current
loader accepts:

```ts
import { createDocket } from '@chrisjowen/docket'

const docket = await createDocket({
  projectRoot,
  adapters: [{ id: 'memvid', module: '@docket/adapter-memvid', config: { namespace: 'payments' } }]
})
```

v1 `.docket.yaml` `projections` cannot name it yet; configuring adapters there
is config v2 (spec §15 step 3).

| Option | Default | Meaning |
| --- | --- | --- |
| `file` | `memory.mv2` in the instance's state directory | The `.mv2` file, relative to the directory holding `.docket.yaml`. |
| `namespace` | the Docket scope | Every frame's URI is under `mv2://docket/<namespace>/`. Give each project its own namespace when several share one file. |
| `command` | `memvid` | The CLI: a command on PATH, or a path. Relative paths resolve against the project. |
| `timeoutMs` | `30000` | Upper bound on one CLI call. An ask is also bounded by its deadline. |
| `lockTimeoutMs` | `5000` | How long a write waits for another process that holds the file's writer lock. |

Unknown options are refused, not dropped.

## How canonical inputs map to frames

- **One frame per input revision.** Each input is one frame with the URI
  `mv2://docket/<namespace>/<kind>/<id>/<revision>`, each segment
  percent-encoded. The URI is the canonical-to-native mapping. memvid keeps it
  on the frame and lists it on its timeline, so the mapping is read back from
  the file. There is no separate map to lose or to fall out of step after a
  crash.
- **Replay** of a revision already stored writes nothing.
- **Updates.** A new revision is written first. Every other frame of that
  input is deleted after it, including frames a crash left behind, so the
  input is never missing and no stale revision stays current.
- **Deletes** remove the input's frames and their chunk frames. memvid splits
  long text into chunk frames (`<uri>#page-N`) and does not delete them with
  their parent, so the adapter deletes the chunks itself, before the parent.
- **Reset** deletes every frame under the namespace and nothing else, even
  in a shared file.
- **Timestamps.** A frame's timestamp is the input's `eventAt`, or else its
  `observedAt`, so memvid's own timeline is meaningful. An entity has neither
  and gets memvid's ingestion time. Answers take times only from the
  canonical record, never from the frame.
- **Checkpoints.** The last checkpoint acknowledged in full is kept in
  `checkpoint.json` in the state directory. It is tied to the file and
  namespace; once either changes, it no longer counts.
- **Opted-out entities.** An entity with `index.fts: false` is not stored.

## Answers

- **Query.** The question is reduced to its distinct words, joined with `OR`,
  and run through memvid's lexical index (`find --mode lex`) within the
  namespace. memvid joins bare words with AND and gives quotes, parentheses,
  `AND`/`OR`/`NOT` and `field:` prefixes their own meaning, so the question
  is not passed through as written. The query memvid ran is recorded in
  `interpretation.nativeQuery`.
- **Blocks.** Every hit becomes passage evidence and is shown in one
  `passages` block. Entities among the hits are listed in an `entities`
  block; these are only entities that were projected and matched.
- **Coverage** is always `top-k`. It is never `exhaustive`, and never a
  count.
- **Stale hits.** Each hit is checked against the canonical records. A hit
  whose input the files now hold at another revision, or an entity they no
  longer hold, is dropped with a `stale-native-records` warning.
- **Passage text** is the stored text minus the title, URI and metadata
  lines memvid appends to a short frame's search text. memvid normalises
  whitespace in what it indexes and returns, for example dropping blank
  lines, so a passage matches the canonical text in its words, not
  byte for byte.

## Kept offline

- **Environment.** Every CLI process runs with `MEMVID_TELEMETRY=0` and
  `MEMVID_OFFLINE=1`. `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `NVIDIA_API_KEY`
  and `MEMVID_API_KEY` are withheld from it.
- **Writes** pass `--no-embedding --no-auto-tag --no-extract-dates
  --no-extract-triplets --no-enrich`. memvid stores the passage and nothing a
  model or rule derived from it.
- **Verified.** `create`, `put`, `find`, `timeline`, `view`, `delete` and
  `stats` were run with network access denied (a macOS `sandbox-exec`
  profile), and so was the end-to-end path through docket's loader.

## What it does not do

- **No semantic or hybrid search.** memvid embeds with local models it
  downloads on first use (into `MEMVID_MODELS_DIR`), or with OpenAI. Neither
  is wired here.
- **No temporal query planning.** Frames carry real event and observation
  times, so `memvid timeline` and `memvid when` work on the file. `ask`,
  however, is a lexical top-k search and does not read time ranges out of
  questions.
- **No counts, aggregates, tables or graphs.** A lexical top-k cannot answer
  "how many".
- **Capacity.** A file holds at most memvid's free-tier capacity, 50 MB of
  stored payload. Beyond it, writes fail and are not retried. More capacity
  is a paid memvid service the adapter does not use.
- **Shared files are best-effort.** memvid applies `--scope` after ranking a
  window of about 4×k matches. In a file shared by several namespaces, a
  search can therefore miss in-namespace matches beyond that window, and the
  answer is marked truncated. When the window holds matches but none in
  scope, memvid exits with a misleading "Lexical index is not enabled". The
  adapter checks that an unscoped search works and treats that case as no
  hits, possibly truncated. One file per namespace (the default) avoids all
  of this.
- **Cancellation.** Aborting kills the CLI's process group. memvid has no
  finer cancellation.
- **File creation.** `memvid create` truncates an existing file. The adapter
  only ever creates a fresh temporary file and hard-links it into place, and
  only on a write: status and questions never create a file.

## Tests

- `src/memvid-cli.test.ts` runs a whole projection lifecycle and the shared
  contract check, `assertAdapterContract`. It covers:
  - replay, revision update and removal of a chunked document;
  - two namespaces in one file;
  - a scoped reset.

  By default it replays the CLI session recorded in
  `fixtures/memvid-cli-2.0.160*.json`. With `MEMVID_TEST_COMMAND=memvid` it
  runs the same tests against the real CLI; adding
  `MEMVID_RECORD_FIXTURE=1` re-records the fixtures.
- `src/memvid.test.ts` covers configuration, URIs, query reduction, metadata
  stripping, the runner's environment and timeouts, scope refusals and
  deadlines.
