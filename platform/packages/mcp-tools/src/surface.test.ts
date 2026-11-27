// SPDX-License-Identifier: AGPL-3.0-only
import { TOOL_DEFINITIONS, surfaceOf } from '@chrisjowen/docket/mcp/surface'
import { describe, expect, it } from 'vitest'

import type { CloudToolContext } from './context.js'
import { cloudTools } from './index.js'

describe('the MCP surface', () => {
  it('is docket’s: every tool, in order, with the same names, input schemas and annotations', () => {
    // Descriptions are each host's own words; everything a client relies on is not.
    const ours = cloudTools({} as CloudToolContext).map((entry) => surfaceOf(entry.tool.definition))
    expect(ours).toEqual(TOOL_DEFINITIONS.map((definition) => surfaceOf(definition)))
  })
})
