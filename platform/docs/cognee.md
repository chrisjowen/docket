# cognee

[cognee](https://www.cognee.ai/) is an optional projection: a store a
workspace turns on for itself, beside the graph (Neo4j) and the search index
(mem0) every workspace has. docket's own cognee adapter
(`@docket/adapter-cognee`, bundled in `@chrisjowen/docket` since 0.8.0 and loaded
from it like the Neo4j and mem0 adapters, `packages/projections/src/cognee.ts`)
files each of the workspace's entities into a cognee dataset of its own -
its links named by their targets' titles - and cognifies them into cognee's
knowledge graph; `docket_search` and `docket_ask` then ask cognee alongside
the other two.

It is off twice over. The chart deploys no cognee service unless
`cognee.enabled` is set, and then nothing runs, nothing is stored and nothing
is spent. Where the service runs, each workspace still has it off until an
owner or admin turns it on (Settings, the **cognee** section; the
`projections.manage` permission).

## What a workspace gets

- **Projection.** The worker's cognee pass (`apps/worker/src/cognee.ts`, every
  `DOCKET_COGNEE_POLL_MS`, a minute by default) projects each workspace whose
  documents moved past what cognee holds, with the same manifest planning as
  the other stores but a manifest, status, backoff and sync history of its
  own. Writes never wait for it, and the graph's "Index behind" never counts
  it: a slow or failing cognify holds up nothing else. An entity that links
  to a retitled entity is re-filed under its own revision with the new title.
  Turning cognee off clears what it filed; deleting the workspace purges its
  dataset with the other stores.
- **Cognify costs AI.** It runs a model over every new or changed entity
  (docket's evaluation: a 1,044-entity workspace took more than five hours on
  a local 7B model), so a pass starts only while the server has the
  platform's own OpenRouter key (`OPENROUTER_API_KEY`; the provisioning key
  alone is not enough), under the org's monthly AI cap, and under the
  workspace's own cognee limit ($2 a month by default, at most the cap). A refused or failed pass is retried with backoff
  (30 s doubling to 30 min) and shown on Settings → Sync with why, never
  dropped.
- **Search abstains.** cognee always answers with its nearest chunks unless
  told otherwise: in docket's search evaluation it never answered with
  nothing (no-answer false-positive rate 1.00). Search asks it with the
  workspace's similarity floor (0.58 by default, the evaluation's
  `cognee+floor`, false-positive rate 0.50 against 1.00) and keeps only chunks
  at least that similar to the question, so a question about someone the
  workspace never recorded gets nothing from cognee. Its scores come back as
  that similarity, on the embedder mem0 uses, so the re-ranker and the cut
  read them like mem0's.
- **Query replay** (Settings → Queries) lists cognee as a store of its own,
  marked optional and floored, with the floored chunk search it ran, its
  floor among its assumptions, and the resources it found; every result
  names `cognee` in `foundBy`.

## How it is billed

cognee calls its model through the worker's **cognify gateway**
(`apps/worker/src/cognify-gateway.ts`), an OpenAI-compatible endpoint on the
worker (`cognee.gatewayPort`, 8445, TLS from the internal CA, admitted only
from the cognee pod). Before a pass the worker takes the platform's single
**cognify lease** (platform migration 0010): one cognify at a time, whichever
org. The pass renews it before each batch. When the pass ends - or its
cognify outlasts the adapter's timeout and runs on in cognee - the lease is
given up only once cognee's `GET /api/v1/datasets/status` says the
workspace's dataset is no longer cognifying; until then no other workspace
cognifies, and if that takes more than 6 hours Settings → Sync shows the
workspace stuck. Clearing a workspace's cognee, when it is turned off or the
workspace is deleted, holds the lease too, so it never deletes what a running
cognify is filing. The gateway counts each call to the workspace holding the
lease: refused while no one holds it, at the org's cap, or at the
workspace's cognee limit; otherwise sent to OpenRouter on the **platform's
own key** (`OPENROUTER_API_KEY`, for every org - never an org's provisioned
key, so no org's content goes out on another's), with the org's small model
whatever model cognee names, the privacy routing every call asks for,
unstreamed; and metered into `platform.ai_usage` as purpose `cognify`, actor
`cognee:<workspace>`, so each workspace's spend counts against its cognee
limit and its org's cap. A server without `OPENROUTER_API_KEY` - including
one with only `OPENROUTER_PROVISIONING_KEY`, where every other AI feature
runs on per-org keys - leaves cognee waiting in every workspace, and Settings → Sync says why. Bringing your own
OpenRouter key for cognee is planned, not built. Search makes no model call:
cognee's `CHUNKS` search only embeds the question.

## A stuck cognify

cognee's model calls carry no dataset, so nothing can show that two
cognifies are kept apart: while a stuck workspace holds the lease, every
other workspace's pass, clear and purge waits, and each one that comes due
says so on its Settings → Sync ("cognee is halted for every workspace").

To recover, first end the run in cognee: mark the dataset's last
`cognify_pipeline` row in cognee's `pipeline_runs` table
`DATASET_PROCESSING_ERRORED`. cognee 1.6.8 has no API to end a pipeline
run. If the run may still be going, restart the cognee pod first to stop
it, then mark the row anyway: a restart stops a live run but leaves its row
`DATASET_PROCESSING_STARTED`, so cognee goes on reporting the dataset as
processing. Once cognee says the run is over, the next cognee pass gives
the lease up on its own. If cognee goes on reporting a dataset as
processing when no pass holds the lease - a run cut short - that
workspace's passes fail ("cognee reports this workspace's dataset still
cognifying from a run no pass holds") without taking the lease, so the
others carry on until the run is ended.

Only when cognee cannot be reached to say, and the workspace is shown stuck
(6 hours after its pass ended), a platform operator force-releases it:

```sh
kubectl exec deploy/docket-cloud-worker -- /nodejs/bin/node worker/release-cognify-lease.js --by <your name>
```

It refuses while cognee reports the run still processing or over, and a
lease not shown stuck. Releasing it gives the lease up, records the
workspace's cognee failed and due again (it retries with backoff, and its
Settings → Sync says an operator released it), and writes
`cognee.lease.release` to the platform's audit log and the org's; it exits
non-zero if the org's side could not be written. Warning: if the run was in
fact still going, its remaining model calls count to the next workspace's
cognee limit.

## Setting it up on the cluster

1. Make its Secret, `docket-cognee`, once, with a `gatewayKey` and a
   `defaultUserPassword` generated for this installation (for example
   `openssl rand -base64 32` each, written straight into the Secret and never
   printed).

2. Set `cognee.enabled: true` in the values file and deploy. This starts
   `docket-cognee` (`cognee/cognee:1.6.8`, the release the adapter was tested
   against) with its volume on the LUKS class, its TLS sidecar, and a network
   policy admitting only the worker. Its embeddings come from the in-cluster
   embedder; on first start it fetches its tokenizer from Hugging Face.

3. Make the API key the worker files with, as cognee's default user, and add
   it to the Secret. Nothing is printed; the key goes straight from cognee to
   the Secret:

   ```sh
   kubectl -n docket-cloud port-forward deploy/docket-cognee 18000:8000 &
   PASSWORD=$(kubectl -n docket-cloud get secret docket-cognee -o jsonpath='{.data.defaultUserPassword}' | base64 -d)
   TOKEN=$(curl -s -X POST localhost:18000/api/v1/auth/login \
     --data-urlencode username=default_user@example.com --data-urlencode "password=$PASSWORD" | jq -r .access_token)
   KEY=$(curl -s -X POST localhost:18000/api/v1/auth/api-keys -H "Authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"name":"docket-cloud-worker"}' | jq -r .key)
   kubectl -n docket-cloud patch secret docket-cognee -p "{\"data\":{\"apiKey\":\"$(printf %s "$KEY" | base64)\"}}"
   unset PASSWORD TOKEN KEY; kill %1
   ```

4. Deploy again. With `apiKey` in the Secret the chart wires the worker
   (`DOCKET_COGNEE_URL`, its key, the gateway) and the API
   (`DOCKET_COGNEE_ENABLED`), and Settings offers cognee. Until then cognee
   runs but nothing calls it, and Settings says it does not run on this
   server. Check the Secret by key name and size only:
   `kubectl -n docket-cloud describe secret docket-cognee`.

Without `OPENROUTER_API_KEY`, the platform's own OpenRouter key, cognee waits
on every workspace that turns it on, and Settings → Sync says so: cognify
runs only on that key, so `OPENROUTER_PROVISIONING_KEY` alone, which turns
the org's other AI on, is not enough.

## Taking it away

Turn it off in each workspace that has it on (the worker clears their
datasets), then set `cognee.enabled: false` and deploy. The chart removes the
service and its volume claim with it: what cognee held is a projection, filed
again from the documents if it is ever turned back on.

## Locally

`DOCKET_COGNEE_URL` (with `DOCKET_COGNEE_API_KEY` and
`DOCKET_COGNIFY_GATEWAY_KEY`) turns cognee on in a worker started by hand,
and `DOCKET_COGNEE_ENABLED=true` in the app; docket's
`packages/adapter-cognee/dev/compose.yaml` runs a cognee 1.6.8 to point them
at. The tests need none of it: they drive the bundled adapter against
docket's fake cognee (`@docket/platform-projections/testing`).

## Known limits

- One cognee service holds every org's datasets, kept apart by cognee's
  access control (on) and one dataset per workspace, and the adapter drops any
  chunk whose metadata names another dataset or scope. A cognee user per org,
  as each org has its own Neo4j pod, is not done yet.
- One cognify at a time across the platform: a large first cognify delays
  other workspaces' cognee passes (never their writes or other stores).
- cognee's own knowledge graph is not shown on the graph page; search reads
  its chunks.
