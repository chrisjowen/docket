// SPDX-License-Identifier: AGPL-3.0-only
import type { AddressInfo } from 'node:net'

import { perMinute } from '@docket/platform-limits'
import { afterAll, describe, expect, it } from 'vitest'

import { bindMetrics, countRefusal, observeRequest, startMetricsServer } from './metrics'

describe('the metrics endpoint', () => {
  const server = startMetricsServer(0, '127.0.0.1')
  const base = new Promise<string>((resolve) =>
    server.on('listening', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  )
  afterAll(() => server.close())

  it('serves request timings, rate-limit refusals and readiness in the Prometheus text format', async () => {
    bindMetrics({ router: null, ready: () => true })
    observeRequest('GET', '/o/[org]/w/[ws]', 200, 0.12)
    observeRequest('GET', null, 404, 0.01)
    countRefusal({ allowed: false, limit: { scope: 'token', key: 'k', rule: perMinute(120) }, retryAfterSeconds: 1, cached: false })

    const response = await fetch(`${await base}/metrics`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    const text = await response.text()
    expect(text).toContain('docket_http_request_duration_seconds_count{method="GET",route="/o/[org]/w/[ws]",status="200"} 1')
    expect(text).toContain('route="unmatched",status="404"')
    expect(text).toContain('docket_rate_limited_total{scope="token",what="calls"} 1')
    expect(text).toContain('docket_ready 1')
    expect(text).toContain('process_resident_memory_bytes')
  })

  it('answers nothing but GET /metrics', async () => {
    expect((await fetch(`${await base}/`)).status).toBe(404)
    expect((await fetch(`${await base}/metrics`, { method: 'POST' })).status).toBe(404)
  })
})
