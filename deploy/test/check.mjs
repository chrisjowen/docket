#!/usr/bin/env node
// Checks the deployment files without running anything:
//
// - `helm lint --strict` of deploy/helm/docket with each values set in its ci/;
// - `helm template` of each, against its snapshot in deploy/test/snapshots/
//   (`--update` rewrites the snapshots after an intended change);
// - `docker compose config` of deploy/compose with every profile;
// - that the chart, its appVersion and the image Compose runs by default are
//   docket's version, so a release moves them together.
//
//   node deploy/test/check.mjs [--update]
//
// helm and docker are needed; without them a check is skipped, except in CI.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const chart = join(root, 'deploy/helm/docket')
const snapshots = join(here, 'snapshots')
const compose = join(root, 'deploy/compose')
const update = process.argv.includes('--update')
const tenantConfig = join(compose, 'docket-server.example.yaml')
const tenantValues = join(root, 'deploy/helm/multi-tenant-values.yaml')

let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : `\n${detail.replace(/^/gm, '    ')}`}`)
  if (!ok) failures++
}
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
const have = (command) => {
  try {
    run(command, ['version'])
    return true
  } catch {
    if (process.env.CI) throw new Error(`${command} is needed in CI.`)
    console.log(`- ${command} is not installed here: its checks are skipped`)
    return false
  }
}
const failed = (cause) => `${cause.stderr || ''}${cause.stdout || ''}` || String(cause)

// A Secret the chart generates differs on every render: its values are masked.
const GENERATED = /^(\s+(?:password|defaultUserPassword): )[A-Za-z0-9+/=]+$/gm
const normalise = (manifest) => manifest.replace(GENERATED, '$1<generated>').replace(/\n+---\n/g, '\n---\n')

if (have('helm')) {
  for (const values of readdirSync(join(chart, 'ci')).filter((name) => name.endsWith('-values.yaml')).sort()) {
    const name = basename(values, '-values.yaml')
    const file = join(chart, 'ci', values)
    try {
      run('helm', ['lint', '--strict', chart, '-f', file])
      check(true, `helm lint --strict with ci/${values}`)
    } catch (cause) {
      check(false, `helm lint --strict with ci/${values}`, failed(cause))
    }
    let rendered
    try {
      rendered = normalise(run('helm', ['template', 'docket', chart, '--namespace', 'docket', '-f', file]))
    } catch (cause) {
      check(false, `helm template with ci/${values}`, failed(cause))
      continue
    }
    const snapshot = join(snapshots, `${name}.yaml`)
    if (update) {
      mkdirSync(snapshots, { recursive: true })
      writeFileSync(snapshot, rendered)
      console.log(`  wrote ${snapshot}`)
    } else if (!existsSync(snapshot)) {
      check(false, `helm template with ci/${values} has a snapshot`, `no ${snapshot}: run with --update`)
    } else {
      const expected = normalise(readFileSync(snapshot, 'utf8'))
      const at = [...rendered].findIndex((char, index) => char !== expected[index])
      const line = rendered.slice(0, at).split('\n').length
      check(
        rendered === expected,
        `helm template with ci/${values} matches its snapshot`,
        `first difference at line ${line}:\n- ${expected.split('\n')[line - 1] ?? ''}\n+ ${rendered.split('\n')[line - 1] ?? ''}\nrun with --update if the change is intended`
      )
    }
  }
  const fixtureArgs = ['-f', tenantValues, '--set-file', `multiTenant.config=${tenantConfig}`]
  const scratch = mkdtempSync(join(tmpdir(), 'docket-chart-'))
  const managed = join(scratch, 'docket-server.yaml')
  const bundledConfig = readFileSync(tenantConfig, 'utf8')
  const managedConfig = bundledConfig
    .replace(/    provisioning: bundled\n    tls: false/, '    provisioning: external')
    .replace(/  graph:\n[\s\S]+?(?=  search:\n)/,
      '  graph:\n    type: neo4j\n    provisioning: managed\n    driver: kubernetes\n    kubernetes: { namespace: docket, issuer: example-ca }\n')
    .replace('accounts: 1', 'accounts: 10')
  writeFileSync(managed, managedConfig)
  try {
    run('helm', ['lint', '--strict', chart, ...fixtureArgs])
    check(true, 'helm lint for tenant mode')
    const inline = run('helm', ['template', 'docket', chart, '--namespace', 'docket', ...fixtureArgs])
    check(inline.includes('args: [serve, --config, /etc/docket/docket-server.yaml]') && !inline.includes('kind: RoleBinding'),
      'Helm starts one unprivileged tenant server with its worker inline')
    check(inline.includes(bundledConfig.trimEnd().split('\n').map(line => `    ${line}`).join('\n')),
      'Helm mounts the exact config file used by Compose')
    const split = run('helm', ['template', 'docket', chart, '--namespace', 'docket', ...fixtureArgs,
      '--set', 'multiTenant.worker.enabled=true,multiTenant.worker.tlsSecret=query-tls'])
    check(split.includes('args: [serve, worker, --config, /etc/docket/docket-server.yaml]') && split.includes('https://docket-worker:8443'),
      'Helm can split out the worker and route queries over TLS')
    const managedArgs = ['template', 'docket', chart, '--namespace', 'docket', '-f', tenantValues,
      '--set-file', `multiTenant.config=${managed}`,
      '--set', 'multiTenant.managedGraph=true,neo4j.enabled=false,postgres.bundled.enabled=false,multiTenant.postgresSecret=external-pg']
    const provisioner = run('helm', managedArgs)
    check(provisioner.includes('kind: RoleBinding') && provisioner.includes('docket.dev/neo4j-client: "true"') &&
        provisioner.includes('name: external-pg, key: migrationUrl') && !provisioner.includes('name: bootstrap-postgres'),
      'Helm opts into namespaced graph provisioning and an external Postgres')
    writeFileSync(managed, `${managedConfig}\nworker: { mode: off }\n`)
    const apiOnly = run('helm', managedArgs)
    check(!apiOnly.includes('automountServiceAccountToken: true') && apiOnly.includes('worker: { mode: off }'),
      'Helm passes through worker.mode: off and leaves the API pod without provisioning credentials')
    try {
      run('helm', ['template', 'docket', chart, '--namespace', 'docket', '-f', tenantValues, '--set-file', `multiTenant.config=${managed}`])
      check(false, 'Helm requires explicit provisioner opt-in')
    } catch (cause) {
      check(failed(cause).includes('requires multiTenant.managedGraph=true'), 'Helm requires explicit provisioner opt-in', failed(cause))
    }
  } catch (cause) {
    check(false, 'Helm renders the multi-tenant variants', failed(cause))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (have('docker')) {
  for (const profiles of ['', 'postgres', 'postgres,graph,semantic,cognee']) {
    try {
      run('docker', ['compose', '--project-directory', compose, '-f', join(compose, 'compose.yaml'), '--env-file', '/dev/null', 'config', '--quiet'], {
        env: { ...process.env, COMPOSE_PROFILES: profiles }
      })
      check(true, `docker compose config with ${profiles ? `the ${profiles} profiles` : 'no profile'}`)
    } catch (cause) {
      check(false, `docker compose config with ${profiles || 'no profile'}`, failed(cause))
    }
  }
  try {
    const composeArgs = ['compose', '--project-directory', compose, '--env-file', '/dev/null',
      '-f', join(compose, 'compose.multi-tenant.yaml')]
    run('docker', [...composeArgs, 'config', '--quiet'], { env: { ...process.env, COMPOSE_PROFILES: 'postgres,graph,semantic' } })
    run('docker', [...composeArgs, '-f', join(compose, 'compose.worker.yaml'), '--profile', 'split-worker', 'config', '--quiet'],
      { env: { ...process.env, COMPOSE_PROFILES: 'postgres,graph,semantic' } })
    check(true, 'docker compose config with the multi-tenant server, inline and split')
  } catch (cause) {
    check(false, 'docker compose config with the multi-tenant server', failed(cause))
  }
}

const version = JSON.parse(readFileSync(join(root, 'packages/docket/package.json'), 'utf8')).version
const chartYaml = readFileSync(join(chart, 'Chart.yaml'), 'utf8')
check(chartYaml.match(/^version: (.+)$/m)?.[1] === version, `the chart's version is docket's, ${version}`)
check(chartYaml.match(/^appVersion: "(.+)"$/m)?.[1] === version, `the chart's appVersion is docket's, ${version}`)
const composeYaml = ['compose.yaml', 'compose.multi-tenant.yaml'].map(file => readFileSync(join(compose, file), 'utf8')).join('\n')
const tags = [...composeYaml.matchAll(/\$\{DOCKET_IMAGE:-ghcr\.io\/chrisjowen\/docket:([^}]+)\}/g)].map((match) => match[1])
check(tags.length > 0 && tags.every((tag) => tag === version), `Compose runs ghcr.io/chrisjowen/docket:${version} by default`, `found ${tags.join(', ')}`)
const example = readFileSync(join(compose, '.env.example'), 'utf8').match(/DOCKET_IMAGE=ghcr\.io\/chrisjowen\/docket:(\S+)/)?.[1]
check(example === version, `.env.example names ghcr.io/chrisjowen/docket:${version}`, `found ${example}`)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
