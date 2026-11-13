# @docket/adapter-cognee

docket's [cognee](https://www.cognee.ai/) adapter: canonical inputs added to
one cognee dataset and cognified into its knowledge graph, and questions
answered with cognee's own chunk search - as passages with their canonical
references - and, when asked, with cognee's cited completion as a derived
fact ([`docs/adapter-spec.md`](../../docs/adapter-spec.md) §8, §9, §11).

Its default export is the `AdapterDefinition`. A private workspace package: it
is not published on its own, but `@chrisjowen/docket` bundles it, and exports
it as `@chrisjowen/docket/adapters/cognee`.

## Integrated against

- **cognee 1.6.8**, the `cognee/cognee:1.6.8` image, run against its REST API
  (`/api/v1`). Every request shape and response the adapter relies on - add
  with external metadata, the data listing and its `content_hash` filter,
  per-item delete, cognify, `CHUNKS` and completion search, API keys - was
  checked against that server; `fixtures/fake-cognee.ts` answers the same way.
- cognee is Python. The adapter talks to a cognee server over HTTP only, so
  no Python and no cognee package run in the docket process, and docket never
  starts, installs or configures the server.

## Running a cognee server locally

[`dev/compose.yaml`](dev/compose.yaml) runs cognee 1.6.8 on
`127.0.0.1:8000`, with its LLM and embeddings from
[Ollama](https://ollama.com) on the host - `qwen2.5:7b` and
`nomic-embed-text`, the models docket's search evaluation already uses:

```sh
ollama pull qwen2.5:7b && ollama pull nomic-embed-text
export COGNEE_DEFAULT_PASSWORD=<choose one>
docker compose -f packages/adapter-cognee/dev/compose.yaml up -d
curl -s localhost:8000/health    # {"status":"ready","health":"healthy","version":"1.6.8-local"}
```

cognee's access control is on, its default: each dataset is kept apart, and
every request needs an API key. Log in as its default user once and create one:

```sh
TOKEN=$(curl -s -X POST localhost:8000/api/v1/auth/login \
  -d "username=default_user@example.com&password=$COGNEE_DEFAULT_PASSWORD" | jq -r .access_token)
export COGNEE_API_KEY=$(curl -s -X POST localhost:8000/api/v1/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"docket"}' | jq -r .key)
```

cognee validates `llama3.1:8b` for graph extraction and lists `qwen2.5:7b`
among models that sometimes return malformed graphs; set
`COGNEE_LLM_MODEL=llama3.1:8b` for better graphs. Chunk search, which the
adapter answers with, does not depend on the graph. Any other cognee 1.6.8
deployment works the same way: point `url` at it.

## Loading it

```yaml
adapters:
  - id: cognee
    module: "@docket/adapter-cognee"
    roles: [projection, query]
    config:
      url: http://localhost:8000
```

`docket adapter add cognee --url http://localhost:8000` writes that entry.
Install the package into the project first, as a workspace or `file:`
dependency on a docket checkout.

| Option | Default | Meaning |
| --- | --- | --- |
| `url` | required | The cognee server. |
| `apiKeyEnv` | `COGNEE_API_KEY` | The environment variable holding a cognee API key, sent as `X-Api-Key`. Unset is fine for a server with access control off. |
| `dataset` | `docket-<checkout>-<hash>` | The dataset this instance's scope is filed in. It is unique to the checkout, so two projects on one server never share one. No dots or spaces (cognee's rule). |
| `inputs` | `[entity]` | The input kinds projected: `entity`, `observation`, `document`. cognify runs a model over every one, so entities only by default. |
| `maxDistance` | none | Leave out chunks whose cosine distance to the question is above this. cognee always returns its top k otherwise. |
| `completion` | none | `GRAPH_COMPLETION`, `RAG_COMPLETION` or `HYBRID_COMPLETION`: also ask cognee for an answer, shown as a derived fact citing the entities of the chunks it used. One model call per question. |
| `timeoutMs` | `60000` | Bounds each request. An ask is also bounded by its deadline. |
| `cognifyTimeoutMs` | `3600000` | Bounds cognify. |

Unknown options are refused, not dropped.

## How canonical inputs map to data items

- **One data item per input revision.** It is added as a Markdown file to the
  instance's dataset, named `docket-<kind>-<id>.md`.
- **What cognify reads.** An entity is its title, type, body, its links -
  each named by the linked entity's title, `owned by: Payments team` - and
  its tags. The links are how docket's relationships reach cognee's graph:
  cognify extracts them like any other statement, and a question about a
  neighbour can find the entity that links to it. Ids, confidence and
  evidence stay out of the text. Observations and documents are their text,
  verbatim.
- **Identity.** It is the item's external metadata - `docket_dataset`,
  `docket_scope`, `docket_kind`, `docket_id`, `docket_revision` - which
  cognee returns with the item when listing a dataset and with every chunk a
  search finds. The mapping is read back from cognee, so there is no separate
  map to lose.
- **Same text.** cognee keeps one item per content hash (MD5) in a dataset
  and keeps the first one's metadata. Before adding, the adapter looks the
  hash up: the same input and revision is already there; an earlier revision
  of the same input with the same text is deleted first; any other holder of
  that text - another input, or someone else's item - gets the input a
  one-line `(docket <kind> <id>)` disambiguation, stripped from every hit.
- **Cognify.** Adding does not make an item searchable. After a batch's
  changes, the adapter cognifies the dataset once, waiting for it to finish.
  cognee skips items it has already cognified, so this only costs model calls
  for what is new. If cognify fails, every upsert in the batch is reported
  failed and retryable; the next sync finds them added and cognifies again.
- **Linked titles.** Each item's metadata also holds `docket_text`, the
  hash of the text it was filed with. When a batch changes or removes an
  entity, every filed entity that links to it is rendered again, and one
  whose text no longer matches - its link now names the new title, or the
  id of a removed entity - is re-filed under the same revision, then
  cognified with the batch. If that re-filing or cognify fails, the changed
  entity is reported failed and retryable too, so its retry cognifies again.
  A replay is checked the same way.
- **Replay** of a revision already added, whose text has not changed, changes
  nothing.
- **Updates.** A new revision is added first; every other item of that input
  is deleted after it.
- **Deletes** remove the item and everything cognify derived from it: its
  chunks, and its graph nodes and edges.
- **Reset** deletes each item docket filed in the dataset. It never deletes
  the dataset, which may hold others' items.
- **Checkpoints.** The last checkpoint acknowledged in full is kept in
  `checkpoint.json` in the state directory, tied to the URL, dataset and
  input kinds.
- **Opted-out entities.** An entity with `index.vector: false` is not added.

## Answers

- **Query.** The question goes to cognee's `CHUNKS` search over the dataset:
  the chunks closest to it by embedding, no model call.
- **Blocks.** Every chunk becomes passage evidence in one `passages` block,
  and the projected entities among them are listed in an `entities` block.
- **Scores** are cognee's cosine distances: lower is closer. They are
  comparable only with each other.
- **Coverage** is always `top-k`, at most 100 results, never `exhaustive`.
  Without `maxDistance`, an unrelated question returns the nearest chunks.
- **Stale hits.** Each hit is checked against the canonical records. A hit
  whose input the files now hold at another revision, or an entity they no
  longer hold, is dropped with a `stale-native-records` warning.
- **Other datasets.** With cognee's access control off
  (`ENABLE_BACKEND_ACCESS_CONTROL=false`), cognee 1.6.8 returns chunks of
  every dataset whichever one was asked for. The adapter drops every chunk
  whose metadata names another dataset or scope, with a
  `cognee-foreign-chunks` warning - but they still take places in cognee's
  top k. Keep access control on.
- **Cited completion.** With `completion` set, cognee's answer to the question
  is added as a `derived-fact` in a `facts` block, citing the canonical
  inputs of the chunks it says it used, at their current revision. It is
  written by the model the cognee server is configured with, so it is never
  canonical verification. If it fails, the passages still come back, with a
  `cognee-completion-failed` warning.

## What it does not do

- **No graph or counts.** cognee's graph is extracted by a model; the
  adapter does not return it as a `graph` block, and a top-k search cannot
  answer "how many".
- **No ontology.** cognee can ground extraction in an uploaded OWL ontology.
  docket's ontology is not converted to one; cognify extracts with cognee's
  default graph model.
- **Cancellation.** Aborting a request stops the adapter waiting for it, not
  cognee's work: a cognify the adapter stopped waiting for runs on, and the
  next cognify finds its items done.
- **Model cost.** The first sync of a large docket cognifies every entity,
  one model pass per chunk. With a local 7B model that is seconds per entity.

## Tests

- `src/cognee.test.ts` runs the shared contract check and the whole
  projection lifecycle against a mocked cognee API (`fixtures/fake-cognee.ts`,
  a `fetch` that answers as cognee 1.6.8 does): replay, revisions with and
  without new text, inputs sharing a text, opted-out entities, a failed
  cognify and its retry, a scoped reset, foreign chunks, `maxDistance`, stale
  hits, the cited completion, status and the API key. This runs in
  `pnpm test`.
- The same file has a test against a real server, skipped unless
  `COGNEE_TEST_URL` names one (`COGNEE_TEST_API_KEY` its key). It projects,
  answers with a `GRAPH_COMPLETION` fact, revises, removes and resets, in a
  dataset of its own, in about a minute with the recipe above:

  ```sh
  COGNEE_TEST_URL=http://localhost:8000 COGNEE_TEST_API_KEY=$COGNEE_API_KEY pnpm -C packages/adapter-cognee test
  ```

- The search evaluation projects its corpora into cognee through this adapter
  when `DOCKET_EVAL_COGNEE_URL` is set: see
  [`packages/docket/eval/search`](../docket/eval/search/README.md#cognee).
