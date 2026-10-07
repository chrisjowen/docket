---
name: remember
description: Write durable knowledge and evidence into the docket under .docket/. Use proactively, without being asked, whenever the session establishes or sees durable project knowledge - the user states a decision, constraint, convention or owner; you settle a decision or uncover a constraint; or code, config or infrastructure you read shows a resource or dependency the docket lacks, or confirms or contradicts one it has. Also use when the user says "remember this", "capture this", "add this to the docket", "record this decision" or "add this to memory", and when a background review collects evidence from a session transcript.
---

# Remember

Write durable knowledge to canonical Markdown under `.docket/`, with evidence
saying exactly where each thing was seen. Use the `docket` skill for the CLI
commands referenced here.

## When to capture

The docket is an evidence collector: it grows, and its confidence rises, from
every sighting a session makes. Capture without being asked and without
asking permission when:

- the user states a decision, constraint, convention, owner or dependency
- you settle a decision or uncover a constraint while working
- code, config, manifests or infrastructure you read show a resource,
  attribute or relationship the docket does not have yet
- something you read confirms a docket entry (add a sighting) or contradicts
  it (update the value, with evidence for the new one)

Capture at a natural pause, after the step you are on, so the user's task
keeps moving, and say in one line which file you wrote. An explicit "remember
this" is not required; it only makes the capture certain.

## Procedure

1. Find existing knowledge with `docket search <subject>`, then grep `.docket/`
   for the likely `id` to confirm it is unused.
2. Decide update or create:
   - existing resource seen again, or with new facts -> update that file
   - genuinely new resource -> create one file
   - no existing type fits -> use the `ontology` skill to extend
     `.docket/entities.yaml` conservatively, then write the file
3. Run `docket ontology show <type>` for the type you are writing, so
   attributes and `links` match what it allows, and `docket ontology list` for
   the evidence sources this repository registers and what each must point
   at. Never assume a fixed ontology.
4. Write the file in the format below, with `evidence` on the resource and on
   every link.
5. Add relationships in `links` where meaningful - ownership, dependency, use,
   deployment, supersession. A relationship the user stated is part of what
   they asked you to remember.
6. Run `docket validate`, fix every error, and fix the `missing-evidence`
   warnings on what you wrote. Report the file path you wrote. Never touch
   `.docket/.index/`; the watcher projects your edits.

## File format

Markdown with YAML frontmatter. Required fields: `id`, `type`, `title`.

```markdown
---
id: pod.orders-api
type: pod
title: Orders API pod

tags:
  - orders

attributes:
  kind: deployment
  namespace: orders
  replicas: 3

links:
  - rel: runs_in
    target: cluster.prod-eu
    evidence:
      - source: infrastructure
        path: deploy/k8s/orders/kustomization.yaml
        lines: 1-9
        symbol: namespace
        observedAt: 2026-10-05
        observedBy: claude
        session: 6c1f0e2a
        note: The orders overlay is applied to the prod-eu context.

  - rel: depends_on
    target: secret.orders-db-password
    evidence:
      - source: infrastructure
        path: deploy/k8s/orders/deployment.yaml
        lines: 31-36
        symbol: env.DB_PASSWORD.valueFrom.secretKeyRef
        observedAt: 2026-10-05
        observedBy: claude
        session: 6c1f0e2a

evidence:
  - source: infrastructure
    path: deploy/k8s/orders/deployment.yaml
    lines: 1-48
    symbol: Deployment/orders-api
    commit: 3f2c1d0
    urls:
      - https://github.com/acme/platform/blob/3f2c1d0/deploy/k8s/orders/deployment.yaml#L1-L48
    observedAt: 2026-10-05
    observedBy: claude
    session: 6c1f0e2a
    note: Deployment with 3 replicas of the orders-api image on port 8080.

provenance:
  capturedBy: claude
---

# Orders API pod

The Deployment that serves the orders API: three replicas of the `orders-api`
image in the `orders` namespace, behind the `orders` Service on port 8080. It
reads its database password from the `orders-db-password` secret and is rolled
out by the `deploy-orders` pipeline.

Known only from the manifests under `deploy/k8s/orders/` - not yet seen
running, so the replica count is what is intended, not what is live.
```

- `id` is `<type>.<semantic-name>`, globally unique, and independent of the
  file's path; moving a file must not change its `id`.
- Directories under `.docket/` are convention. `type:` decides what a file is.
- Each `links` entry needs `rel` and `target`, and may carry `attributes` when
  the relationship defines them. A target that does not exist yet is a warning,
  not an error.
- Set `provenance.capturedBy: claude` when you wrote the file. Do not write
  `provenance.confidence` or `provenance.authority`; they are from before
  evidence and only stand in where there is none.
- `[[service.identity]]` inline references are weak mentions only. Assert real
  relationships in `links`.

## Evidence

Every resource and every link you capture records where it was seen. One
entry per observation:

| Field | What it holds |
|---|---|
| `source` | Where it was seen, as a registered kind: `code`, `manifest`, `config`, `infrastructure`, `api`, `runtime`, `docs`, `conversation`, `human` by default |
| `path`, `lines`, `symbol` | The repo-relative file, `12` or `12-40`, and the function, class, resource or manifest entry |
| `key` | The config or manifest key, e.g. `dependencies.pg`, `services.orders.replicas` |
| `method`, `endpoint` | The API call or route, e.g. `GET` `/v1/orders/{id}` or a full URL |
| `urls` | Links that point at it: a permalink to the lines, API docs, a dashboard, a ticket |
| `repository`, `commit` | The repository, when it is not this one; the revision you read |
| `observedAt`, `observedBy`, `session` | The date, `claude`, and the session id when you know it |
| `note` | What you saw there, in a sentence |

- Choose `source` by where you saw it, not by what it is: a pod read from a
  Helm chart is `infrastructure`, the same pod seen with kubectl is `runtime`,
  and something the user told you is `conversation`.
- Be exact. `source: code` alone is not evidence; the file, lines and symbol
  are. `docket validate` rejects evidence missing the location its source
  requires.
- Add `urls` whenever there is something to point at. With a GitHub remote,
  a permalink is `https://github.com/<org>/<repo>/blob/<commit>/<path>#L12-L40`.
- Record only what you actually saw. Never invent evidence, and add evidence
  to an existing resource or link only for a sighting you made.
- Never write a confidence. It is computed from the evidence and the rules in
  `.docket/entities.yaml`: a dependency in a manifest counts for a lot, a pod
  or secret read from code for little until an independent source - the
  cluster, a dashboard, a person - confirms it.

## Body

The body is the description a person or agent reads first. Write enough to
stand alone: what it is and does, how it is used, configured or deployed, how
it relates to its neighbours, and how it was found - including what has not
been confirmed yet. Do not just restate attributes.

## Updating

Evidence is append-only. When you see something already in the docket again,
add an entry to its `evidence` (or to the link's) and leave every earlier entry
as it is - never edit, reorder or remove evidence, even when it looks stale.
That is how a second, independent sighting raises its confidence.

Record each place once per session. Before appending, check the entry's
evidence: if it already has an entry from this session at the same location,
leave it. A sighting from a different place, source or session is new evidence;
the same file read twice in one session is not.

Add a new fact as a new attribute or link. When a fact has changed, update the
value and record the evidence for the new one. Do not create
`agent.research-assistant-v2` unless it is genuinely a different resource.

Two files that declare the same `id` are merged into one resource, so a capture
made on another branch is not lost - but prefer one file per resource and
update it.

When a decision replaces an earlier one, keep both files and link the new one
with `rel: supersedes`.

## Judgement

Capture: decisions, ownership, dependencies, constraints, conventions,
services, agents, systems, environments, datasources, teams.

Never capture credentials, secrets, tokens, private keys or passwords - not
when asked to, and not when they appear in a session or transcript you are
reviewing. The docket is committed to the repository and may be sent to
remote projections. Record that a secret exists and where it is managed (for
example, which vault or environment variable), never its value.

Do not capture transient debugging state, speculation, temporary
implementation details, or line-level detail that nearby code already says
plainly - a function's arguments, a loop's bounds. A resource, dependency or
convention seen in code is worth capturing, with the code as its evidence.
When asked to capture the noise, refuse politely, say why, and offer the
durable version if there is one.

Prefer one accurate update over several overlapping new files.
