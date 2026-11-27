// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'

/** A Kubernetes object, as the API serves it. */
export interface KubeObject {
  apiVersion: string
  kind: string
  metadata: { name: string; namespace?: string; labels?: Record<string, string>; [key: string]: unknown }
  [key: string]: unknown
}

/**
 * The slice of the Kubernetes API the provisioners use. Paths are API paths
 * (`/apis/apps/v1/namespaces/<ns>/statefulsets/<name>`); `kubePath` builds them.
 */
export interface KubeApi {
  /** Creates or updates an object by server-side apply, owned by `docket-cloud`. */
  apply(object: KubeObject): Promise<void>
  /** The object, or null when there is none. */
  get<T extends KubeObject = KubeObject>(path: string): Promise<T | null>
  /** A JSON merge patch. */
  patch(path: string, body: unknown): Promise<void>
  /** Deletes the object; one that is already gone is fine. */
  delete(path: string): Promise<void>
}

export class KubeError extends Error {
  override name = 'KubeError'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const GROUPS: Record<string, { prefix: string; plural: string }> = {
  Secret: { prefix: '/api/v1', plural: 'secrets' },
  Service: { prefix: '/api/v1', plural: 'services' },
  PersistentVolumeClaim: { prefix: '/api/v1', plural: 'persistentvolumeclaims' },
  StatefulSet: { prefix: '/apis/apps/v1', plural: 'statefulsets' },
  NetworkPolicy: { prefix: '/apis/networking.k8s.io/v1', plural: 'networkpolicies' },
  Certificate: { prefix: '/apis/cert-manager.io/v1', plural: 'certificates' },
}

/** The API path of a namespaced object of one of the kinds the provisioners manage. */
export function kubePath(kind: string, namespace: string, name: string): string {
  const group = GROUPS[kind]
  if (!group) throw new Error(`no API path known for kind ${kind}`)
  return `${group.prefix}/namespaces/${encodeURIComponent(namespace)}/${group.plural}/${encodeURIComponent(name)}`
}

const SERVICE_ACCOUNT = '/var/run/secrets/kubernetes.io/serviceaccount'

/**
 * The API server the pod runs under, reached with its service account token
 * and the cluster CA, so the worker needs no kubeconfig and no client library.
 */
export async function inClusterKube(options: { fieldManager?: string } = {}): Promise<KubeApi> {
  const host = process.env.KUBERNETES_SERVICE_HOST
  const port = Number(process.env.KUBERNETES_SERVICE_PORT ?? 443)
  if (!host) throw new Error('not running in a Kubernetes pod: KUBERNETES_SERVICE_HOST is not set')
  const ca = await readFile(`${SERVICE_ACCOUNT}/ca.crt`, 'utf8')
  const fieldManager = options.fieldManager ?? 'docket-cloud'

  const call = async (method: string, path: string, body?: unknown, contentType = 'application/json') => {
    // The projected token rotates; read it for each call.
    const token = (await readFile(`${SERVICE_ACCOUNT}/token`, 'utf8')).trim()
    const payload = body === undefined ? undefined : JSON.stringify(body)
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(
        {
          host,
          port,
          path,
          method,
          ca,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            ...(payload === undefined ? {} : { 'content-type': contentType, 'content-length': Buffer.byteLength(payload) }),
          },
          timeout: 15_000,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
        },
      )
      req.on('timeout', () => req.destroy(new Error(`${method} ${path} timed out`)))
      req.on('error', reject)
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  }

  const failure = (method: string, path: string, response: { status: number; text: string }) => {
    let reason = response.text.slice(0, 300)
    try {
      reason = (JSON.parse(response.text) as { message?: string }).message ?? reason
    } catch {
      // Not JSON: keep the text.
    }
    return new KubeError(response.status, `${method} ${path}: ${response.status} ${reason}`)
  }

  return {
    async apply(object) {
      const namespace = object.metadata.namespace
      if (!namespace) throw new Error(`apply ${object.kind}/${object.metadata.name}: no namespace`)
      const path = `${kubePath(object.kind, namespace, object.metadata.name)}?fieldManager=${fieldManager}&force=true`
      const response = await call('PATCH', path, object, 'application/apply-patch+yaml')
      if (response.status >= 300) throw failure('apply', path, response)
    },
    async get<T extends KubeObject>(path: string) {
      const response = await call('GET', path)
      if (response.status === 404) return null
      if (response.status >= 300) throw failure('GET', path, response)
      return JSON.parse(response.text) as T
    },
    async patch(path, body) {
      const response = await call('PATCH', path, body, 'application/merge-patch+json')
      if (response.status >= 300) throw failure('PATCH', path, response)
    },
    async delete(path) {
      const response = await call('DELETE', path, { propagationPolicy: 'Foreground' })
      if (response.status === 404) return
      if (response.status >= 300) throw failure('DELETE', path, response)
    },
  }
}
