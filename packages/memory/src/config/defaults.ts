import { fileURLToPath } from 'node:url'

/** Contents of a fresh `.memory.yaml`. Mirrors spec section 5 verbatim. */
export const DEFAULT_CONFIG_YAML = `version: 1

source:
  root: .memory
  include:
    - "**/*.md"

  exclude:
    - ".index/**"

ontology:
  file: .memory/entities.yaml

watch:
  debounceMs: 300

projections:
  - type: file
    output: .memory/.index
`

/**
 * Directory tree `memory init` creates, relative to the memory root
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
export const GITIGNORE_ENTRY = '.memory/.index/'
