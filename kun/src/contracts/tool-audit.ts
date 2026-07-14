import { z } from 'zod'

export const ToolAuditRisk = z.enum(['low', 'medium', 'high', 'critical'])
export type ToolAuditRisk = z.infer<typeof ToolAuditRisk>

export const ToolAuditOutcome = z.enum(['started', 'succeeded', 'failed', 'cancelled', 'blocked'])
export type ToolAuditOutcome = z.infer<typeof ToolAuditOutcome>

export const ToolAuditApprovalSource = z.enum(['none', 'user', 'policy', 'connector', 'runtime'])
export type ToolAuditApprovalSource = z.infer<typeof ToolAuditApprovalSource>

const digest = z.string().regex(/^[a-f0-9]{64}$/)
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) return true
  }
  return false
}

const boundedId = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim() && !hasControlCharacter(value))
const host = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/u)
  .refine((value) => value === value.trim() && !hasControlCharacter(value))
const safeSummary = z.string().max(512).refine((value) => !hasControlCharacter(value))

/**
 * Data that may be written to the tool audit log. Raw arguments, output,
 * tokens, and credentials are intentionally rejected by the strict schema.
 */
export const ToolAuditRecord = z
  .object({
    id: boundedId,
    threadId: boundedId,
    turnId: boundedId.optional(),
    toolName: boundedId,
    risk: ToolAuditRisk,
    approvalSource: ToolAuditApprovalSource,
    outcome: ToolAuditOutcome,
    attempt: z.number().int().min(1).max(99).default(1),
    replayed: z.boolean().default(false),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
    workspaceRootDigest: digest.optional(),
    pathDigest: digest.optional(),
    networkHost: host.optional(),
    summary: safeSummary.optional()
  })
  .strict()
  .superRefine((record, context) => {
    if (record.finishedAt && Date.parse(record.finishedAt) < Date.parse(record.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'finishedAt cannot precede startedAt'
      })
    }
    if (record.outcome === 'started' && record.finishedAt) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'started audit records cannot have finishedAt'
      })
    }
  })
export type ToolAuditRecord = z.infer<typeof ToolAuditRecord>
