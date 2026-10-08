import { basename } from 'node:path'

import { Document } from 'yaml'

import { V1_PROJECTION_MODULES } from '../config/config.js'
import type { DockerComposeRuntimeConfig, PullPolicy } from '../runtime/config.js'
import { Answers, checkEnvName, checkNonBlank, checkPort, checkUrl, uniqueId } from './answers.js'

/** An environment variable the developer sets. Only its name is ever written anywhere. */
export interface EnvRequirement {
  name: string
  purpose: string
  /** Holds a secret: the plan never shows, asks for or writes its value. */
  secret: boolean
  /** Whether the adapter or runtime fails without it. */
  required: boolean
}

/** A file the installer creates if, and only if, nothing is there yet. */
export interface TemplateFile {
  /** Relative to the directory holding `.docket.yaml`. */
  path: string
  contents: string
  purpose: string
}

/** What one provider needs for one adapter instance. */
export interface ProviderSetup {
  /** The instance's `config`: names of environment variables, never their values. */
  config: Record<string, unknown>
  /** A local runtime group the instance connects to, when the developer chose one. */
  runtime?: { id: string; config: DockerComposeRuntimeConfig } | undefined
  files: TemplateFile[]
  env: EnvRequirement[]
  /** Commands that install what the adapter drives - an engine or CLI docket never installs - each with why. */
  prerequisites: string[]
  /** Anything the developer should know about what was chosen. */
  notes: string[]
}

export interface ProviderContext {
  answers: Answers
  /** The instance id already chosen. */
  id: string
  projectRoot: string
  /** Runtime ids `.docket.yaml` already defines. */
  runtimes: ReadonlySet<string>
}

/**
 * One kind of adapter `docket adapter add` can set up: which module serves it,
 * which optional driver package it needs, and the questions that configure it.
 */
export interface AdapterProvider {
  name: string
  module: string
  summary: string
  /** The npm package the adapter imports at runtime, which the project installs. */
  driver?: string | undefined
  /** The instance id offered first. */
  defaultId: string
  configure(context: ProviderContext): Promise<ProviderSetup>
}

const RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '') || 'project'

/**
 * Asks for a local runtime group's id, Compose file, project name and pull
 * policy, and returns the group. The Compose file is the provider's to write.
 */
const askRuntime = async (
  context: ProviderContext,
  service: string
): Promise<{ id: string; config: DockerComposeRuntimeConfig }> => {
  const { answers } = context
  const id = await answers.text({
    flag: '--runtime-id',
    question: 'Runtime group id (what `docket runtime up <id>` takes)',
    fallback: uniqueId(`${context.id}-dev`, context.runtimes),
    check: (value) =>
      !RUNTIME_ID.test(value)
        ? 'starts with a letter or digit and uses only letters, digits, ".", "_" and "-"'
        : context.runtimes.has(value)
          ? `runtime "${value}" is already defined in .docket.yaml; choose another id`
          : undefined
  })
  const composeFile = await answers.text({
    flag: '--compose-file',
    question: 'Compose file to create (relative to .docket.yaml; an existing file is kept as it is)',
    fallback: `./infra/docket-${id}.compose.yaml`,
    check: (value) =>
      checkNonBlank(value) ?? (/\.ya?ml$/.test(value) ? undefined : 'a .yaml or .yml file')
  })
  const projectName = await answers.text({
    flag: '--project-name',
    question: 'Compose project name',
    fallback: `docket-${slug(basename(context.projectRoot))}-${slug(id)}`,
    check: (value) =>
      /^[a-z0-9][a-z0-9_-]*$/.test(value) ? undefined : 'lowercase letters, digits, "_" and "-", starting with a letter or digit'
  })
  const pullPolicy = (await answers.choose({
    flag: '--pull-policy',
    question: 'When may `docket runtime up` pull the image?',
    choices: [
      { value: 'never', label: 'never - use only an image already present (docker pull it yourself)' },
      { value: 'missing', label: 'missing - pull it when it is not present' },
      { value: 'always', label: 'always - pull on every up' }
    ],
    fallback: 'never'
  })) as PullPolicy
  return {
    id,
    config: {
      provider: 'docker-compose',
      composeFile: composeFile.startsWith('.') || composeFile.startsWith('/') ? composeFile : `./${composeFile}`,
      projectName,
      pullPolicy,
      services: [service]
    }
  }
}

/** A Compose template, commented, with `image` exactly as the developer gave it or read from a variable. */
const composeTemplate = (options: {
  header: string
  service: string
  image: string
  ports: string[]
  environment: Record<string, string>
  volume: { name: string; target: string }
}): string => {
  const document = new Document({
    services: {
      [options.service]: {
        image: options.image,
        ports: options.ports,
        environment: options.environment,
        volumes: [`${options.volume.name}:${options.volume.target}`]
      }
    },
    volumes: { [options.volume.name]: {} }
  })
  document.commentBefore = options.header
  return document.toString({ flowCollectionPadding: false, lineWidth: 0 })
}

/** The image: one the developer names, or a required variable Compose reads when `up` runs. Never a default. */
const askImage = async (answers: Answers, variable: string, engine: string): Promise<{ image: string; env?: EnvRequirement }> => {
  const image = await answers.text({
    flag: '--image',
    question: `${engine} image to run (your approved reference, tag or digest; empty: read it from an environment variable)`,
    optional: true,
    check: checkNonBlank
  })
  if (image !== undefined) return { image }
  const name = await answers.text({
    flag: '--image-env',
    question: 'Environment variable holding the image reference',
    fallback: variable,
    check: checkEnvName
  })
  return {
    image: `\${${name}:?Set ${name} to the approved ${engine} image reference}`,
    env: { name, purpose: `the ${engine} image the Compose file runs (docket never chooses one)`, secret: false, required: true }
  }
}

const jsonl: AdapterProvider = {
  name: 'jsonl',
  module: V1_PROJECTION_MODULES.jsonl,
  summary: 'JSONL files in the repository, searched by keyword; no service, driver or network',
  defaultId: 'local',
  async configure({ answers, id }) {
    const output = await answers.text({
      flag: '--output',
      question: 'Directory to write the JSONL files to (relative to .docket.yaml)',
      fallback: `.docket/.index/${id}`,
      check: checkNonBlank
    })
    return { config: { output }, files: [], env: [], prerequisites: [], notes: [] }
  }
}

const NEO4J_SCHEMES = ['bolt', 'bolt+s', 'bolt+ssc', 'neo4j', 'neo4j+s', 'neo4j+ssc']

const neo4j: AdapterProvider = {
  name: 'neo4j',
  module: V1_PROJECTION_MODULES.neo4j,
  summary: 'a Neo4j graph with full-text search: an existing or hosted server, or a local container',
  driver: 'neo4j-driver',
  defaultId: 'graph',
  async configure(context) {
    const { answers, id } = context
    const mode = await answers.choose({
      flag: '--mode',
      question: 'Where does the Neo4j server run?',
      choices: [
        { value: 'external', label: 'an existing or hosted server I connect to (e.g. neo4j+s://graph.example.com)' },
        { value: 'local', label: 'a local container docket manages with `docket runtime`, from an image I supply' }
      ],
      fallback: 'external'
    })
    const scope = await answers.text({
      flag: '--scope',
      question: 'Scope to file this checkout\'s nodes under (empty: one unique to the checkout)',
      optional: true,
      check: checkNonBlank
    })
    const database = await answers.text({
      flag: '--database',
      question: 'Database (empty: the server\'s default)',
      optional: true,
      check: checkNonBlank
    })

    if (mode === 'external') {
      const url = await answers.text({
        flag: '--url',
        question: 'Connection URI',
        hint: 'the URI of the Neo4j server to connect to, e.g. neo4j+s://graph.example.com (or pass --mode local)',
        check: checkUrl(NEO4J_SCHEMES)
      })
      const username = await answers.text({ flag: '--username', question: 'Username', fallback: 'neo4j', check: checkNonBlank })
      const passwordEnv = await answers.text({
        flag: '--password-env',
        question: 'Environment variable holding the password (type "none" for a server without auth)',
        fallback: 'NEO4J_PASSWORD',
        check: (value) => (value === 'none' ? undefined : checkEnvName(value))
      })
      const authenticated = passwordEnv !== 'none'
      return {
        config: {
          uri: url,
          username,
          ...(authenticated ? { passwordEnv } : {}),
          ...(database ? { database } : {}),
          ...(scope ? { scope } : {})
        },
        files: [],
        env: authenticated
          ? [{ name: passwordEnv, purpose: `the password for ${username} on ${url}`, secret: true, required: true }]
          : [],
        prerequisites: [],
        notes: []
      }
    }

    const service = 'neo4j'
    const runtime = await askRuntime(context, service)
    const { image, env: imageEnv } = await askImage(answers, 'DOCKET_NEO4J_IMAGE', 'Neo4j')
    const port = await answers.text({
      flag: '--port',
      question: 'Local port for Bolt (bound to 127.0.0.1 only)',
      fallback: '17687',
      check: checkPort
    })
    const passwordEnv = await answers.text({
      flag: '--password-env',
      question: 'Environment variable holding the local password (the container and the adapter both read it)',
      fallback: 'DOCKET_NEO4J_PASSWORD',
      check: checkEnvName
    })
    const contents = composeTemplate({
      header:
        ` Neo4j for docket adapter "${id}" (runtime ${runtime.id}). Created by \`docket adapter add\`;\n` +
        ` it is yours now: docket never rewrites it. Start it with \`docket runtime up ${runtime.id}\`.\n` +
        ' The image is assumed to follow the official Neo4j image\'s NEO4J_AUTH convention.',
      service,
      image,
      ports: [`127.0.0.1:${port}:7687`],
      environment: {
        NEO4J_AUTH: `neo4j/\${${passwordEnv}:?Set ${passwordEnv} to the local Neo4j password}`
      },
      volume: { name: `${slug(id)}-data`, target: '/data' }
    })
    return {
      config: {
        uri: `bolt://127.0.0.1:${port}`,
        username: 'neo4j',
        passwordEnv,
        ...(database ? { database } : {}),
        ...(scope ? { scope } : {})
      },
      runtime,
      files: [{ path: runtime.config.composeFile, contents, purpose: `Compose file for runtime ${runtime.id}` }],
      env: [
        ...(imageEnv ? [imageEnv] : []),
        {
          name: passwordEnv,
          purpose: 'the local Neo4j password (at least 8 characters), read by the container and the adapter',
          secret: true,
          required: true
        }
      ],
      prerequisites: [],
      notes: [
        runtime.config.pullPolicy === 'never'
          ? 'pullPolicy is never: `docket runtime up` uses only an image already present, so pull or load it yourself first.'
          : `pullPolicy is ${runtime.config.pullPolicy}: \`docket runtime up\` may pull the image; adding the adapter pulls nothing.`
      ]
    }
  }
}

const mem0: AdapterProvider = {
  name: 'mem0',
  module: V1_PROJECTION_MODULES.mem0,
  summary: 'mem0 memories: hosted mem0 (app.mem0.ai) or a self-hosted mem0 server',
  driver: 'mem0ai',
  defaultId: 'memories',
  async configure({ answers }) {
    const mode = await answers.choose({
      flag: '--mode',
      question: 'Which mem0?',
      choices: [
        { value: 'platform', label: 'hosted mem0 (app.mem0.ai), with an API key' },
        { value: 'server', label: 'a self-hosted mem0 REST server I connect to' }
      ],
      fallback: 'platform'
    })
    const url =
      mode === 'server'
        ? await answers.text({
            flag: '--url',
            question: 'Server URL',
            hint: 'the URL of the mem0 server, e.g. http://localhost:8888 (or pass --mode platform)',
            check: checkUrl(['http', 'https'])
          })
        : undefined
    const apiKeyEnv = await answers.text({
      flag: '--api-key-env',
      question: mode === 'server' ? 'Environment variable holding the API key, if the server needs one' : 'Environment variable holding the API key',
      fallback: 'MEM0_API_KEY',
      check: checkEnvName
    })
    const scope = await answers.text({
      flag: '--scope',
      question: 'Agent id to file memories under (empty: one unique to the checkout)',
      optional: true,
      check: checkNonBlank
    })
    return {
      config: {
        mode,
        ...(url ? { url } : {}),
        apiKeyEnv,
        ...(scope ? { scope: { agentId: scope } } : {})
      },
      files: [],
      env: [
        {
          name: apiKeyEnv,
          purpose: mode === 'server' ? `the API key for ${url}, when it requires one` : 'your mem0 platform API key',
          secret: true,
          required: mode === 'platform'
        }
      ],
      prerequisites: [],
      notes: [
        'mem0\'s in-process mode (mode: oss) needs an embedder, vector store and LLM configured; write that entry by hand (see the README).'
      ]
    }
  }
}

/** A config value the adapter defaults itself is left out, so the entry stays as short as what was chosen. */
const unlessDefault = (key: string, value: string, fallback: string): Record<string, string> =>
  value === fallback ? {} : { [key]: value }

const MEMVID_NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const memvid: AdapterProvider = {
  name: 'memvid',
  module: '@docket/adapter-memvid',
  summary: 'a memvid .mv2 file, searched lexically through the memvid CLI; embedded, no service',
  defaultId: 'memvid',
  async configure({ answers }) {
    const file = await answers.text({
      flag: '--file',
      question: 'Memory file, relative to .docket.yaml (empty: memory.mv2 in the adapter\'s own state directory)',
      optional: true,
      check: (value) => checkNonBlank(value) ?? (value.endsWith('.mv2') ? undefined : 'a .mv2 file')
    })
    const namespace = await answers.text({
      flag: '--namespace',
      question: 'Namespace for this project\'s frames (empty: the docket scope; set one when projects share a file)',
      optional: true,
      check: (value) => (MEMVID_NAMESPACE.test(value) ? undefined : 'one URI segment: letters, digits, ".", "_" and "-"')
    })
    const command = await answers.text({
      flag: '--command',
      question: 'The memvid CLI: a command on PATH, or a path relative to .docket.yaml',
      fallback: 'memvid',
      check: checkNonBlank
    })
    return {
      config: { ...(file ? { file } : {}), ...(namespace ? { namespace } : {}), ...unlessDefault('command', command, 'memvid') },
      files: [],
      env: [],
      prerequisites: ['npm install -g memvid-cli@2.0.160   # the memvid CLI it was tested with; docket never installs it'],
      notes: []
    }
  }
}

/** MemPalace's own rule for wing names (3.10.0): up to 128 characters, starting and ending with a letter or digit. */
const PALACE_NAME = /^(?:[\p{L}\p{N}]|[\p{L}\p{N}][\p{L}\p{N}_ .'-]{0,126}[\p{L}\p{N}])$/u

const mempalace: AdapterProvider = {
  name: 'mempalace',
  module: '@docket/adapter-mempalace',
  summary: 'drawers in a MemPalace wing, recalled through its MCP server; runs offline',
  defaultId: 'palace',
  async configure({ answers }) {
    const palace = await answers.text({
      flag: '--palace',
      question: 'Palace directory, relative to .docket.yaml (empty: one in the adapter\'s own state directory)',
      optional: true,
      check: checkNonBlank
    })
    const wing = await answers.text({
      flag: '--wing',
      question: 'Wing to file drawers under (empty: one unique to the checkout)',
      optional: true,
      check: (value) =>
        PALACE_NAME.test(value) && !value.includes('..')
          ? undefined
          : 'letters, digits, " ", ".", "_", "\'" and "-", starting and ending with a letter or digit'
    })
    const embeddingModel = await answers.choose({
      flag: '--embedding-model',
      question: 'Embedding model (it must already be downloaded; docket never lets MemPalace fetch one)',
      choices: [
        { value: 'minilm', label: 'minilm - all-MiniLM-L6-v2, about 80 MB, in chromadb\'s cache' },
        { value: 'embeddinggemma', label: 'embeddinggemma - in the Hugging Face cache' }
      ],
      fallback: 'minilm'
    })
    const command = await answers.text({
      flag: '--command',
      question: 'The MemPalace MCP server command',
      fallback: 'mempalace-mcp',
      check: checkNonBlank
    })
    return {
      config: {
        ...(palace ? { palace } : {}),
        ...(wing ? { wing } : {}),
        ...unlessDefault('embeddingModel', embeddingModel, 'minilm'),
        ...unlessDefault('command', command, 'mempalace-mcp')
      },
      files: [],
      env: [],
      prerequisites: [
        'pip install mempalace==3.10.0   # the MemPalace it was tested with; docket never installs it',
        embeddingModel === 'minilm'
          ? 'python -c "from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2 as M; M()([\'warm up\'])"   # download the minilm model, in MemPalace\'s Python'
          : 'Download embeddinggemma into the Hugging Face cache; the server runs offline and never fetches it'
      ],
      notes: ['To run the server through Python instead, set command: python3 and args: ["-m", "mempalace.mcp_server"] in the entry.']
    }
  }
}

/**
 * Every provider `docket adapter add` knows, by name. A new adapter package
 * gets one here; a project-local module is configured by hand instead.
 */
export const PROVIDERS: readonly AdapterProvider[] = [jsonl, neo4j, mem0, memvid, mempalace]

export const findProvider = (name: string): AdapterProvider | undefined => PROVIDERS.find((provider) => provider.name === name)
