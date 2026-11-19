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

    icon: flag

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
- `icon` is optional: the Lucide icon name (kebab-case, e.g. `server`) the
  `docket open` web UI draws the type with. Give a new type one so it is
  recognisable on the graph; `docket validate` warns about an icon docket does
  not bundle, and the type is drawn with a generic one.
- `description` and `extraction.instructions` are read by agents. Write them so
  a future agent can tell this type apart from its neighbours. Use
  `extraction.clues` and `extraction.doNotConfuseWith` where confusion is
  likely.

## Sources and trust policies

Captured resources and links carry `evidence` naming a source - `code`,
`manifest`, `infrastructure`, `runtime`, a person, a document - and where it
was seen. Confidence is computed from that evidence, never written by hand:
the ontology declares its `sources` and, under `trust`, the policies that say
what an observation is worth.

```yaml
sources:
  code:
    description: Source code. Record the file, lines and symbol.
    locator:
      path: { required: true }      # every observation must give it
  runtime:
    locator: { urls: {}, endpoint: {}, symbol: {} }
    requiresAny: [urls, endpoint, symbol]
  document:
    kind: content
    attributes:
      status: { type: string, enum: [verified, draft], setBy: registry }
    locator:
      url: { required: true }       # observations give it under `locator:`

trust:
  unevidenced: 0.5                  # no evidence and no stated provenance.confidence
  fallback: 0.4                     # no score policy matches
  cap: 0.99
  policies:
    - name: code evidence
      when: { source: code }
      score: 0.6
    - name: A secret named in code   # a name in code is not proof a secret exists
      when: { about: secret, source: code }
      score: 0.3
    - name: A declared dependency
      when: { about: depends_on, source: manifest }
      score: 0.95
    - name: Verified document
      when: { source: document, status: verified }
      score: 0.85
    - name: Only seen in tests
      when: { source: code, "@path": { matches: "**/*_test.*" } }
      adjust: -0.1
```

- The most specific matching `score` policy prices an observation - `about`
  counts one, each condition one - and a tie goes to the lower score. Every
  matching `adjust` policy then moves it. Nothing goes above `cap`.
- Observations of one source instance do not corroborate each other; the
  strongest counts. Independent ones combine: `1 - (1 - a)(1 - b)`.
- Add a policy `about` a type when evidence about it is notably stronger or
  weaker than the source's default - typically for things code only refers to
  by name (pods, secrets, clusters) or things a manifest declares outright.
- An attribute's `setBy` says who may set it. Policies trust what the
  `directory`, a `connection` or the `registry` says; a writer's claims count
  only for `reporter` attributes.
- Every source accepts the common location fields `repository`, `path`,
  `lines`, `symbol`, `key`, `method`, `endpoint`, `urls` and `commit`;
  declare any others under `locator`.
- A `kind: identity` source - the templates' `person` - is who said it: its
  attributes (role, team, flags) come from the people directory,
  `.docket/people.yaml`, and evidence citing no source is the writer's own
  person. Write policies on `role` or `flags` to weigh people.
- `docket ontology show <type>` prints the effective value per source, and
  `docket why <id>` the policies that priced a resource. An ontology still in
  the legacy `evidence:` form scores as it did; `docket ontology convert
  --write` rewrites it.

## Never write indexes

Edit `.docket/entities.yaml` only. The watcher detects the ontology change and
revalidates and reprojects affected resources. Never edit `.docket/.index/`.
