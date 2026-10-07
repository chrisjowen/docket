---
name: ontology
description: Inspect or extend the docket ontology in .docket/entities.yaml. Use when asked to add a new resource type or relationship, extend the docket model, or answer "how should this concept be represented in the docket?", and whenever a durable concept cannot be captured accurately with the existing resource types.
---

# Docket ontology

`.docket/entities.yaml` is the repository's ontology: the registry of resource
types and relationships. It is data, not code. The CLI does not need changing
when it grows.

## Procedure

1. Read `.docket/entities.yaml` in full. `docket ontology list` and
   `docket ontology show <type>` summarise it (see the `docket` skill).
2. Prefer reuse. Check for semantic duplication before adding anything. Add a
   new resource type only when an important durable concept cannot be
   represented accurately using existing types.
3. Name the missing semantics explicitly before editing: what can this concept
   not express today - a type, an attribute on an existing type, or a
   relationship? Adding an attribute or relationship is usually the right
   answer.
4. Add conservatively. One type, with the few attributes that actually matter.
   Add relationships that connect it to existing types.
5. Keep backwards compatibility. Do not rename or remove existing types,
   attributes or relationships, and do not reorganise the file, unless the user
   asked for exactly that. Existing resource files depend on these names.
6. Run `docket validate` after editing. Resource files referencing a type or
   relationship you removed will fail.
7. Then write or update the resource files that needed the new semantics.

## Avoid proliferation

Do not create near-synonyms:

```text
service
backend_service
microservice
api_service
application_service
```

unless the project explicitly needs those distinctions.

## Format

```yaml
version: 1

resourceTypes:

  feature_flag:
    description: >
      Runtime configurable feature controlling software behaviour.

    attributes:
      key:
        type: string

      default:
        type: boolean

    extraction:
      instructions: >
        Capture significant feature flags whose existence or lifecycle
        matters across development sessions.

relationships:

  controls:
    description: >
      Indicates that a resource controls availability or behaviour
      of another resource.

    from:
      - feature_flag

    to:
      - service
      - agent
```

Rules:

- Attribute types: `string`, `number`, `boolean`, `string[]`, `number[]`, each
  optionally with `enum:`. Do not invent a richer schema language.
- A relationship declares `from` and `to` as lists of resource types, or `"*"`
  for any registered type. It may declare `attributes` with the same types.
- `description` and `extraction.instructions` are read by agents. Write them so
  a future agent can tell this type apart from its neighbours. Use
  `extraction.clues` and `extraction.doNotConfuseWith` where confusion is
  likely.

## Evidence sources and confidence rules

Captured resources and links carry `evidence` naming a source kind - `code`,
`manifest`, `infrastructure`, `runtime` and so on. Confidence is computed from
that evidence, never written by hand, and the ontology says what each kind of
evidence is worth:

```yaml
evidence:
  unevidenced: 0.5          # no evidence and no stated provenance.confidence
  sources:
    code:
      description: Source code. Record the file, lines and symbol.
      confidence: 0.6       # one observation, unless a type says otherwise
      requires: [path]      # location fields every observation must give
    runtime:
      confidence: 0.85
      requiresAny: [urls, endpoint, symbol]

resourceTypes:
  secret:
    confidence:             # what one observation is worth for this type
      code: 0.3             # a name in code is not proof a secret exists
      runtime: 0.85

relationships:
  depends_on:
    confidence:
      manifest: 0.95        # a declared dependency is close to certain
```

- Observations of one source kind do not corroborate each other; the strongest
  counts. Independent kinds combine: `1 - (1 - a)(1 - b)`.
- Add a type's `confidence:` block when evidence about it is notably stronger
  or weaker than the source's default - typically for things code only refers
  to by name (pods, secrets, clusters) or things a manifest declares outright.
- `evidence.sources` replaces docket's built-in kinds when present. A type or
  relationship without a `confidence:` block uses docket's built-in rule for
  that name, if there is one. `docket ontology show <type>` prints the
  effective value per source.
- Location fields are `repository`, `path`, `lines`, `symbol`, `key`,
  `method`, `endpoint`, `urls` and `commit`.

## Never write indexes

Edit `.docket/entities.yaml` only. The watcher detects the ontology change and
revalidates and reprojects affected resources. Never edit `.docket/.index/`.
