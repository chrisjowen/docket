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
   `docket ontology show <type>` are available if the CLI is installed.
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

## Never write indexes

Edit `.docket/entities.yaml` only. The watcher detects the ontology change and
revalidates and reprojects affected resources. Never edit `.docket/.index/`.
