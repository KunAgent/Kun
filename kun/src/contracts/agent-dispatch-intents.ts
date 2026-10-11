import { z } from 'zod'
import { ApprovalPolicySchema, ApprovalReviewerSchema, SandboxModeSchema } from './policy.js'
import { ActingTurnModelRouteSchema } from './turn-acting-route.js'

export const AgentDispatchKindSchema = z.enum(['worker', 'workbench'])
export type AgentDispatchKind = z.infer<typeof AgentDispatchKindSchema>
export const AgentDispatchStateSchema = z.enum([
  'pending_confirmation', 'reviewing', 'countdown', 'paused', 'queued', 'starting',
  'uncertain', 'running', 'awaiting_parent', 'completed', 'failed', 'cancelled', 'stopping'
])
export type AgentDispatchState = z.infer<typeof AgentDispatchStateSchema>

export const AgentDispatchPolicySnapshotSchema = z.object({
  approvalPolicy: ApprovalPolicySchema,
  sandboxMode: SandboxModeSchema,
  approvalReviewer: ApprovalReviewerSchema
}).strict()
export type AgentDispatchPolicySnapshot = z.infer<typeof AgentDispatchPolicySnapshotSchema>

export const AgentDispatchSourceSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  toolCallId: z.string().min(1),
  applicationSessionId: z.string().min(1),
  actingModelRoute: ActingTurnModelRouteSchema.optional(),
  userIntent: z.string().max(32_000).optional()
}).strict()
export type AgentDispatchSource = z.infer<typeof AgentDispatchSourceSchema>

export const AgentDispatchRecommendationSchema = z.object({
  title: z.string().min(1).max(512),
  task: z.string().min(1).max(128_000),
  agentId: z.string().min(1).max(512),
  agentName: z.string().max(512).optional(),
  model: z.string().max(512).optional(),
  workspace: z.string().max(4096).optional(),
  acceptanceCriteria: z.array(z.string().max(4096)).max(100).optional(),
  permissionMode: z.enum(['ask-for-approval', 'approve-for-me', 'full-access']),
  effectivePermissionMode: z.enum(['ask-for-approval', 'approve-for-me', 'full-access']).optional(),
  agentSelection: z.enum(['user', 'auto'])
}).strict()
export type AgentDispatchRecommendation = z.infer<typeof AgentDispatchRecommendationSchema>

export const AgentDispatchDecisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  reason: z.string().min(1).max(8192),
  decidedAt: z.string().datetime()
}).strict()
export type AgentDispatchReviewDecision = Omit<z.infer<typeof AgentDispatchDecisionSchema>, 'decidedAt'>

export const AgentDispatchTargetSchema = z.object({
  taskId: z.string().optional(),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  workerIds: z.array(z.string()).optional(),
  dispatchIds: z.array(z.string()).optional()
}).strict()
export type AgentDispatchTarget = z.infer<typeof AgentDispatchTargetSchema>

export const AgentDispatchIntentSchema = z.object({
  intentId: z.string().min(1),
  kind: AgentDispatchKindSchema,
  state: AgentDispatchStateSchema,
  revision: z.number().int().positive(),
  source: AgentDispatchSourceSchema,
  policySnapshot: AgentDispatchPolicySnapshotSchema,
  recommendation: AgentDispatchRecommendationSchema,
  payload: z.record(z.string(), z.unknown()),
  startRequestId: z.string().min(1),
  batchId: z.string().optional(),
  deadline: z.string().datetime().optional(),
  decision: AgentDispatchDecisionSchema.optional(),
  target: AgentDispatchTargetSchema.optional(),
  error: z.string().max(8192).optional(),
  resultSummary: z.string().max(32_000).optional(),
  cancellationRequested: z.boolean().default(false),
  takenOver: z.boolean().default(false),
  takeoverApplied: z.boolean().default(false),
  replacementCount: z.number().int().min(0).max(1).default(0),
  replacementReason: z.string().max(8192).optional(),
  previousTarget: AgentDispatchTargetSchema.optional(),
  requestLedger: z.record(z.string(), z.string()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()
export type AgentDispatchIntent = z.infer<typeof AgentDispatchIntentSchema>

// Only identifiers and card presentation cross HTTP/SSE. Execution payloads and
// the original user excerpt remain host-owned even after a tool result is replayed.
export const AgentDispatchIntentPublicSchema = AgentDispatchIntentSchema.omit({
  payload: true, requestLedger: true
}).extend({ source: AgentDispatchSourceSchema.omit({ userIntent: true }) })
export type AgentDispatchIntentPublic = z.infer<typeof AgentDispatchIntentPublicSchema>

export const AgentDispatchActionSchema = z.object({
  action: z.enum(['start_now', 'pause', 'update', 'resume', 'cancel', 'takeover']),
  expectedRevision: z.number().int().positive(),
  requestId: z.string().min(1).max(256),
  recommendation: AgentDispatchRecommendationSchema.pick({
    title: true, task: true, agentId: true, model: true, workspace: true, acceptanceCriteria: true
  }).partial().optional()
}).strict()
export type AgentDispatchAction = z.infer<typeof AgentDispatchActionSchema>

export const AgentDispatchIntentFileSchema = z.object({
  version: z.literal(1), intents: z.array(AgentDispatchIntentSchema)
}).strict()
export type AgentDispatchIntentFile = z.infer<typeof AgentDispatchIntentFileSchema>

export function publicAgentDispatchIntent(intent: AgentDispatchIntent): AgentDispatchIntentPublic {
  const { payload: _payload, requestLedger: _ledger, source, ...publicIntent } = intent
  const { userIntent: _intent, ...publicSource } = source
  return AgentDispatchIntentPublicSchema.parse({ ...publicIntent, source: publicSource })
}
