// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { kubePath, type KubeObject } from './kube.js'
import { neo4jName, neo4jPodProvisioner } from './neo4j-pod.js'
import { fakeKube } from './testing.js'

const NS = 'docket-cloud'
const CLIENTS = { 'docket.dev/neo4j-client': 'true' }

function setup() {
  const kube = fakeKube()
  const provisioner = neo4jPodProvisioner({
    kube,
    namespace: NS,
    image: 'neo4j:5.26-community',
    storageClass: 'docket-luks',
    storageSize: '2Gi',
    issuer: 'docket-internal-ca',
    clientLabels: CLIENTS,
  })
  return { kube, provisioner }
}

const spec = (object: KubeObject | null | undefined) => (object as { spec: Record<string, unknown> } | null)?.spec

describe('neo4jPodProvisioner', () => {
  it('makes a StatefulSet, PVC, Secret, Service, NetworkPolicy and certificate per org', async () => {
    const { kube, provisioner } = setup()
    const binding = await provisioner.provision({ orgId: 'acme' })
    expect(neo4jName({ orgId: 'acme' })).toBe('neo4j-org-acme')
    expect(binding).toEqual({
      store: 'neo4j',
      target: 'bolt+s://neo4j-org-acme.docket-cloud.svc:7687',
      credentialsSecret: 'neo4j-org-acme',
      created: true,
    })
    expect([...kube.objects.keys()].sort()).toEqual(
      [
        kubePath('Secret', NS, 'neo4j-org-acme'),
        kubePath('Certificate', NS, 'neo4j-org-acme-tls'),
        kubePath('PersistentVolumeClaim', NS, 'neo4j-org-acme-data'),
        kubePath('Service', NS, 'neo4j-org-acme'),
        kubePath('NetworkPolicy', NS, 'neo4j-org-acme'),
        kubePath('StatefulSet', NS, 'neo4j-org-acme'),
      ].sort(),
    )
    const policy = spec(await kube.get(kubePath('NetworkPolicy', NS, 'neo4j-org-acme')))
    expect(policy).toMatchObject({
      podSelector: { matchLabels: { 'docket.dev/org': 'acme' } },
      ingress: [{ from: [{ podSelector: { matchLabels: CLIENTS } }], ports: [{ port: 7687, protocol: 'TCP' }] }],
    })
    const pvc = spec(await kube.get(kubePath('PersistentVolumeClaim', NS, 'neo4j-org-acme-data')))
    expect(pvc).toMatchObject({ storageClassName: 'docket-luks', resources: { requests: { storage: '2Gi' } } })
    const sts = JSON.stringify(await kube.get(kubePath('StatefulSet', NS, 'neo4j-org-acme')))
    // TLS only, at the spec's memory floor.
    expect(sts).toContain('"name":"NEO4J_server_bolt_tls__level","value":"REQUIRED"')
    expect(sts).toContain('"name":"NEO4J_server_memory_heap_max__size","value":"256m"')
    expect(sts).toContain('"name":"NEO4J_server_memory_pagecache_size","value":"256m"')
  })

  it('says when it had to make the volume, so a lost one is rebuilt', async () => {
    const { kube, provisioner } = setup()
    expect((await provisioner.provision({ orgId: 'acme' })).created).toBe(true)
    expect((await provisioner.provision({ orgId: 'acme' })).created).toBe(false)
    await kube.delete(kubePath('PersistentVolumeClaim', NS, 'neo4j-org-acme-data'))
    expect((await provisioner.provision({ orgId: 'acme' })).created).toBe(true)
  })

  it('gives each org its own password and keeps it across re-provisioning', async () => {
    const { provisioner } = setup()
    await provisioner.provision({ orgId: 'acme' })
    await provisioner.provision({ orgId: 'globex' })
    const first = await provisioner.credentials({ orgId: 'acme' })
    await provisioner.provision({ orgId: 'acme' })
    const again = await provisioner.credentials({ orgId: 'acme' })
    const other = await provisioner.credentials({ orgId: 'globex' })
    expect(again).toEqual(first)
    expect(first.password).toHaveLength(32)
    expect(other.password).not.toBe(first.password)
    expect(other.url).toBe('bolt+s://neo4j-org-globex.docket-cloud.svc:7687')
  })

  it('suspends to zero, stays suspended when re-provisioned, and wakes on use', async () => {
    const { kube, provisioner } = setup()
    const path = kubePath('StatefulSet', NS, 'neo4j-org-acme')
    await provisioner.provision({ orgId: 'acme' })
    await provisioner.suspend({ orgId: 'acme' })
    expect(spec(await kube.get(path))).toMatchObject({ replicas: 0 })
    await provisioner.provision({ orgId: 'acme' })
    expect(spec(await kube.get(path))).toMatchObject({ replicas: 0 })
    expect(await provisioner.health({ orgId: 'acme' })).toBe('degraded')

    // The pod reports ready once the StatefulSet has a replica again.
    const waking = provisioner.wake({ orgId: 'acme' }, 10_000)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(spec(await kube.get(path))).toMatchObject({ replicas: 1 })
    await kube.patch(path, { status: { readyReplicas: 1 } })
    await waking
    expect(await provisioner.health({ orgId: 'acme' })).toBe('ok')
  })

  it('shreds exactly the org objects, by name', async () => {
    const { kube, provisioner } = setup()
    await provisioner.provision({ orgId: 'acme' })
    await provisioner.provision({ orgId: 'globex' })
    await provisioner.deprovision({ orgId: 'acme' }, 'shred')
    expect([...kube.objects.keys()].filter((path) => path.includes('org-acme'))).toEqual([])
    expect([...kube.objects.keys()].filter((path) => path.includes('org-globex'))).toHaveLength(6)
    expect(await provisioner.health({ orgId: 'acme' })).toBe('down')
  })

  it('refuses an org id that is not a safe name', async () => {
    const { provisioner } = setup()
    await expect(provisioner.provision({ orgId: 'Acme/../x' })).rejects.toThrow(/lowercase/)
  })

  it("gives a space's own instance (tenancy v2 §5) its own objects, which the org's instance never selects", async () => {
    const { kube, provisioner } = setup()
    await provisioner.provision({ orgId: 'acme' })
    const binding = await provisioner.provision({ orgId: 'acme', storeId: 'st0123456789abcdef' })
    expect(neo4jName({ orgId: 'acme', storeId: 'st0123456789abcdef' })).toBe('neo4j-st0123456789abcdef')
    expect(binding).toEqual({
      store: 'neo4j',
      target: 'bolt+s://neo4j-st0123456789abcdef.docket-cloud.svc:7687',
      credentialsSecret: 'neo4j-st0123456789abcdef',
      created: true,
    })
    const own = kube.objects.get(kubePath('StatefulSet', NS, 'neo4j-st0123456789abcdef'))
    const orgs = kube.objects.get(kubePath('StatefulSet', NS, 'neo4j-org-acme'))
    const ownLabels = (own as unknown as { spec: { template: { metadata: { labels: Record<string, string> } } } }).spec.template.metadata.labels
    expect(ownLabels['docket.dev/store']).toBe('st0123456789abcdef')
    expect(ownLabels['docket.dev/store-org']).toBe('acme')
    expect(ownLabels['docket.dev/org']).toBeUndefined()
    // The org's Service and NetworkPolicy select by `docket.dev/org`, which the space's pod does not carry.
    const orgSelector = (spec(kube.objects.get(kubePath('Service', NS, 'neo4j-org-acme'))) as { selector: Record<string, string> }).selector
    expect(Object.entries(orgSelector).every(([key, value]) => ownLabels[key] === value)).toBe(false)
    expect(spec(own)?.selector).toEqual({ matchLabels: { 'app.kubernetes.io/component': 'neo4j', 'docket.dev/store': 'st0123456789abcdef' } })
    expect(spec(orgs)?.selector).toEqual({ matchLabels: { 'app.kubernetes.io/component': 'neo4j', 'docket.dev/org': 'acme' } })

    await provisioner.deprovision({ orgId: 'acme', storeId: 'st0123456789abcdef' }, 'shred')
    expect([...kube.objects.keys()].filter((path) => path.includes('st0123456789abcdef'))).toEqual([])
    expect([...kube.objects.keys()].filter((path) => path.includes('org-acme'))).toHaveLength(6)
  })

  it('refuses a store id that is not a safe name', async () => {
    const { provisioner } = setup()
    await expect(provisioner.provision({ orgId: 'acme', storeId: 'st../../x' })).rejects.toThrow(/not a store id/)
  })
})
