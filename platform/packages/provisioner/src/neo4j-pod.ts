// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'

import { orgSchema, type OrgRef } from '@docket/platform-tenancy'

import { kubePath, type KubeApi, type KubeObject } from './kube.js'
import type { StoreBinding, StoreHealth, TenantProvisioner } from './port.js'

/**
 * Option A of §5.2: one Neo4j Community pod per org, with its own password,
 * volume, TLS certificate and NetworkPolicy, made through the Kubernetes API.
 * Community holds one database per installation, so a pod per org is what
 * gives each org a database of its own; workspaces inside it are separated by
 * docket's `scope` (§4).
 */
export interface Neo4jPodOptions {
  kube: KubeApi
  /** Where the pods run: the release namespace, beside the internal CA issuer. */
  namespace: string
  /** For example `neo4j:5.26-community`. */
  image: string
  storageClass: string
  /** For example `2Gi`. */
  storageSize: string
  /** The cert-manager Issuer that signs the pod's bolt certificate (`docket-internal-ca`). */
  issuer: string
  /** Labels on the pods allowed to connect (the API and the worker). */
  clientLabels: Record<string, string>
  /**
   * The prefix of the label naming each pod's org (`<labelDomain>/org`): a DNS name the
   * installation controls. Default `docket.dev`; an existing install keeps the one its pods carry.
   */
  labelDomain?: string
  /** Heap and page cache, each; the spec's floor is 256m (§15.1). */
  memory?: { heap: string; pageCache: string; request: string; limit: string }
}

/**
 * Which Neo4j instance: the org's own (`storeId` absent), or one of the org's
 * other instances - a space's own (tenancy v2 §5) - by its store id.
 */
export interface Neo4jRef extends OrgRef {
  storeId?: string
}

/** What a client needs to reach an org's Neo4j: its URL and password. Never logged. */
export interface Neo4jCredentials {
  url: string
  username: string
  password: string
}

export interface Neo4jPodProvisioner extends TenantProvisioner {
  provision(org: Neo4jRef): Promise<StoreBinding>
  bind(org: Neo4jRef): Promise<StoreBinding>
  suspend(org: Neo4jRef): Promise<void>
  deprovision(org: Neo4jRef, mode: 'soft' | 'shred'): Promise<void>
  health(org: Neo4jRef): Promise<StoreHealth>
  /** The instance's URL and password, read from its Secret. */
  credentials(org: Neo4jRef): Promise<Neo4jCredentials>
  /** Scales a suspended pod back up and waits until it accepts connections. */
  wake(org: Neo4jRef, timeoutMs?: number): Promise<void>
}

export class Neo4jProvisionError extends Error {
  override name = 'Neo4jProvisionError'
}

/** A store id: `st` and lowercase letters and digits (platform 0019), so a name made from it is a valid DNS label. */
const STORE_ID = /^st[a-z0-9]{8,30}$/

/**
 * The name every object of a Neo4j instance shares: `neo4j-org-<id>` for the
 * org's own, `neo4j-<store id>` for another of its instances.
 */
export function neo4jName(org: Neo4jRef): string {
  if (org.storeId !== undefined) {
    if (!STORE_ID.test(org.storeId)) throw new Neo4jProvisionError(`not a store id: ${org.storeId}`)
    // Checked like an org id below: the org must be one, though the name does not carry it.
    orgSchema(org.orgId)
    return `neo4j-${org.storeId}`
  }
  // orgSchema checks the id: lowercase letters and digits only, so the name is a valid DNS label.
  return `neo4j-${orgSchema(org.orgId).replace('_', '-')}`
}

/**
 * The spec's floor (§15.1): 256 MB heap and 256 MB page cache. The pod peaked at
 * 858 MiB rebuilding a 10k-document workspace (docs/spikes/neo4j-per-org.md).
 */
const DEFAULT_LABEL_DOMAIN = 'docket.dev'
const DEFAULT_MEMORY = { heap: '256m', pageCache: '256m', request: '768Mi', limit: '1Gi' }

type StatefulSet = KubeObject & {
  spec?: { replicas?: number }
  status?: { readyReplicas?: number; replicas?: number }
}
type Secret = KubeObject & { data?: Record<string, string> }

const decode = (value: string | undefined): string => Buffer.from(value ?? '', 'base64').toString('utf8')
const describe = (org: Neo4jRef) => (org.storeId === undefined ? `org ${org.orgId}` : `org ${org.orgId}'s store ${org.storeId}`)

export function neo4jPodProvisioner(options: Neo4jPodOptions): Neo4jPodProvisioner {
  const { kube, namespace } = options
  const memory = options.memory ?? DEFAULT_MEMORY
  const orgLabel = `${options.labelDomain ?? DEFAULT_LABEL_DOMAIN}/org`
  // Another instance of the org's carries its store and its org under other keys: the org's own
  // instance selects its pod by `<domain>/org`, and must never select this one's.
  const storeLabel = `${options.labelDomain ?? DEFAULT_LABEL_DOMAIN}/store`
  const storeOrgLabel = `${options.labelDomain ?? DEFAULT_LABEL_DOMAIN}/store-org`

  const names = (org: Neo4jRef) => {
    const name = neo4jName(org)
    return {
      name,
      secret: name,
      tls: `${name}-tls`,
      pvc: `${name}-data`,
      host: `${name}.${namespace}.svc`,
    }
  }
  const owner = (org: Neo4jRef): Record<string, string> =>
    org.storeId === undefined ? { [orgLabel]: org.orgId } : { [storeLabel]: org.storeId, [storeOrgLabel]: org.orgId }
  const labels = (org: Neo4jRef) => ({
    'app.kubernetes.io/name': 'docket-cloud',
    'app.kubernetes.io/component': 'neo4j',
    'app.kubernetes.io/managed-by': 'docket-cloud-worker',
    ...owner(org),
  })
  const selector = (org: Neo4jRef) =>
    org.storeId === undefined
      ? { 'app.kubernetes.io/component': 'neo4j', [orgLabel]: org.orgId }
      : { 'app.kubernetes.io/component': 'neo4j', [storeLabel]: org.storeId }
  const metadata = (org: Neo4jRef, name: string) => ({ name, namespace, labels: labels(org) })

  async function ensureSecret(org: Neo4jRef): Promise<void> {
    const { secret } = names(org)
    if (await kube.get(kubePath('Secret', namespace, secret))) return
    // Made once and never rotated by a re-provision: the pod's data volume is initialised with it.
    const password = randomBytes(24).toString('base64url')
    await kube.apply({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: metadata(org, secret),
      type: 'Opaque',
      data: {
        username: Buffer.from('neo4j').toString('base64'),
        password: Buffer.from(password).toString('base64'),
        NEO4J_AUTH: Buffer.from(`neo4j/${password}`).toString('base64'),
      },
    })
  }

  function objects(org: Neo4jRef, replicas: number): KubeObject[] {
    const n = names(org)
    const certificate: KubeObject = {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      metadata: metadata(org, n.tls),
      spec: {
        secretName: n.tls,
        dnsNames: [n.name, `${n.name}.${namespace}`, n.host, `${n.host}.cluster.local`],
        // Neo4j reads PKCS#8 keys.
        privateKey: { algorithm: 'RSA', size: 2048, encoding: 'PKCS8', rotationPolicy: 'Always' },
        issuerRef: { kind: 'Issuer', name: options.issuer },
      },
    }
    const pvc: KubeObject = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: metadata(org, n.pvc),
      spec: {
        accessModes: ['ReadWriteOnce'],
        ...(options.storageClass ? { storageClassName: options.storageClass } : {}),
        resources: { requests: { storage: options.storageSize } },
      },
    }
    const service: KubeObject = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: metadata(org, n.name),
      spec: {
        selector: selector(org),
        ports: [{ name: 'bolt', port: 7687, targetPort: 'bolt', protocol: 'TCP' }],
      },
    }
    const policy: KubeObject = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: metadata(org, n.name),
      spec: {
        podSelector: { matchLabels: selector(org) },
        policyTypes: ['Ingress'],
        // Only the API and the worker reach it, and only over bolt (§7.1).
        ingress: [{ from: [{ podSelector: { matchLabels: options.clientLabels } }], ports: [{ port: 7687, protocol: 'TCP' }] }],
      },
    }
    const statefulSet: KubeObject = {
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: metadata(org, n.name),
      spec: {
        replicas,
        serviceName: n.name,
        selector: { matchLabels: selector(org) },
        template: {
          metadata: { labels: labels(org) },
          spec: {
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 7474,
              runAsGroup: 7474,
              fsGroup: 7474,
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [
              {
                name: 'neo4j',
                image: options.image,
                imagePullPolicy: 'IfNotPresent',
                ports: [{ name: 'bolt', containerPort: 7687 }],
                env: [
                  { name: 'NEO4J_AUTH', valueFrom: { secretKeyRef: { name: n.secret, key: 'NEO4J_AUTH' } } },
                  { name: 'NEO4J_server_memory_heap_initial__size', value: memory.heap },
                  { name: 'NEO4J_server_memory_heap_max__size', value: memory.heap },
                  { name: 'NEO4J_server_memory_pagecache_size', value: memory.pageCache },
                  // Bolt only, and only over TLS with the internal CA's certificate (§7.1).
                  { name: 'NEO4J_server_http_enabled', value: 'false' },
                  { name: 'NEO4J_server_bolt_listen__address', value: '0.0.0.0:7687' },
                  { name: 'NEO4J_server_bolt_tls__level', value: 'REQUIRED' },
                  { name: 'NEO4J_dbms_ssl_policy_bolt_enabled', value: 'true' },
                  { name: 'NEO4J_dbms_ssl_policy_bolt_base__directory', value: '/ssl/bolt' },
                  { name: 'NEO4J_dbms_ssl_policy_bolt_private__key', value: 'tls.key' },
                  { name: 'NEO4J_dbms_ssl_policy_bolt_public__certificate', value: 'tls.crt' },
                  { name: 'NEO4J_dbms_ssl_policy_bolt_trusted__dir', value: '/ssl/bolt/trusted' },
                  { name: 'NEO4J_dbms_ssl_policy_bolt_revoked__dir', value: '/ssl/revoked' },
                  { name: 'NEO4J_dbms_ssl_policy_bolt_client__auth', value: 'NONE' },
                  { name: 'NEO4J_dbms_usage__report_enabled', value: 'false' },
                ],
                volumeMounts: [
                  { name: 'data', mountPath: '/data' },
                  { name: 'logs', mountPath: '/logs' },
                  { name: 'tls', mountPath: '/ssl/bolt', readOnly: true },
                  { name: 'revoked', mountPath: '/ssl/revoked' },
                ],
                startupProbe: { tcpSocket: { port: 'bolt' }, periodSeconds: 3, failureThreshold: 60 },
                readinessProbe: { tcpSocket: { port: 'bolt' }, periodSeconds: 5 },
                livenessProbe: { tcpSocket: { port: 'bolt' }, periodSeconds: 20, failureThreshold: 6 },
                resources: { requests: { cpu: '50m', memory: memory.request }, limits: { memory: memory.limit } },
                securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
              },
            ],
            volumes: [
              { name: 'data', persistentVolumeClaim: { claimName: n.pvc } },
              { name: 'logs', emptyDir: { sizeLimit: '256Mi' } },
              { name: 'revoked', emptyDir: { sizeLimit: '1Mi' } },
              {
                name: 'tls',
                secret: {
                  secretName: n.tls,
                  defaultMode: 0o440,
                  items: [
                    { key: 'tls.key', path: 'tls.key' },
                    { key: 'tls.crt', path: 'tls.crt' },
                    { key: 'ca.crt', path: 'trusted/ca.crt' },
                  ],
                },
              },
            ],
          },
        },
      },
    }
    return [certificate, pvc, service, policy, statefulSet]
  }

  const statefulSet = (org: Neo4jRef) => kube.get<StatefulSet>(kubePath('StatefulSet', namespace, names(org).name))
  const scale = (org: Neo4jRef, replicas: number) =>
    kube.patch(kubePath('StatefulSet', namespace, names(org).name), { spec: { replicas } })

  const provisioner: Neo4jPodProvisioner = {
    async provision(org) {
      await ensureSecret(org)
      // A suspended org stays suspended through a re-provision; it wakes on first use.
      const current = await statefulSet(org)
      const replicas = current?.spec?.replicas ?? 1
      const hadVolume = (await kube.get(kubePath('PersistentVolumeClaim', namespace, names(org).pvc))) !== null
      for (const object of objects(org, replicas)) await kube.apply(object)
      return { ...(await provisioner.bind(org)), created: !hadVolume }
    },

    async bind(org): Promise<StoreBinding> {
      const n = names(org)
      return { store: 'neo4j', target: `bolt+s://${n.host}:7687`, credentialsSecret: n.secret }
    },

    async credentials(org) {
      const n = names(org)
      const secret = await kube.get<Secret>(kubePath('Secret', namespace, n.secret))
      if (!secret?.data?.password) throw new Neo4jProvisionError(`${describe(org)} has no Neo4j credentials yet`)
      return { url: `bolt+s://${n.host}:7687`, username: decode(secret.data.username) || 'neo4j', password: decode(secret.data.password) }
    },

    suspend: (org) => scale(org, 0),

    async wake(org, timeoutMs = 120_000) {
      const current = await statefulSet(org)
      if (!current) throw new Neo4jProvisionError(`${describe(org)} has no Neo4j pod`)
      if ((current.spec?.replicas ?? 0) < 1) await scale(org, 1)
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const state = await statefulSet(org)
        if ((state?.status?.readyReplicas ?? 0) >= 1) return
        if (Date.now() > deadline) throw new Neo4jProvisionError(`${describe(org)}'s Neo4j pod is not ready after ${timeoutMs / 1000}s`)
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
    },

    async deprovision(org, mode) {
      if (mode === 'soft') return scale(org, 0)
      const n = names(org)
      // Each object by its exact name: never a selector or a pattern.
      await kube.delete(kubePath('StatefulSet', namespace, n.name))
      await kube.delete(kubePath('Service', namespace, n.name))
      await kube.delete(kubePath('NetworkPolicy', namespace, n.name))
      await kube.delete(kubePath('Certificate', namespace, n.tls))
      await kube.delete(kubePath('Secret', namespace, n.tls))
      await kube.delete(kubePath('Secret', namespace, n.secret))
      await kube.delete(kubePath('PersistentVolumeClaim', namespace, n.pvc))
    },

    async health(org): Promise<StoreHealth> {
      const state = await statefulSet(org)
      if (!state) return 'down'
      if ((state.status?.readyReplicas ?? 0) >= 1) return 'ok'
      // Suspended, starting, or crashing: the UI shows the index as waking or behind.
      return 'degraded'
    },
  }
  return provisioner
}
