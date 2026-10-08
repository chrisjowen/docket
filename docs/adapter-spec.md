# Docket pluggable memory adapters and evidence workspace

Status: proposed implementation specification, 8 October 2026.

## 1. Outcome

Docket collects and preserves project evidence in canonical files. Independently installed or project-local adapters project that evidence into memory engines and answer natural-language questions using their native capabilities. The UI displays rich results and their supporting evidence through shared components.

Users can use embedded engines, organisation-hosted endpoints, commercial hosted services, or explicitly managed local containers. All container images, endpoints and engine configuration are configurable. Installing or querying an adapter must never implicitly pull images or start containers.

This document specifies a change, not existing behaviour. Names beginning `@docket/` below are proposed package names, not claims that they have been published.

## 2. Current implementation and migration targets

Inspected repository: https://github.com/chrisjowen/docket, main tree at 0c1af7ca8877efc0a67416d8d4927758d3908a67.

Relevant current behaviour:

- `src/projection/projection.ts`: one interface combines entity projection and optional search; answers contain entity hits and a note.
- `src/config/config.ts`: core knows JSONL, Neo4j and mem0 configuration schemas. mem0 already supports platform, server and OSS modes; Neo4j already accepts a connection URL. Hosted connectivity is therefore an extension of existing support, not an entirely new capability.
- `src/commands/search.ts`: searches configured projections concurrently; retains native scores separately and drops hits without canonical documents.
- `src/open/ask.ts` and `paths.ts`: add undirected BFS paths between search hits from canonical relationships, at most three hops and eight endpoints.
- `src/open/chat.ts`: summarises matched entities; intermediate path entities are not automatically loaded as exhibits. Notes are capped per entity.
- `src/open/graph.ts`: browsing graph reads canonical files, not JSONL or Neo4j.
- UI top search operates over the browser's loaded canonical graph. Ask and Chat use server APIs and configured searchable projections.

The reported hardcoded container-image concern is a requirement to address. Its exact implementation location was not verified in this review; audit all container launch paths before migration.

## 3. Architectural boundaries

| Component | Owns |
| --- | --- |
| Collectors | Capture original observations and provenance |
| Canonical model | Stable IDs, entity resolution, evidence records, revisions and declared relationships |
| Adapter package | Native ingestion, chunking, extraction, indexing, queries and result translation |
| Coordinator | Scope enforcement, fan-out, budgets, partial failures, evidence resolution and optional answer synthesis |
| Runtime manager | Explicit lifecycle of configured local processes/containers |
| UI, CLI, skills, MCP | Consumers of the shared coordinator |

There is no required canonical query plan. Each query adapter receives the original natural-language question and shared execution context. Native query strategies remain adapter-owned.

Projection, query and provisioning are independent capabilities. An adapter may implement only one or two. A memory engine may use several underlying databases without exposing those as additional Docket adapters.

## 4. Packages and loading

Proposed packages:

- `@docket/contracts`: types, runtime validators and contract test helpers; no engine drivers or UI dependencies.
- `@docket/core`: canonical model, sync, adapter loader, coordinator, CLI/API and runtime manager.
- `@docket/adapter-jsonl`: lightweight local fallback.
- `@docket/adapter-neo4j`, `@docket/adapter-mem0`, `@docket/adapter-mempalace`, `@docket/adapter-memvid`: optional packages with their own dependencies.

Core must not import all optional adapters or encode their configuration unions. Each module exports an `AdapterDefinition` as its default export. Core validates the generic envelope; the adapter validates its own configuration without silently dropping unfamiliar fields.

Supported module references:

1. Installed npm package, resolved from the project root, including packages from a private registry or workspace packages.
2. Project-relative compiled `.js`/`.mjs` module.
3. Project-relative `.ts` module with an explicitly configured TypeScript runner. Baseline support must not rely on transparent TS execution or downloads.
4. Programmatic registration: a caller can pass an adapter definition directly to `createDocket`.

Relative paths resolve against the directory containing `.docket.yaml`, regardless of working directory. Resolve package dependencies normally; never install a missing package automatically. Missing modules produce an actionable error. In-process custom modules are trusted project code and execute with the Docket process's privileges.

Definition `apiVersion: 1` is checked before creation; unsupported majors fail clearly. Validate adapter answers at runtime as well as through TypeScript. Unknown optional extension fields may survive validation, but cannot replace required fields.

## 5. Configuration

Introduce configuration `version: 2`:

```yaml
version: 2
source:
  root: .docket
  exclude: [".index/**", ".cache/**", "adapters/**"]

adapters:
  - id: local
    module: "@docket/adapter-jsonl"
    roles: [projection, query]
    config:
      output: .docket/.index/local

  - id: enterprise-graph
    module: "@docket/adapter-neo4j"
    roles: [projection, query]
    config:
      uri: "neo4j+s://graph.internal.example"
      database: project-memory
      username: docket
      passwordEnv: DOCKET_GRAPH_PASSWORD
      scope: payments-project

  - id: company-memory
    module: "./tools/docket/company-memory.mjs"
    roles: [projection, query]
    config:
      endpoint: "https://memory.internal.example"
      tokenEnv: COMPANY_MEMORY_TOKEN

query:
  defaultAdapters: [local, enterprise-graph, company-memory]
  timeoutMs: 30000
  maxConcurrentAdapters: 3
  synthesis: true
```

Adapter IDs are unique instance identities, distinct from module/package names. Multiple instances of one package are allowed. Disabled roles do not run. Query selection can be overridden per request; default behaviour fans out to configured query adapters, rather than asking a model to decide which engines exist.

Adapter-owned options cover endpoint paths, API dialect/version, model providers, namespaces and TLS configuration. Hosted and self-hosted APIs need not share a protocol. Connection and execution scope are explicit and separate from local resource management.

Secrets use named environment variables or a programmatic secret resolver. Do not write resolved values into generated manifests, API responses, logs or query explanations. Custom CA files and supported proxy settings must be configurable where the native SDK allows them; never require disabling certificate verification.

## 6. Container and runtime configuration

A connection to an external service is the default. Local resource management is opt-in and belongs in a separate `runtimes` section. Each adapter instance may reference one runtime group:

```yaml
adapters:
  - id: dev-graph
    module: "@docket/adapter-neo4j"
    runtime: graph-dev
    config:
      uri: "bolt://127.0.0.1:17687"
      username: neo4j
      passwordEnv: DOCKET_GRAPH_PASSWORD

runtimes:
  graph-dev:
    provider: docker-compose
    composeFile: ./infra/docket-memory.compose.yaml
    projectName: docket-payments
    pullPolicy: never
    services: [graph]
```

User-owned Compose file:

```yaml
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

`DOCKET_NEO4J_IMAGE` can point to an internal registry image with a tag or digest. Docket must not replace it with a public image. The user can supply custom command, entrypoint, environment, volumes, health checks, networks and multiple services through the Compose file. The example assumes the supplied image is compatible with Neo4j configuration; adapters cannot promise arbitrary images obey the same environment conventions.

Requirements:

- `docket runtime plan <id>` validates and describes the intended operations with secrets redacted.
- `docket runtime up <id>` explicitly starts selected resources. Honour `never`, `missing`, or `always` pull policy, using the runtime's corresponding behaviour; fail if an engine cannot enforce it.
- `docket runtime status <id>` reports service health without mutating resources.
- `docket runtime down <id>` stops managed resources and preserves volumes.
- Destruction of persistent volumes requires a separately named explicit option; never occurs during adapter reset/rebuild.
- Queries, sync, `open` and package loading do not auto-start containers or pull images.
- External/hosted connections never invoke container APIs, even if Docker is absent.
- Embedded adapters such as a file-backed engine do not require a runtime group.
- Registry credentials use existing runtime credential mechanisms; Docket does not hardcode registry logins.
- A setup wizard may generate templates using user-supplied images, but must expose the resolved plan and preserve existing user files.
- Do not run migrations or compatibility checks by connecting to unrelated databases; an adapter may report that its configured endpoint is incompatible.

Additional runtime providers, such as an explicitly configured local process or Podman Compose, can implement a separate runtime contract. They are not required for the first release.

## 7. Contracts

The following signatures are normative; supporting record schemas are described below and must be exported by `@docket/contracts`.

```ts
interface AdapterDefinition<C = unknown> {
  apiVersion: 1;
  name: string;
  validateConfig(input: unknown): C;
  create(config: C, services: AdapterServices): Promise<MemoryAdapter>;
}

interface MemoryAdapter {
  describe(): AdapterDescription;
  status(signal?: AbortSignal): Promise<AdapterStatus>;
  projection?: ProjectionPort;
  query?: QueryPort;
  close(): Promise<void>;
}

interface AdapterDescription {
  name: string;
  version: string;
  inputs: InputKind[];
  resultKinds: ResultKind[];
  rebuild: "deterministic" | "reconstructible" | "unsupported";
}

type InputKind = "entity" | "observation" | "document";

interface ProjectionPort {
  apply(batch: ProjectionBatch, signal?: AbortSignal): Promise<ApplyReceipt>;
  flush?(signal?: AbortSignal): Promise<void>;
  reset(scope: string, signal?: AbortSignal): Promise<void>;
}

interface QueryPort {
  ask(request: AskRequest): Promise<AdapterAnswer>;
}

interface AskRequest {
  requestId: string;
  question: string;
  context: {
    scope: string;
    now: string;
    timezone: string;
    conversation?: ConversationTurn[];
  };
  budget: {
    maxResults: number;
    maxEvidenceBytes: number;
    deadline: string;
  };
  signal?: AbortSignal;
}
```

`AdapterServices` supplies projectRoot, adapter-specific stateRoot, logger, read-only canonical record access, secret resolution and optional model clients. Adapter configuration may supply a native model configuration instead. Model use remains adapter-owned. Canonical access is scoped; query adapters do not mutate canonical evidence through this service.

`AdapterStatus` contains connected/ready/degraded/unavailable status, a safe message, last successful projection checkpoint, pending record counts when known and native-engine version when available. The coordinator owns canonical-versus-checkpoint lag calculation. A healthy connection does not imply a fresh index.

Optional structured graph or history tools may be additional interfaces, but querying must not require them. First release supports Promise responses; later streaming uses coordinator events for adapter-started, adapter-completed, adapter-failed and synthesis-completed without changing the final answer shape.

## 8. Projection records, identity and reliability

```ts
interface ProjectionBatch {
  batchId: string;
  scope: string;
  checkpoint: string;
  changes: RecordChange[];
}

type RecordChange =
  | { operation: "upsert"; record: CanonicalInput }
  | { operation: "remove"; kind: InputKind; id: string; revision: string };

interface ApplyReceipt {
  batchId: string;
  applied: string[];
  failed: { id: string; retryable: boolean; message: string }[];
}
```

Every input has kind, stable ID, revision/hash, scope, provenance and content appropriate to its kind. Entities retain merged attributes, relationships and assessments. Observations retain individual source references, observedAt and event/validity timestamps when actually known. Documents retain text, entity references and span-addressable source locations. Never invent an event time from file modification time.

Requirements:

- Deliver only input kinds the adapter declares. Related entity and observation records are distinct inputs; the adapter decides whether to index both.
- Identity key is `(adapter instance, scope, kind, canonical ID)`. Revision identifies a change, not a new logical record.
- Replaying a successful batch must not duplicate memories. Maintain canonical-to-native mappings for one-to-many chunk/fact outputs under adapter stateRoot or engine metadata.
- Changes and deletes remove or invalidate all derived native records mapped to that canonical input.
- An engine that cannot update in place may use replacement/tombstones or rebuild its scoped index; it must not silently retain deleted material as current evidence.
- Checkpoints advance only for acknowledged durable changes. Retry failures without assuming transactions across stores. A batch is not automatically atomic.
- Sync failure in one adapter does not corrupt another adapter's manifest. Use per-instance manifests and configuration fingerprints.
- Changed endpoint/scope/configuration must invalidate the relevant checkpoint and require reconciliation.
- Reset affects only the configured Docket namespace. Shared hosted databases must never be dropped globally.
- Rebuild replays canonical inputs. Model-extracted memories may be reconstructible without being byte-identical. Record the engine/model/configuration identity where known.
- Historical recall requires historical canonical observations/documents. A disposable store cannot preserve recoverable history that has been discarded from canonical files.

Extracted memories remain derived results. If a user adopts one as canonical knowledge, use an explicit capture operation with its evidence and derivation recorded; do not silently rewrite files during querying.

## 9. Query response

```ts
interface AdapterAnswer {
  interpretation: {
    description: string;
    assumptions: string[];
    timeRange?: { from: string; to: string };
    nativeQuery?: string;
  };
  blocks: ResultBlock[];
  evidence: RetrievedEvidence[];
  coverage: {
    mode: "exhaustive" | "top-k" | "unknown";
    truncated: boolean;
    scope: string;
    checkpoint?: string;
  };
  diagnostics: Diagnostic[];
}

interface RetrievedEvidence {
  id: string;
  nativeId?: string;
  kind: "passage" | "observation" | "derived-fact";
  text: string;
  canonicalRefs: CanonicalReference[];
  observedAt?: string;
  eventAt?: string;
  score?: number;
  derivation?: { engine: string; model?: string };
}

type ResultKind = "entities" | "passages" | "facts" | "graph"
  | "metric" | "table" | "timeline";
```

`ResultBlock` is a discriminated union. All blocks carry an ID, optional title and evidence IDs. Entity blocks contain canonical entity references; passage/fact blocks contain retrieved evidence IDs; graph blocks contain nodes, edges and optional ordered paths; metric blocks contain a labelled numeric value and optional unit; table blocks contain typed columns and rows; timeline blocks contain events with labelled timestamp semantics. Each table row, graph edge and timeline event can carry its own evidence IDs. Scalar text values belong in typed table cells or fact blocks rather than being coerced into numeric metrics.

Canonical references identify kind, ID, revision and optional source span. Line ranges refer to the stated revision. Unresolvable references are reported, not fabricated. Native-only evidence may be displayed as derived/unresolved but cannot be described as canonical verification. The coordinator namespaces block/evidence IDs by adapter instance before combining responses.

JSON responses must not contain SDK objects, Date objects, BigInt or functions. Counts preserve numeric precision; values outside safe JavaScript integer range use a typed decimal-string table cell. Runtime schemas validate the union and every evidence reference.

`exhaustive` means all matching records in the stated engine scope/filter, not all real-world events. Top-k matches must never be presented as an exhaustive event count. Scores are comparable only within their native adapter; retain them without averaging unrelated scales.

## 10. Query coordination and synthesis

1. Parse request, establish scope/current time/timezone and select enabled adapter instances.
2. Ask adapters independently with bounded concurrency and a shared deadline. Each uses its native strategy.
3. Validate results, reject out-of-scope references and resolve canonical sources against the request snapshot.
4. Retain per-adapter responses and failures. Deduplicate canonical references without discarding distinct interpretations or evidence.
5. Return rich results directly, or synthesise an answer using selected blocks and evidence under a global context budget.

Adapters must honour the supplied scope in their native queries. Dropping returned foreign records is additional validation, not a substitute for scoping an aggregate before execution.

Synthesis cites individual evidence, distinguishes derived facts from observations, states material coverage limits and preserves conflicting counts rather than silently choosing one. Include intermediate path entities when their content supports the answer. Use relevant excerpts and a total context budget instead of uniformly truncating every entity's beginning.

No engine can answer a deployment-count question reliably if deployment events were never captured. Return unsupported/insufficient evidence when necessary. An adapter may use native enumeration to compute an aggregate; a semantic top-k result alone is insufficient.

Cancellation propagates through AbortSignal where supported. Adapters that cannot cancel underlying work must report this capability limitation; coordinator stops accepting late results. Failures are structured and do not erase successful answers. Cache keys include question/context, adapter configuration and checkpoints, source revisions, model identity and synthesis instructions; unknown freshness requires conservative invalidation.

## 11. Engine-specific integration guidance

| Adapter | Ingestion | Query | Important mapping |
| --- | --- | --- | --- |
| Neo4j | Structured entities, edges and observations | Native text search, generated Cypher, explicit directed traversal or aggregates | Stable canonical IDs on nodes/observations; source links on returned rows |
| mem0 | Documents/observations or explicit facts; configure raw versus inferred ingestion | Native search/filters, with adapter-specific planning if needed | One canonical input can create multiple extracted memories; retain native mapping and derivation |
| MemPalace | Project documents and conversations | Native recall/search; temporal graph where supported by installed version | Map project scope to native organisation; preserve source passages |
| Memvid | Documents/observations with metadata and timestamps | Native lexical/semantic/temporal retrieval | Native frame IDs map to canonical input revisions; preserve history only when replayable canonically |
| JSONL | Canonical entity/debug records and optional observations | Lexical retrieval and deterministic structured operations where implemented | No external service required |

These are integration intentions, not guarantees of identical features across library versions. Pin and test SDK/API versions. A TS package can wrap a Python CLI, MCP service or HTTP endpoint; package modularity does not require rewriting the engine in TypeScript. Declare and diagnose external runtime requirements. Do not download Python runtimes, SDKs or models implicitly.

Engine adapters are not required to provide graph traversal. Graph traversal stays within graph-capable adapters. Shared answer contracts preserve each engine's strengths without forcing every engine to return entities only.

## 12. Project-local adapter example

File `tools/docket/company-memory.mjs`:

```js
export default {
  apiVersion: 1,
  name: "company-memory",

  validateConfig(value) {
    if (!value || typeof value.endpoint !== "string" ||
        typeof value.tokenEnv !== "string") {
      throw new Error("endpoint and tokenEnv are required");
    }
    return { ...value, endpoint: new URL(value.endpoint).href };
  },

  async create(config, services) {
    const token = await services.secrets.getEnv(config.tokenEnv);
    if (!token) throw new Error(`Missing ${config.tokenEnv}`);

    async function request(path, body, signal) {
      const response = await fetch(new URL(path, config.endpoint), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal
      });
      if (!response.ok) throw new Error(`Memory service HTTP ${response.status}`);
      return response.json();
    }

    return {
      describe: () => ({
        name: "company-memory", version: "1.0.0",
        inputs: ["document", "observation"],
        resultKinds: ["passages", "facts"],
        rebuild: "reconstructible"
      }),
      status: signal => request("./status", { scope: services.scope }, signal),
      projection: {
        apply: (batch, signal) => request("./ingest", batch, signal),
        reset: (scope, signal) => request("./reset", { scope }, signal)
      },
      query: {
        ask: ({ signal, ...requestBody }) =>
          request("./ask", requestBody, signal)
      },
      close: async () => {}
    };
  }
};
```

This example assumes an internal HTTP service speaking the Docket contracts. A real adapter for another API translates native request/response formats and enforces scope, idempotency, durable acknowledgements and evidence mappings. `status`, receipts and answers are runtime-validated by core. Endpoints should use a trailing slash when relative endpoint composition is desired.

Programmatic registration uses the same definition:

```ts
const docket = await createDocket({
  projectRoot,
  registrations: [{ id: "company-memory", definition, config }]
});
const answer = await docket.ask({ question, timezone: "Asia/Singapore" });
```

`docket adapter scaffold company-memory` may generate the module, config entry and contract-test fixture. It must not install packages or provision services without an explicit corresponding command.

## 13. UI specification

Keep the canonical graph and exhibit inspector. Add a main workspace with Browse and Ask routes. Query results occupy the main canvas rather than being confined to a narrow side panel.

### Browse

- Graph view of canonical entities/relationships, retaining existing type filters and exhibit selection.
- Table view of canonical entities and observations, filterable by type, source, date and assessment.
- History view for captured events/observations and decision supersession. Label eventAt versus observedAt explicitly.
- Quick search continues to search canonical browsing data; natural-language Ask uses adapters. Labels make the scope of each clear.

### Ask

- One question input, defaults to configured adapters; optional source selection.
- Results rendered by block kind: entity list, passage cards, fact cards, graph, metrics, table and timeline.
- A summary is optional. Results remain inspectable if synthesis is disabled or fails.
- Keep all relevant source results accessible; show disagreement rather than blending incompatible metrics.
- Evidence clicks open a shared inspector showing source text, canonical location/revision, derivation, adapter and native query interpretation.
- Derived facts without source resolution are visibly distinguished from verified canonical evidence.
- Graph view highlights returned subgraphs or paths, not guessed relationships between arbitrary hits. Non-graph answers retain their primary table/cards/timeline.
- Adapter progress and errors appear independently; one unavailable engine does not blank the workspace.

### Adapters and saved questions

- Adapter status page displays installed instances, enabled roles, connection health, freshness and safe diagnostics. No secret values.
- Runtime controls are separate explicit operations and show only user-configured resources. No automatic downloads from viewing this page.
- Saved questions persist question, scope, adapter selection and view preferences in a user-owned file outside the evidence stream. Opening reruns them by default. Historical answer snapshots require explicit save and record checkpoints/revisions.

The first release ships built-in shared renderers only. It does not load arbitrary frontend code from adapter packages. Unknown future blocks use a safe structured fallback. Suggested display hints are optional; the user can choose another supported view.

## 14. CLI/API/agent integration

Proposed commands:

```text
docket ask "Why did we choose Postgres?" --json
docket ask "How many deployments in four weeks?" --adapter company-memory
docket adapters list
docket adapters status
docket adapter scaffold company-memory
docket sync --adapter enterprise-graph
docket rebuild --adapter local
docket runtime plan graph-dev
docket runtime up graph-dev
docket runtime status graph-dev
docket runtime down graph-dev
```

`ask --json` returns adapter blocks, evidence and diagnostics; default human output can include synthesis. `--no-synthesis` preserves rich retrieval. Existing `search` remains available as a document-hit compatibility command.

API: retain `/api/graph`; add `POST /api/ask` for question, conversation and source selection, `GET /api/adapters` for descriptions/status and bounded evidence resolution for inspector clicks. Keep legacy GET `/api/ask` and `/api/chat` behind compatibility translation during migration. A request ID supports cancellation and diagnostics. State-changing runtime endpoints, if offered, are separate from read/query endpoints.

Skills teach agents to use CLI JSON results and inspect evidence; they do not implement memory retrieval. Optional MCP tools call the same core. UI, CLI and MCP must return consistent scoped answers.

## 15. Migration plan

1. Extract contracts and adapter loading. Wrap existing projections with compatibility definitions; retain v1 config and commands.
2. Move Neo4j/mem0 dependencies and schemas into optional adapter packages. Ship JSONL as the default lightweight adapter, included in the standard CLI distribution but removable in a minimal core deployment.
3. Convert v1 `projections` entries in memory to v2 adapter instances. Provide `docket config migrate --dry-run`; never require silently overwriting configuration. Map current mem0 modes and Neo4j settings without losing options.
4. Introduce per-adapter sync manifests and canonical document/observation inputs. Preserve existing entity identities and file authority.
5. Add rich results, evidence validation and the shared coordinator. Translate existing hits into entity blocks. Preserve original Cypher row values so aggregate queries no longer collapse into document hits.
6. Separate runtime provisioning from adapter connection; audit and replace hardcoded container images with configurable templates/user-owned Compose.
7. Update Ask workspace, table/passage/fact renderers and evidence inspector. Add timelines and saved questions next.
8. Implement additional engine integrations against pinned SDK/API versions and scoped fixtures; do not claim feature parity before validating it.

## 16. Acceptance criteria and validation

- A project with JSONL only works without Neo4j/mem0 packages, Docker, Python or network access.
- A project-local JS adapter loads from any working directory and answers through UI/CLI/API using the same contract.
- A private-registry/workspace package resolves from the project rather than the global CLI's dependency tree.
- A hosted endpoint works without container tooling; loading, sync and query make no provisioning calls.
- An internal-registry image is used exactly as configured. With pullPolicy never, no public-registry or implicit pull request occurs.
- User-owned multi-service Compose overrides survive setup and restart. Stopping resources preserves data volumes.
- An adapter rejecting its config gives an instance-specific actionable error; unsupported contract majors fail before execution.
- Sync replay, updates, one-to-many extraction and deletes do not duplicate or leave current stale memories. Partial failures retain correct per-adapter checkpoints.
- Two scopes sharing one store cannot query, count or reset each other's data.
- Neo4j can return a deployment count/table; recall engines can return source passages/facts without inventing entity nodes or exhaustive counts.
- The UI renders all declared result kinds, links individual results to evidence and remains useful when synthesis or one adapter fails.
- Source revisions, time interpretation, coverage and adapter freshness are visible. Intermediate graph evidence is loaded when used.
- Cancellation/deadlines prevent indefinite UI waits and late responses from replacing newer answers.
- Contract tests run against a small fake local adapter; integration tests cover each supported engine mode and approved container fixture. Retrieval evaluation uses representative questions: enumeration, why/decision, impact, temporal recall, counts and insufficient evidence. Compare evidence recall and grounded answer accuracy; do not rely solely on plausible prose.

## 17. References

- Docket: https://github.com/chrisjowen/docket
- mem0 ingestion/retrieval documentation: https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx
- MemPalace native ingestion, search and temporal graph: https://github.com/MemPalace/mempalace
- Memvid current single-file architecture and SDKs: https://github.com/memvid/memvid

External engine descriptions informed the integration direction; the interfaces, package names, configuration and migration above are proposed Docket design.
