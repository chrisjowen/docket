import { basename } from 'node:path'

import { Document } from 'yaml'

import { V1_PROJECTION_MODULES } from '../config/config.js'
import type { DockerComposeRuntimeConfig, PullPolicy } from '../runtime/config.js'
import { Answers, checkEnvName, checkNonBlank, checkPort, checkUrl } from './answers.js'

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
    fallback: `${context.id}-dev`,
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
    return { config: { output }, files: [], env: [], notes: [] }
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
      notes: [
        'mem0\'s in-process mode (mode: oss) needs an embedder, vector store and LLM configured; write that entry by hand (see the README).'
      ]
    }
  }
}

/**
 * Every provider `docket adapter add` knows, by name. An adapter package that
 * ships with docket gets one here - mempalace and memvid join when their
 * packages exist; a project-local module is configured by hand instead.
 */
export const PROVIDERS: readonly AdapterProvider[] = [jsonl, neo4j, mem0]

export const findProvider = (name: string): AdapterProvider | undefined => PROVIDERS.find((provider) => provider.name === name)
