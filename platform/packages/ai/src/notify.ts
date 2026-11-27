// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import type { TenantRouter } from '@docket/platform-tenancy'

import type { CapsDeps } from './caps.js'

/**
 * Tells an org's owners its AI spend passed 80% of the cap (§11): an
 * `ai.cap.warning` event in the org's audit log, which the shell's AI usage
 * meter shows to owners. Written in the transaction that records the warning,
 * so it goes out exactly once.
 */
export function auditCapWarning(router: Pick<TenantRouter, 'enterTenant'>): CapsDeps['notifyOwners'] {
  return async (tx, warning) => {
    await router.enterTenant(tx, warning.orgId)
    await audit(tx, {
      orgId: warning.orgId,
      actor: 'system:ai-caps',
      action: 'ai.cap.warning',
      target: [warning.month],
      args: { spentUsd: warning.spentUsd, capUsd: warning.capUsd },
      outcome: 'ok',
      latencyMs: 0,
      requestId: `ai-cap-${warning.orgId}-${warning.month}`,
    })
  }
}
