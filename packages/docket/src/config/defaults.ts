import { fileURLToPath } from 'node:url'

/** Contents of a fresh `.docket.yaml`. Mirrors spec section 5 verbatim. */
export const DEFAULT_CONFIG_YAML = `version: 1

source:
  root: .docket
  include:
    - "**/*.md"

  exclude:
    - ".index/**"

ontology:
  file: .docket/entities.yaml

watch:
  debounceMs: 300

projections:
  - type: jsonl
    output: .docket/.index

  # Optional: project into mem0 as well. Needs \`pnpm add mem0ai\`.
  #
  # Hosted (app.mem0.ai) - the key is read from the environment:
  # - type: mem0
  #   mode: platform
  #   apiKeyEnv: MEM0_API_KEY
  #
  # Self-hosted - \`config\` is passed to mem0's Memory constructor as-is:
  # - type: mem0
  #   mode: oss
  #   config:
  #     embedder: { provider: ollama, config: { model: nomic-embed-text } }
  #     vectorStore: { provider: qdrant, config: { host: localhost, port: 6333 } }
  #     llm: { provider: ollama, config: { model: "qwen2.5:7b" } }

  # Optional: a Neo4j graph with full-text search. Needs \`pnpm add neo4j-driver\`.
  # - type: neo4j
  #   url: bolt://localhost:7687
  #   passwordEnv: NEO4J_PASSWORD
`

/**
 * Directory tree `docket init` creates, relative to the memory root
 * (spec section 4). These are conventions, not schema - a project may add
 * its own `resources/<plural>` directory without touching the CLI.
 */
export const DEFAULT_DIRECTORIES = [
  'resources/repositories',
  'resources/services',
  'resources/libraries',
  'resources/agents',
  'resources/systems',
  'resources/environments',
  'resources/datasources',
  'resources/teams',
  'decisions',
  'constraints',
  'notes',
  '.index'
]

/**
 * Absolute path to the bundled starting ontology. Resolved relative to this
 * module so it works from `src/` under vitest and from `dist/` after build -
 * the build script copies the yaml alongside the emitted JS.
 */
export const DEFAULT_ONTOLOGY_PATH = fileURLToPath(
  new URL('../ontology/default-sdlc.yaml', import.meta.url)
)

/** Appended to an existing `.gitignore`. Projections are disposable. */
export const GITIGNORE_ENTRY = '.docket/.index/'
