// SPDX-License-Identifier: AGPL-3.0-only
import type { OrgAiKeys } from '@docket/platform-ai'
import type { TenantRouter } from '@docket/platform-tenancy'

import { activeOrgs, type Logger } from './outbox.js'

/**
 * Gives every active org its own OpenRouter key with a credit limit equal to
 * its monthly cap, and moves the limit when an owner changes the cap (§11).
 * Without a provisioning key it does nothing, and AI stays off; search works.
 */
export async function ensureOrgKeys(options: { router: TenantRouter; keys: OrgAiKeys; log: Logger }): Promise<void> {
  for (const orgId of await activeOrgs(options.router)) {
    try {
      const outcome = await options.keys.ensure(orgId)
      if (outcome !== 'current') options.log.info(`openrouter: org ${orgId} key ${outcome}`)
    } catch (error) {
      options.log.error(`openrouter: org ${orgId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
