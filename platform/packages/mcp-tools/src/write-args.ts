// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolResult } from '@chrisjowen/docket'
import { writeAnswer as surfaceWriteAnswer } from '@chrisjowen/docket/mcp/surface'

/**
 * What the write tools share (§9, §9.1) is docket's MCP surface: the evidence
 * entry's schema and its parser - a source, which instance of it, the
 * attributes a writer claims and its own locator fields - and how a write's
 * result reads for the model and for a client.
 */
export { EVIDENCE_SCHEMA, WRITE_SCHEMA, optionalText, parseAttributes, parseEvidence, requiredText } from '@chrisjowen/docket/mcp/surface'

/** A write's answer: refused with its diagnostics as a tool error the model can act on, or what it changed. */
export const writeAnswer = (...args: Parameters<typeof surfaceWriteAnswer>): ToolResult => surfaceWriteAnswer(...args) as ToolResult
