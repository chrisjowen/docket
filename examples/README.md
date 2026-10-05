# Examples

## `acme-platform/`

A worked docket for a small e-commerce platform. It exists so you can read
what a docket actually looks like once a real system is in it, rather than
inferring it from the format description.

Acme runs a checkout, an order service and a support chat API on a Kubernetes
cluster, plus a research agent on Databricks that a different team owns. There
is a payment processor it does not control, a customer-data residency rule it
did not choose, a superseded datastore decision, and a feature flag standing
between the old and new checkout. All of that is in `.docket/`.

```text
.docket.yaml                             config: where the docket lives, what to watch
.docket/entities.yaml                    the ontology - what types and links mean here
.docket/resources/<plural>/              resource files
.docket/decisions/                       decisions
.docket/constraints/                     constraints
.docket/.index/                          generated, gitignored, disposable
```

21 resources and 37 links:

| | |
|---|---|
| repository | `acme-platform` |
| teams | `platform-engineering`, `research-platform` |
| services | `orders`, `checkout`, `conversation-api` |
| library | `order-events` |
| agent | `research-assistant` |
| systems | `databricks`, `stripe` |
| environments | `production`, `staging` |
| datasources | `orders-db`, `sessions`, `market-data` |
| feature flag | `checkout-rewrite` |
| decisions | `research-assistant-on-databricks`, `orders-on-postgres`, `orders-on-dynamodb` |
| constraints | `eu-data-residency`, `pci-scope` |

## Run it

From this directory, with the CLI built (`pnpm -C packages/docket build` at the
repository root):

```bash
cd examples/acme-platform

node ../../packages/docket/dist/cli.js validate --strict
node ../../packages/docket/dist/cli.js rebuild
node ../../packages/docket/dist/cli.js ontology list
node ../../packages/docket/dist/cli.js ontology show feature_flag
node ../../packages/docket/dist/cli.js watch
```

Or with the package installed, just `docket validate`, `docket rebuild` and so
on.

`.docket/.index/` is generated. Delete it and run `rebuild` and you get the same
bytes back; that is the whole point of the projection model. It is gitignored by
the `.gitignore` in this directory - the root one only covers the root, because
Git anchors a pattern with an embedded slash to its own directory.

## What it demonstrates

**The ontology is the schema, and it is per-repository.**
`.docket/entities.yaml` starts as the default SDLC ontology from `docket init`
and then extends it: a `feature_flag` resource type, `guarded_by` and
`applies_to` relationships, and `library` added to the sources `owned_by` will
accept. No CLI change was needed for any of that. The extension blocks are
commented so you can see the seam.

**Links are real, and validated in both directions.** `service.checkout`
`depends_on` `service.orders` with `criticality: high`; `agent.research-assistant`
`deployed_to` `environment.production`; `decision.orders-on-postgres`
`supersedes` `decision.orders-on-dynamodb`. Point a relationship at a type its
definition does not allow and `docket validate` rejects it.

**Provenance distinguishes who captured what.** `service.orders` is
`capturedBy: human`, `confidence: 1.0`. `agent.research-assistant` is
`capturedBy: claude`, `confidence: 0.9`. Same file format, different trust.

**IDs do not depend on paths.** `feature_flag.checkout-rewrite` lives in
`resources/feature-flags/`, a directory the CLI knows nothing about. Move the
file and its identity is unchanged.

**Decisions keep their reasoning, including the ones that lost.**
`decision.orders-on-dynamodb` is superseded, not deleted, because why the event
schema looks the way it does is only in that file.

## The spec's three worked flows

`docs/SPEC.md` walks three flows. Each has something concrete here.

**§61, human edit.** A developer edits
`.docket/resources/services/orders.md`. Run `docket watch` in this directory,
change `lifecycle:` or add a link, and watch the index update. Executed and
recorded as criterion 4 of [`docs/ACCEPTANCE.md`](../docs/ACCEPTANCE.md).

**§62, Claude learns a decision.** The conversation establishes that Databricks
will host the Research Assistant. The result is
`decision.research-assistant-on-databricks` plus `runtime: databricks` and a
`depends_on system.databricks` link on `agent.research-assistant`. Both carry
`capturedBy: claude`.

**§63, unknown concept.** Feature flags turned out to matter durably and no
existing type represented one, so `feature_flag` and `guarded_by` were added to
`entities.yaml` and `checkout-rewrite.md` was created. What you see here is the
end state; the same extension performed step by step from a clean default
ontology is criteria 7 and 8 of [`docs/ACCEPTANCE.md`](../docs/ACCEPTANCE.md).
