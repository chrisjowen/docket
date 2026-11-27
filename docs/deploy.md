# Deploying `docket serve`: Docker Compose and Helm

[`docket serve`](self-hosting.md) ships as an image,
`ghcr.io/chrisjowen/docket`, with a Docker Compose stack
([`deploy/compose`](../deploy/compose)) and a Helm chart
([`deploy/helm/docket`](../deploy/helm/docket)). The single-tenant defaults start with no database:
one container, serving a docket kept as files on a volume. Postgres, SQLite,
Neo4j, Qdrant with mem0, an Ollama embedder and cognee are opt-ins. You need
no Docket Cloud account.

The image is docket's CLI, `@chrisjowen/docket-server` and the AGPL multi-tenant
platform, built from this repository, on a distroless Node 22 base: no shell or package manager, and it
runs as `nonroot` (uid 65532). It carries the drivers the opt-in stores load
(`pg`, `better-sqlite3`, `neo4j-driver`, `mem0ai`). Its entrypoint is
`docket` and its command `serve`, so `docker run … ghcr.io/chrisjowen/docket
serve token create …` runs any docket command. It is published for
linux/amd64 and linux/arm64 at each docket release (`0.16.0`, `0.16`,
`latest`). Build your own from a checkout with:

```bash
docker build -f deploy/image/Dockerfile -t ghcr.io/chrisjowen/docket:dev .
```

## Multi-tenant installs

Use the same [versioned server config](self-hosting.md#the-multi-tenant-server)
for either installer. Both run `docket serve --config` in the same image. By
default the API, browser UI and worker share one process. Set `ui: false` in
the config for a headless API. Run the worker separately when it needs its
own CPU or memory allocation.

The evaluation profile bundles Postgres, Neo4j, Qdrant and an Ollama
embedder on private service addresses, with a volume for each. It supports
one Docket account with multiple dockets. The server enforces the account
limit whenever its selected graph is bundled. The driver for a separate
Neo4j per account is available on Kubernetes.

### Docker Compose

Use an image built from this checkout or a release that includes the
multi-tenant platform. From the repository root:

```bash
docker build -f deploy/image/Dockerfile -t docket:local .
cd deploy/compose
cp .env.multi-tenant.example .env
cp docket-server.example.yaml docket-server.yaml
mkdir -p secrets
(umask 077; openssl rand -base64 32 > secrets/kek)
```

Set `DOCKET_IMAGE=docket:local` in `.env` and fill in its independent
database, Neo4j and Qdrant credentials. Give uid 65532 read access to
`secrets/kek` and traversal access to its directory. Keep the file private
to the operator and the server process. Use URL-safe, randomly generated
database passwords. Register a GitHub OAuth App with callback
`http://127.0.0.1:4390/auth/github/callback`, supply its secret in `.env`,
then replace the example client ID and sign-in allowlist in
`docket-server.yaml`.

```bash
docker compose -f compose.multi-tenant.yaml pull --policy missing
docker compose -f compose.multi-tenant.yaml up -d --wait
```

Open `http://127.0.0.1:4390/` and sign in. Ollama downloads its embedding
model on first start. Postgres initializes a restricted request login
`docket_app` once, and Docket applies migrations under a database lock.
Keep the `docket-platform` project's volumes, generated credentials and KEK
across restarts. Back up the database and the KEK separately.

Change which services are bundled via `COMPOSE_PROFILES` in `.env`. To
use external Postgres, drop the `postgres` profile and set both Postgres
URL references to the external database and its separate request and
migration logins. For an API-only evaluation, remove the graph, search and
embedder sources and their profiles, and set `worker.mode: off`.
Set `DOCKET_SECRETS_DIR` or extend the manifest to mount other config
references.

To split the worker, supply a PEM certificate valid for `worker`, its
private key, and the issuing CA as `worker.crt`, `worker.key` and `ca.crt`
in `worker-tls/`. Set their filesystem permissions for uid 65532. Both
processes read the same server config and KEK. The API verifies the
worker's certificate before sending a query.

```bash
docker compose -f compose.multi-tenant.yaml -f compose.worker.yaml \
  --profile split-worker up -d --wait
```

To return to inline mode, stop the `worker` service with the same two
files and profile, then bring up the base file on its own.

### Helm

From the repository root, copy
[`deploy/compose/docket-server.example.yaml`](../deploy/compose/docket-server.example.yaml)
to an operator-owned file named `docket-server.yaml`. Use the same GitHub
OAuth App setup as Compose. Set `auth.github.clientSecret` to
`{ file: /etc/docket/secrets/github-client-secret }` and supply that file
and your 32-byte base64 KEK through an existing Secret:

```bash
kubectl create namespace docket
kubectl -n docket create secret generic docket-platform \
  --from-file=kek=./kek --from-file=github-client-secret=./github-client-secret
helm upgrade --install docket deploy/helm/docket -n docket \
  -f deploy/helm/multi-tenant-values.yaml \
  --set-file multiTenant.config=./docket-server.yaml \
  --set multiTenant.existingSecret=docket-platform \
  --set image.repository=docket,image.tag=local \
  --wait --timeout 10m
kubectl -n docket port-forward svc/docket 4390:4390
```

The image must be available to the cluster. Load it into kind or set
`image.repository` and `image.tag` to a registry image. The evaluation
values expect release name `docket` and a default StorageClass. For a
different release name, update the service names in the config. If the
bundled Postgres or Qdrant uses an existing Secret, its keys are
`password` and `appPassword` for Postgres, and `apiKey` for Qdrant.
Otherwise Helm generates them on first install and reuses them on upgrade.

Set `multiTenant.worker.enabled=true` to run the worker in its own
Deployment. Set `multiTenant.worker.tlsSecret` to an existing Secret with
`tls.crt`, `tls.key` and `ca.crt`. The certificate must be valid for
`docket-worker` with release name `docket`. Keep the KEK in the mounted
Secret so both Deployments use the same key across nodes. For external
Postgres, set `postgres.bundled.enabled=false` and point the server file
at your database. If it uses `DOCKET_PG_URL` and `DOCKET_PG_MIGRATION_URL`
environment references, set `multiTenant.postgresSecret` to a Secret
with `url` and `migrationUrl` keys.

For a production multi-account install, set `environment: production`,
use TLS-verified external Postgres with separate roles, and put the API
behind an Ingress or gateway with TLS and a matching public URL. Select a
Neo4j source with `provisioning: managed` and `driver: kubernetes`, then
enable `multiTenant.managedGraph` and leave `neo4j.enabled` off. Use a
dedicated release namespace and specify it in the source. The driver
requires a namespace-local cert-manager Issuer and persistent storage.
Point `NODE_EXTRA_CA_CERTS` on the worker at the mounted CA that signs
the graph certificates. Use a CNI that enforces NetworkPolicies.
The chart grants the worker a namespaced Role for the graph resources.
The worker creates one credential, certificate, volume and StatefulSet
per account. Select the account limit in the server file.

## Docker Compose

```bash
cd deploy/compose
cp .env.example .env                     # then edit it; .env is never committed
docker compose pull --policy missing     # the only step that pulls images
docker compose up -d
docker compose run --rm docket serve token create ada --role owner   # shown once
```

```text
http://127.0.0.1:4390/mcp/docket     MCP, with Authorization: Bearer <token>
http://127.0.0.1:4390/               docket open's page, after signing in with a token
http://127.0.0.1:4390/readyz         ready to answer
```

On first start the `init` service runs `docket init` on the volume, with
docket's default `sdlc` ontology, and exits. Later starts leave the docket
as it is. `DOCKET_WORKSPACE` in `.env` names the workspace (`docket` by
default), and so its MCP path.

**Images are never pulled by `up`.** Every service is `pull_policy: never`, so
`docker compose up` uses only the images already on the host, and says so
when one is missing. `docker compose pull --policy missing` is the one step
that fetches them; run it again with a new `DOCKET_IMAGE` tag to upgrade.

**Volumes are never removed by `down`.** `docker compose down` stops and
removes the containers and keeps every volume. Only `docker compose down -v`
removes them, and the data with them: never run it on a deployment you want
to keep.

### Profiles

Each opt-in store is a profile. Set `COMPOSE_PROFILES` in `.env`, or pass
`--profile`.

| Profile | Adds | Then |
| --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg17` | Set `POSTGRES_PASSWORD` and `DOCKET_DATABASE_URL` in `.env` (see `.env.example`). docket then keeps the canonical store in Postgres, migrated on start, and projects it into `DOCKET_PROJECTIONS` (`jsonl` by default; `sqlite`, `postgres`). |
| `graph` | `neo4j:5.26-community` | Set `NEO4J_PASSWORD`, then add the adapter to the docket: `docker compose run --rm docket adapter add neo4j --url bolt://neo4j:7687 --password-env NEO4J_PASSWORD`. |
| `semantic` | `qdrant/qdrant` and `ollama/ollama`, which pulls `nomic-embed-text` on first start | Add a semantic signal to a SQLite or Postgres projection (`docket adapter add sqlite --semantic-model nomic-embed-text`, then set its `semantic.url` to `http://embedder:11434` in `.docket.yaml`), or a mem0 projection in `oss` mode over Qdrant at `http://qdrant:6333`. |
| `cognee` | `cognee/cognee:1.6.8`, and the embedder | Set `COGNEE_DEFAULT_PASSWORD`, and add its language model to `EMBEDDER_MODELS` (or point `COGNEE_LLM_*` elsewhere). Once it runs, make it an API key (below), set `COGNEE_API_KEY` and `docker compose up -d` again, then `docker compose run --rm docket adapter add cognee --url http://cognee:8000`. cognee calls a model for every document it files. |

The stores have no published ports: only the containers on the stack's
network reach them. Qdrant runs without an API key for that reason, since
mem0's configuration would otherwise hold the key in the docket's
`.docket.yaml`.

cognee's API key is made through its own API, from inside the stack's network
(`docket_default`, for the project name `docket`):

```bash
set -a; . ./.env; set +a
curl() { docker run --rm --network docket_default curlimages/curl:8.11.1 "$@"; }
TOKEN=$(curl -s -X POST http://cognee:8000/api/v1/auth/login \
  -d "username=default_user@example.com&password=$COGNEE_DEFAULT_PASSWORD" | jq -r .access_token)
curl -s -X POST http://cognee:8000/api/v1/auth/api-keys -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"docket"}' | jq -r .key   # COGNEE_API_KEY
```

The Compose files' rules: secrets come from `.env` (or files under
`deploy/compose/secrets/`, mounted read-only at `/run/secrets/docket`), and
both are in `.gitignore`. The codec key, which seals document bodies in
Postgres, is always a file (`DOCKET_CODEC_KEY_FILE`), never a variable.

### Serving an existing repository's docket

To serve a docket you already keep in a repository, mount that checkout at
`/data/docket` in place of the volume's copy, with a Compose override file:

```yaml
# compose.override.yaml
services:
  init:
    volumes: [docket-data:/data, /srv/platform:/data/docket]
  docket:
    volumes: [docket-data:/data, /srv/platform:/data/docket, ./secrets:/run/secrets/docket:ro]
```

The checkout must be writable by uid 65532. Writes land in its files, so
`git` sees them and keeps their history.

## Helm

```bash
helm install docket deploy/helm/docket -n docket --create-namespace \
  --set publicUrl=https://docket.example.com \
  --set ingress.enabled=true --set ingress.host=docket.example.com \
  --set ingress.tls.secretName=docket-tls
kubectl exec -n docket deploy/docket -- docket serve token create ada --role owner
```

What it makes:

- **The server.** A Deployment of one pod (`strategy: Recreate`). It writes
  the docket on a ReadWriteOnce volume and keeps its state there, so it
  does not scale out. Init containers run `docket init` on a new volume. It
  runs as nonroot with a read-only root filesystem, no service account token
  and every capability dropped. Probes: startup and readiness on `/readyz`,
  liveness on `/healthz`.
- **A PersistentVolumeClaim** for `/data` (5Gi; `persistence.*`). It is kept
  when the release is uninstalled (`helm.sh/resource-policy: keep`).
  `persistence.existingClaim` uses one of your own.
- **A Service and, opt-in, an Ingress** for any ingress controller
  (`ingress.className`). Terminate TLS there, and set `publicUrl`.
- **NetworkPolicies** (`networkPolicy.enabled`, on by default). Each store
  admits only docket's pod on its own port, and the embedder admits cognee
  too. docket admits whoever `networkPolicy.from` names, and anyone in the
  cluster when it is empty.
- **A ConfigMap** holding `docket-server.yaml`, written from the values.
  `config` merges anything else over it. It holds no secrets.

Secrets come from Secrets, by name, never from the values:

| Value | The Secret holds |
| --- | --- |
| `auth.existingSecret` | `tokens.yaml`: `{ tokens: [{ name, sha256, role, scopes, workspaces }] }`, read-only. Without it, tokens live on the volume and `kubectl exec … docket serve token create` makes them. Changes to the Secret apply without a restart. |
| `postgres.external.existingSecret` | `url`: the Postgres connection URL. |
| `postgres.codec.existingSecret` | `codec.key`: 32 random bytes (or their hex), sealing document bodies at rest. |
| `postgres.bundled.existingSecret`, `neo4j.existingSecret` | `password`. Empty: the chart generates one on install and keeps it. |
| `cognee.existingSecret` | `defaultUserPassword`, and `apiKey` once made on cognee. Empty: a generated password; add `apiKey` to that Secret. |

The opt-in stores are `postgres.enabled`, with your own Postgres
(`postgres.external`) or one in the release for evaluation
(`postgres.bundled.enabled`: a single StatefulSet with no replicas, backups or
failover), and `neo4j.enabled`, `qdrant.enabled`, `embedder.enabled` and
`cognee.enabled`, each a StatefulSet with its own volume. As with Compose,
wire each into the docket as an adapter, at `<release>-neo4j:7687`,
`<release>-qdrant:6333`, `<release>-embedder:11434` and
`<release>-cognee:8000`. `helm install` prints them.

## Where the state lives

| | Compose | Helm |
| --- | --- | --- |
| The docket: Markdown documents, the ontology and its versions, drafts | `docket-data` volume, `/data/docket` | the PVC, `/data/docket` |
| Tokens (hashes only) and the audit log (`audit.jsonl`) | `docket-data`, `/data/state` | the PVC, `/data/state` (tokens from a Secret with `auth.existingSecret`) |
| The search index | over files: `/data/docket/.docket/.index`; over Postgres: `/data/state/index/<workspace>` (jsonl, SQLite) or its own schema (postgres) | the same |
| The canonical store, over Postgres | `postgres-data` volume | your database, or the bundled one's volume |
| Neo4j, Qdrant, the embedder's models, cognee | their own volumes | their own PVCs |

Over files, the docket on the volume is the source of truth. It is plain
Markdown and YAML, portable to any checkout, and the index beside it is
derived: delete it, or call `POST /api/w/<workspace>/rebuild` with an owner's
token, and it is rebuilt from the documents. Over Postgres, the database is
the source of truth, and every projection is rebuilt from it the same way.

## MCP exposure and authentication

- docket answers plain HTTP on port 4390. Compose publishes it on
  `127.0.0.1` only (`DOCKET_BIND` changes that), and the chart's Service is
  `ClusterIP`. Before it is reachable from other machines, put TLS in front
  (a reverse proxy, or the Ingress) and set `publicUrl` / `DOCKET_PUBLIC_URL`
  to the https URL. A bearer token must never cross a network in the clear.
- Every MCP call carries a static bearer token in the `Authorization` header.
  A token in a URL is refused. Each token has a role (viewer, editor, admin,
  owner), and only the roles in `ontology.mcpWriters` publish the ontology
  over MCP (owners by default). See
  [Tokens, roles and scopes](self-hosting.md#tokens-roles-and-scopes).
- There is no sign-in service and no SSO. Anyone holding a token acts as that
  token until it is revoked. Give each person and agent their own, and revoke
  it when they leave: `docket serve token revoke <name>`, or remove it from
  the Secret.
- What a client sends to MCP is written into the docket, and is readable by
  every token that opens the workspace. Workspaces are the only boundary
  between readers.
- The image makes no outbound calls of its own. The opt-in stores do: the
  embedder downloads its models on first start, and cognee calls its
  language model.

## Health, upgrades and backups

- **Health.** `/healthz` says the process is up; `/readyz` says it can read
  its docket, or reach its database. Compose's healthcheck and the chart's
  probes use them.
- **Upgrading.** Change the image tag (`DOCKET_IMAGE`, or `image.tag` /
  `helm upgrade` with the new chart), pull explicitly, and restart. A
  Postgres store migrates its schema on start. A docket in files needs no
  migration; publishing an ontology change migrates its documents, and git
  or a volume snapshot keeps what they were.
- **Rebuilding.** `POST /api/w/<workspace>/rebuild` (owner or admin), or
  `docket serve --rebuild`, resets the projections and projects everything
  again. It never touches the canonical documents or the volumes.
- **Backups, over files.** Back up `/data/docket`: commit it to a repository,
  or snapshot the volume. `/data/state` holds the tokens and audit log. The
  index needs no backup.
- **Backups, over Postgres.** `pg_dump` the database, and keep the codec key
  with the dump, kept apart from it. For a portable copy in docket's own
  format, `docket cloud pull --resources` with a token writes every document
  as Markdown into a checkout.

## Not included

The single-tenant server these installers run is customer-operated and does
not include the following. The multi-tenant server, run with
`docket serve --config` from a `mode: multi-tenant` docket-server.yaml (see
[The multi-tenant server](self-hosting.md#the-multi-tenant-server)), has
most of them; its Compose and Helm profiles are next.

- **SSO** or any sign-in service (OIDC, SAML, GitHub). Access is by static
  tokens.
- **RBAC beyond token roles**: no organisations, members, groups or per-document
  permissions.
- **Multi-tenancy**: one tenant per server; workspaces share its tokens.
- **A hash-chained, tamper-evident audit log**: `audit.jsonl` records every
  call, but nothing proves it was not edited.
- **KMS or per-tenant keys**: at most one local codec key, from a file.
- **Managed operations**: backups, restore drills, monitoring and alerting,
  upgrades and on-call are yours. So is high availability: the server runs
  as one pod.
- **The cross-encoder re-ranker** Docket Cloud's search uses. `docket serve`
  ranks without it.
- Cloud's enrichment and consolidation, repository connections and its web
  app.
