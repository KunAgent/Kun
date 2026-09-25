import { z } from 'zod'

export const ApprovalActionKindSchema = z.enum([
  'command',
  'file',
  'network',
  'mcp',
  'external-effect',
  'unknown'
])
export type ApprovalActionKind = z.infer<typeof ApprovalActionKindSchema>

export const ApprovalActionTargetSchema = z.object({
  kind: z.enum(['command', 'file', 'url', 'mcp', 'recipient', 'resource']),
  value: z.string().min(1).max(2_048)
}).strict()
export type ApprovalActionTarget = z.infer<typeof ApprovalActionTargetSchema>

/**
 * Bounded, host-authored data that is safe to persist and send to the
 * automatic reviewer. The runtime constructs this object; callers cannot
 * provide credentials or an unbounded transcript through it.
 */
export const ApprovalActionEnvelopeSchema = z.object({
  version: z.literal(1),
  kind: ApprovalActionKindSchema,
  toolName: z.string().min(1).max(256),
  providerId: z.string().min(1).max(256).optional(),
  providerKind: z.enum([
    'built-in',
    'mcp',
    'web',
    'skill',
    'memory',
    'gui',
    'delegation',
    'image',
    'audio',
    'video',
    'extension'
  ]).optional(),
  toolKind: z.enum(['tool_call', 'command_execution', 'file_change']).optional(),
  effects: z.object({
    network: z.boolean(),
    externalWrite: z.boolean(),
    processExecution: z.boolean(),
    guiAutomation: z.boolean()
  }).strict(),
  arguments: z.record(z.string(), z.unknown()),
  workspace: z.string().min(1).max(4_096),
  cwd: z.string().min(1).max(4_096).optional(),
  targets: z.array(ApprovalActionTargetSchema).max(16),
  reason: z.string().min(1).max(2_048),
  /**
   * The action may only be authorized by a human. Full-access auto-allow,
   * configured hooks, and the automatic agent reviewer must not decide it
   * (for example promoting content into a standing user directive).
   */
  requiresUserDecision: z.boolean().optional()
}).strict()
export type ApprovalActionEnvelope = z.infer<typeof ApprovalActionEnvelopeSchema>

export const ApprovalReviewDecisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  rationale: z.string().trim().min(1).max(2_048)
}).strict()
export type ApprovalReviewDecision = z.infer<typeof ApprovalReviewDecisionSchema>

export const ApprovalReviewTerminalStatusSchema = z.enum([
  'approved',
  'denied',
  'timed-out',
  'failed-closed',
  'aborted'
])
export type ApprovalReviewTerminalStatus = z.infer<typeof ApprovalReviewTerminalStatusSchema>

export const ApprovalDecisionRequest = z.object({
  decision: z.enum(['allow', 'deny']),
  /** Optional human-readable reason stored alongside the resolution. */
  reason: z.string().trim().max(4096).optional().transform((value) => value || undefined)
})
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>

export const ApprovalDecisionResponse = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
  status: z.enum(['allowed', 'denied', 'expired']),
  alreadyResolved: z.boolean().optional()
})
export type ApprovalDecisionResponse = z.infer<typeof ApprovalDecisionResponse>
