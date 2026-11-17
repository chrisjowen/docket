# @chrisjowen/docket-server

The core a Docket server is built on, shared by Docket Cloud and a
self-hosted, single-tenant server: the same MCP tools, ontology writes and
permission checks, with each deployment plugging its own storage, sign-in and
tenancy in through ports.

```bash
npm install @chrisjowen/docket-server @chrisjowen/docket
```

`@chrisjowen/docket` is a peer dependency: the core parses and validates
documents with your docket, so a server validates exactly as `docket
validate` does.

It is being extracted from Docket Cloud release by release. This release
carries the ports, the scope and role vocabulary, the ontology lifecycle and
how a write becomes a document; the Postgres store, the MCP tools and
handler, and the reconcile and search loops follow.

## Ports

A deployment implements these; the core uses nothing else to reach its data
or its callers.

| Port | What a deployment supplies |
| --- | --- |
| `Tx` | One SQL transaction: anything with `query(text, values)`, such as a `pg` client |
| `DocumentCodec` | How document bodies are stored at rest: `seal`, `open`, and the `aad` that binds a body to its revision |
| `StoreContext`, `StoreRunner` | A transaction with its codec, and how to run one |
| `ScopeSource` | The stores the background loops visit: one per organisation, or just one |
| `Principal`, `McpResource` | Who is calling, and the workspace a request is for |
| `Authenticator` | Resolves a bearer credential to a principal |
| `Authorizer` | The principal's role now, and which roles may publish the ontology over MCP |
| `AuditSink` | Where each request's audit event goes, inside the write's transaction |
| `Limiter`, `ModelGate` | Optional rate limits, and a check before each model call |
| `QueryBackend` | Where search and ask are answered |

A deployment with richer principals or resources (an organisation id, say)
passes its own types: `Authenticator`, `Authorizer`, `Limiter` and
`ModelGate` take them as type parameters.

## Scopes and roles

```ts
import { checkScope, effectiveScopes, type Authorizer } from '@chrisjowen/docket-server'

const authorizer: Authorizer = {
  role: async (principal) => roleOf(principal.subject),
  ontologyWriters: async (workspaceId) => settingsOf(workspaceId).ontologyWriters
}

const refusal = checkScope(await effectiveScopes(principal, authorizer), 'docket:write')
if (refusal) return new Response(refusal.description, { status: refusal.status })
```

- `SCOPES`: `docket:read`, `docket:write`, `ontology:read`,
  `ontology:propose`, `ontology:write`. `docket:read` implies
  `ontology:read`.
- `ROLES`: `owner`, `admin`, `editor`, `viewer`. Viewers read; editors and
  up also write and propose; `ontology:write` reaches only the roles the
  workspace's `ontologyWriters` setting names, never a viewer.
- `effectiveScopes(principal, authorizer)` is the credential's scopes cut to
  its subject's role now, read on every call: demoting a member narrows every
  credential they hold from their next call, and one whose role is gone
  grants nothing.
- `checkScope(effective, needed)` is null when the call may go ahead, a 401
  `invalid_token` when the credential grants nothing, or a 403
  `insufficient_scope` naming the scope it lacks.

## The ontology lifecycle

A workspace's ontology changes by draft. `checkDraft` re-validates every
document against a draft with docket's validator and diffs the diagnostics
with the published head's, so the publisher sees what the change would do
before it lands:

```ts
import { checkDraft, type StoredDocument, type WorkspaceSnapshot } from '@chrisjowen/docket-server'

const snapshot: WorkspaceSnapshot = { documents, origins, head: { number: 1, ontology } }
const stored: StoredDocument[] = [] // the documents' text: read it when there is a migration
const check = checkDraft(snapshot, stored, draftYaml, { migration })
check.classification // 'safe', 'narrowing' or 'breaking'
```

- **Safe**: no document gains a diagnostic.
- **Narrowing**: existing resources or links gain diagnostics (`affected`
  lists them); an admin publishes anyway to accept them.
- **Breaking**: resources would become `unknown-type` or
  `unknown-relationship`. A migration (`renameType`, `mapType`,
  `renameRelationship`, `dropAttribute`) rewrites the server's own documents,
  keeping their layout and comments and recording the change as evidence; a
  document from a repository or the CLI changes at its source, so each one
  still broken is `unresolved` until the publisher gives it a disposition.

`importYaml` and `exportYaml` read and write `entities.yaml` as it is,
comments and all; `proposedText` applies a proposal, a whole ontology or a
merge patch onto the head; `TEMPLATES` are the starter ontologies, generated
from docket's own default by `pnpm -C packages/server templates`.

## Writes

Every write - an MCP write tool or a web form - becomes a docket Markdown
document. `stampEvidence` records the writer as the observer, the request as
the session and now as the time, keeping a client's own `observedBy` as
`reportedBy`. `composeDocument` merges the change into the resource's
document, or makes a new one, keeping what is there and adding only evidence
it does not already hold, so repeating a write adds nothing. The write tools
parse their arguments with `argumentsOf` and `parseEvidence`, and answer with
`writeAnswer`.

## Licence

[Apache License, Version 2.0](LICENSE).
