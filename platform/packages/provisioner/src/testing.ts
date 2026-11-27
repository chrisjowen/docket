// SPDX-License-Identifier: AGPL-3.0-only
import { KubeError, type KubeApi, type KubeObject } from './kube.js'

/** An in-memory Kubernetes API: objects by path, as server-side apply leaves them. */
export interface FakeKube extends KubeApi {
  objects: Map<string, KubeObject>
  calls: string[]
}

const PATHS: Record<string, string> = {
  Secret: '/api/v1/namespaces/{ns}/secrets/{name}',
  Service: '/api/v1/namespaces/{ns}/services/{name}',
  PersistentVolumeClaim: '/api/v1/namespaces/{ns}/persistentvolumeclaims/{name}',
  StatefulSet: '/apis/apps/v1/namespaces/{ns}/statefulsets/{name}',
  NetworkPolicy: '/apis/networking.k8s.io/v1/namespaces/{ns}/networkpolicies/{name}',
  Certificate: '/apis/cert-manager.io/v1/namespaces/{ns}/certificates/{name}',
}

const merge = (target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)
        ? merge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value
  }
  return out
}

export function fakeKube(): FakeKube {
  const objects = new Map<string, KubeObject>()
  const calls: string[] = []
  return {
    objects,
    calls,
    async apply(object) {
      const template = PATHS[object.kind]
      if (!template) throw new KubeError(400, `unknown kind ${object.kind}`)
      const path = template.replace('{ns}', object.metadata.namespace ?? '').replace('{name}', object.metadata.name)
      calls.push(`apply ${object.kind}/${object.metadata.name}`)
      objects.set(path, structuredClone(object))
    },
    async get<T extends KubeObject>(path: string) {
      const found = objects.get(path)
      return found ? (structuredClone(found) as T) : null
    },
    async patch(path, body) {
      const found = objects.get(path)
      if (!found) throw new KubeError(404, `${path} not found`)
      calls.push(`patch ${path}`)
      objects.set(path, merge(found, body as Record<string, unknown>) as KubeObject)
    },
    async delete(path) {
      calls.push(`delete ${path}`)
      objects.delete(path)
    },
  }
}
