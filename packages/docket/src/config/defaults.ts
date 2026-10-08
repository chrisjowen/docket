import { fileURLToPath } from 'node:url'

/** Contents of a fresh `.docket.yaml`: version 2 (docs/adapter-spec.md §5). */
export const DEFAULT_CONFIG_YAML = `version: 2

source:
  root: .docket
  include:
    - "**/*.md"

  exclude:
    - ".index/**"
    - ".cache/**"

ontology:
  file: .docket/entities.yaml

watch:
  debounceMs: 300

# Adapter instances: each has a unique id, the module that serves it (a
# package, or a .js/.mjs file relative to this one), the roles it runs in and
# its own config. Secrets are never written here - name the environment
# variable that holds one (passwordEnv, apiKeyEnv, tokenEnv, ...).
adapters:
  - id: local
    module: "@docket/adapter-jsonl"
    roles: [projection, query]
    config:
      output: .docket/.index

  # Optional: mem0. Needs \`pnpm add mem0ai\`.
  #
  # Hosted (app.mem0.ai) - the key is read from the environment:
  # - id: memories
  #   module: "@docket/adapter-mem0"
  #   roles: [projection, query]
  #   config:
  #     mode: platform
  #     apiKeyEnv: MEM0_API_KEY
  #
  # Self-hosted - \`config.config\` is passed to mem0's Memory constructor as-is:
  # - id: memories
  #   module: "@docket/adapter-mem0"
  #   config:
  #     mode: oss
  #     config:
  #       embedder: { provider: ollama, config: { model: nomic-embed-text } }
  #       vectorStore: { provider: qdrant, config: { host: localhost, port: 6333 } }
  #       llm: { provider: ollama, config: { model: "qwen2.5:7b" } }

  # Optional: a Neo4j graph with full-text search. Needs \`pnpm add neo4j-driver\`.
  # - id: graph
  #   module: "@docket/adapter-neo4j"
  #   roles: [projection, query]
  #   config:
  #     uri: bolt://localhost:7687
  #     passwordEnv: NEO4J_PASSWORD

# How questions are put to the adapters. Every adapter with the query role
# answers unless defaultAdapters lists the ones to ask.
# query:
#   defaultAdapters: [local]
#   timeoutMs: 30000
#   maxConcurrentAdapters: 4
#   synthesis: true

# \`docket open\`'s chat summarizes answers with the \`claude\` CLI (Claude Code),
# using your own login - nothing to set. To choose its model, or to use a local
# Ollama model instead:
# summarize:
#   provider: claude
#   model: sonnet           # passed as \`claude --model\`
# or, for Ollama:
# summarize:
#   model: "qwen2.5:7b"     # Ollama at http://localhost:11434
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

/** Appended to an existing `.gitignore`. Projections and cached answers are disposable. */
export const GITIGNORE_ENTRIES = ['.docket/.index/', '.docket/.cache/']
