import { z } from 'zod'
import { ModelReasoningEffort, SubagentToolPolicy } from './capabilities.js'
import { HarnessCredentialModeSchema, HarnessIdSchema } from './harness.js'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  DEFAULT_APPROVAL_REVIEWER,
  SandboxModeSchema
} from './policy.js'
import { GraphRelativePathSchema } from './graph-path.js'
import {
  GraphBudgetLedgerV1Schema,
  GraphBudgetV1InputSchema,
  GraphBudgetV1Schema
} from './graph-budget.js'
import {
  GraphAttemptStatusSchema,
  GraphControlIntentSchema,
  GraphExecutionStrategyV1Schema,
  GraphNodeStatusSchema,
  GraphReviewOutcomeSchema,
  GraphRiskClassSchema,
  GraphRunStatusSchema
} from './graph-status.js'
import {
  GraphAttemptIdSchema,
  GraphBoundedSummarySchema,
  GraphCommandIdSchema,
  GraphEdgeIdSchema,
  GraphIdentifierSchema,
  GraphIdempotencyKeySchema,
  GraphMessageIdSchema,
  GraphNodeIdSchema,
  GraphProfileIdSchema,
  GraphReviewIdSchema,
  GraphRunIdSchema,
  GraphTimestampSchema,
  GraphToolProviderIdSchema
} from './graph-contract-primitives.js'
import { GraphArtifactReferenceV1Schema, GraphCheckResultV1Schema, GraphVerifiedCheckResultV1Schema, type GraphArtifactReferenceV1, type GraphCheckResultV1, type GraphVerifiedCheckResultV1 } from './graph-contract-artifacts.js'
export * from './graph-contract-primitives.js'
export * from './graph-contract-artifacts.js'
export {
  GraphBudgetLedgerV1Schema,
  GraphBudgetV1InputSchema,
  GraphBudgetV1Schema,
  type GraphBudgetLedgerV1,
  type GraphBudgetV1
} from './graph-budget.js'

export const GRAPH_CONTRACT_VERSION = 1 as const
export const GRAPH_EVENT_VERSION = 1 as const

const BoundedText = z.string().max(32_768)
const RelativePath = GraphRelativePathSchema

const Identifier = GraphIdentifierSchema
const IdempotencyKey = GraphIdempotencyKeySchema
const Timestamp = GraphTimestampSchema
const BoundedSummary = GraphBoundedSummarySchema

export const GraphWorkerResultV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  summary: BoundedSummary,
  artifactRefs: z.array(GraphArtifactReferenceV1Schema).max(128).default([]),
  changedFiles: z.array(RelativePath).max(1_000).default([]),
  /** Legacy persisted worker reports. New results use reportedChecks. */
  checks: z.array(GraphCheckResultV1Schema).max(128).optional(),
  reportedChecks: z.array(GraphCheckResultV1Schema).max(128).optional(),
  verifiedChecks: z.array(GraphVerifiedCheckResultV1Schema).max(128).optional(),
  evidence: z.array(BoundedSummary).max(128).default([]),
  risks: z.array(BoundedSummary).max(64).default([]),
  suggestedMessages: z.array(z.object({
    recipientNodeId: GraphNodeIdSchema.optional(),
    type: z.enum(['handoff', 'finding', 'question', 'answer', 'warning']),
    summary: BoundedSummary,
    artifactRefs: z.array(GraphArtifactReferenceV1Schema).max(16).default([])
  }).strict()).max(64).default([])
}).strict()
export type GraphWorkerResultV1 = z.infer<typeof GraphWorkerResultV1Schema>

export const GraphValidationIssueV1Schema = z.object({
  code: z.string().trim().min(1).max(128),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(32).default([]),
  message: z.string().min(1).max(2_048),
  severity: z.enum(['error', 'warning'])
}).strict()
export type GraphValidationIssueV1 = z.infer<typeof GraphValidationIssueV1Schema>

export const GraphValidationResultV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  valid: z.boolean(),
  issues: z.array(GraphValidationIssueV1Schema).max(512),
  normalizedNodeCount: z.number().int().nonnegative(),
  normalizedEdgeCount: z.number().int().nonnegative()
}).strict()
export type GraphValidationResultV1 = z.infer<typeof GraphValidationResultV1Schema>

export const GraphReviewResultV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  reviewId: GraphReviewIdSchema,
  nodeId: GraphNodeIdSchema,
  attemptId: GraphAttemptIdSchema,
  reviewerKind: z.enum(['deterministic', 'peer', 'lead', 'human']),
  reviewerInstanceId: Identifier.optional(),
  outcome: GraphReviewOutcomeSchema,
  summary: BoundedSummary,
  evidence: z.array(BoundedSummary).max(128).default([]),
  artifactRefs: z.array(GraphArtifactReferenceV1Schema).max(64).default([]),
  repairInstructions: BoundedText.optional(),
  createdAt: Timestamp
}).strict()
export type GraphReviewResultV1 = z.infer<typeof GraphReviewResultV1Schema>

export const GraphLeadDecisionV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  decisionId: Identifier,
  commandId: GraphCommandIdSchema,
  runId: GraphRunIdSchema,
  action: z.enum([
    'accept',
    'request_repair',
    'retry',
    'rebind',
    'pause',
    'resume',
    'cancel',
    'patch',
    'request_human',
    'finalize'
  ]),
  reason: BoundedText,
  targetNodeId: GraphNodeIdSchema.optional(),
  expectedRevision: z.number().int().positive(),
  createdAt: Timestamp
}).strict()
export type GraphLeadDecisionV1 = z.infer<typeof GraphLeadDecisionV1Schema>

export const GraphHelpRequestV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  requestId: Identifier,
  nodeId: GraphNodeIdSchema,
  attemptId: GraphAttemptIdSchema,
  reason: BoundedText,
  blocking: z.boolean(),
  artifactRefs: z.array(GraphArtifactReferenceV1Schema).max(32).default([]),
  createdAt: Timestamp
}).strict()
export type GraphHelpRequestV1 = z.infer<typeof GraphHelpRequestV1Schema>

export const GraphProgressUpdateV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  nodeId: GraphNodeIdSchema,
  attemptId: GraphAttemptIdSchema,
  percent: z.number().min(0).max(100).optional(),
  summary: BoundedSummary,
  phase: z.string().trim().min(1).max(128).optional(),
  createdAt: Timestamp
}).strict()
export type GraphProgressUpdateV1 = z.infer<typeof GraphProgressUpdateV1Schema>

const GraphLoopGateV1CompatibilitySchema = z.object({
  maxIterations: z.number().int().positive().max(1_000),
  condition: z.object({
    sourceNodeId: GraphNodeIdSchema,
    outcomeIn: z.array(z.enum([
      'accepted',
      'repair_required',
      'failed',
      'skipped'
    ])).min(1).max(8)
  }).strict(),
  continueTargetNodeId: GraphNodeIdSchema,
  exitTargetNodeId: GraphNodeIdSchema,
  exhaustionTargetNodeId: GraphNodeIdSchema.optional(),
  maxTokenBudget: z.number().int().positive().optional()
}).strict()
export const GraphLoopGateV1Schema = GraphLoopGateV1CompatibilitySchema.transform((gate) => {
  const { maxTokenBudget, ...activeGate } = gate
  return (void maxTokenBudget, activeGate)
})
export type GraphLoopGateV1 = z.infer<typeof GraphLoopGateV1Schema>

export const GraphAssignmentReferenceV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    profileId: GraphProfileIdSchema,
    profileVersion: z.number().int().positive().optional()
  }).strict(),
  z.object({
    kind: z.literal('ephemeral'),
    name: z.string().trim().min(1).max(128),
    description: z.string().max(1_024).optional(),
    systemPrompt: BoundedText,
    model: z.string().trim().min(1).max(256).optional(),
    providerId: z.string().trim().min(1).max(128).optional(),
    harnessId: HarnessIdSchema.optional(),
    credentialMode: HarnessCredentialModeSchema.optional(),
    reasoningEffort: ModelReasoningEffort.optional(),
    toolPolicy: SubagentToolPolicy.default('readOnly'),
    allowedTools: z.array(Identifier).max(256).optional(),
    blockedTools: z.array(Identifier).max(256).default([]),
    allowedSkills: z.array(Identifier).max(256).optional(),
    blockedSkills: z.array(Identifier).max(256).default([]),
    allowedMcpServers: z.array(Identifier).max(128).optional(),
    blockedMcpServers: z.array(Identifier).max(128).default([])
  }).strict()
])
export type GraphAssignmentReferenceV1 = z.infer<typeof GraphAssignmentReferenceV1Schema>

const GraphAssignmentSnapshotV1CompatibilitySchema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  profileId: GraphProfileIdSchema,
  profileVersion: z.number().int().positive(),
  profileOrigin: z.enum(['builtin', 'user', 'ephemeral', 'learned']),
  requestedProfileId: GraphProfileIdSchema.optional(),
  requestedProfileVersion: z.number().int().positive().optional(),
  routingReason: BoundedSummary.optional(),
  name: z.string().trim().min(1).max(128),
  systemPrompt: BoundedText,
  model: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(128),
  accountId: z.string().trim().min(1).max(256).optional(),
  harnessId: HarnessIdSchema.optional(),
  credentialMode: HarnessCredentialModeSchema.optional(),
  allowedModelProviderIds: z.array(Identifier).min(1).max(128),
  allowedModels: z.array(z.string().trim().min(1).max(256)).min(1).max(256),
  allowedProviderIds: z.array(GraphToolProviderIdSchema).max(128),
  reasoningEffort: ModelReasoningEffort,
  toolPolicy: SubagentToolPolicy,
  allowedTools: z.array(Identifier).max(256),
  blockedTools: z.array(Identifier).max(256),
  allowedSkills: z.array(Identifier).max(256),
  blockedSkills: z.array(Identifier).max(256),
  allowedMcpServers: z.array(Identifier).max(128),
  blockedMcpServers: z.array(Identifier).max(128),
  approvalPolicy: ApprovalPolicySchema,
  sandboxMode: SandboxModeSchema,
  approvalReviewer: ApprovalReviewerSchema.default(DEFAULT_APPROVAL_REVIEWER),
  workspaceRoot: z.string().min(1).max(4_096),
  readScopes: z.array(RelativePath).max(1_000),
  writeScopes: z.array(RelativePath).max(1_000),
  networkAllowed: z.boolean(),
  maxWallTimeMs: z.number().int().positive(),
  maxTokens: z.number().int().positive().optional(),
  capturedAt: Timestamp
}).strict()
export const GraphAssignmentSnapshotV1Schema =
  GraphAssignmentSnapshotV1CompatibilitySchema.transform((assignment) => {
    const { maxTokens, ...activeAssignment } = assignment
    return (void maxTokens, activeAssignment)
  })
export type GraphAssignmentSnapshotV1 = z.infer<typeof GraphAssignmentSnapshotV1Schema>

export const GraphReviewPolicyV1Schema = z.object({
  kinds: z.array(z.enum(['deterministic', 'peer', 'lead', 'human'])).min(1).max(4),
  requireAll: z.boolean().default(true),
  deterministicChecks: z.array(z.string().trim().min(1).max(512)).max(128).default([]),
  peerCapability: z.string().trim().min(1).max(256).optional(),
  humanReason: BoundedSummary.optional()
}).strict()
export type GraphReviewPolicyV1 = z.infer<typeof GraphReviewPolicyV1Schema>

export const GraphCompletionContractV1Schema = z.object({
  requiredResultFields: z.array(z.enum([
    'summary',
    'artifactRefs',
    'changedFiles',
    'checks',
    'evidence',
    'risks'
  ])).min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2_048)).min(1).max(128),
  review: GraphReviewPolicyV1Schema
}).strict()
export type GraphCompletionContractV1 = z.infer<typeof GraphCompletionContractV1Schema>

const GraphNodeV1CompatibilitySchema = z.object({
  id: GraphNodeIdSchema,
  phaseId: Identifier,
  kind: z.enum(['work', 'review', 'integration', 'loop_gate']),
  title: z.string().trim().min(1).max(256),
  objective: BoundedText,
  priority: z.number().int().min(-1_000).max(1_000).default(0),
  required: z.boolean().default(true),
  riskClass: GraphRiskClassSchema.default('low'),
  assignment: GraphAssignmentReferenceV1Schema.optional(),
  completion: GraphCompletionContractV1Schema,
  readScopes: z.array(RelativePath).max(1_000).default([]),
  writeScopes: z.array(RelativePath).max(1_000).default([]),
  tokenBudget: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().max(20).optional(),
  loopGate: GraphLoopGateV1Schema.optional(),
  metadata: z.record(z.string().max(128), z.union([
    z.string().max(2_048),
    z.number(),
    z.boolean()
  ])).default({})
}).strict().superRefine((node, ctx) => {
  if (node.kind === 'loop_gate' && !node.loopGate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['loopGate'],
      message: 'loop_gate nodes require loopGate policy'
    })
  }
  if (node.kind !== 'loop_gate' && node.loopGate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['loopGate'],
      message: 'only loop_gate nodes may declare loopGate policy'
    })
  }
})
export const GraphNodeV1Schema = GraphNodeV1CompatibilitySchema.transform((node) => {
  const { tokenBudget, ...activeNode } = node
  void tokenBudget
  return activeNode
})
export type GraphNodeV1 = z.infer<typeof GraphNodeV1Schema>

export const GraphEdgeV1Schema = z.discriminatedUnion('kind', [
  z.object({
    id: GraphEdgeIdSchema,
    kind: z.literal('control'),
    from: GraphNodeIdSchema,
    to: GraphNodeIdSchema,
    requiredOutcomes: z.array(z.enum([
      'accepted',
      'repair_required',
      'failed',
      'cancelled',
      'skipped'
    ])).min(1).default(['accepted']),
    label: z.string().max(256).optional()
  }).strict(),
  z.object({
    id: GraphEdgeIdSchema,
    kind: z.literal('data'),
    from: GraphNodeIdSchema,
    to: GraphNodeIdSchema,
    artifactName: z.string().trim().min(1).max(256),
    required: z.boolean().default(true),
    label: z.string().max(256).optional()
  }).strict(),
  z.object({
    id: GraphEdgeIdSchema,
    kind: z.literal('message'),
    from: GraphNodeIdSchema,
    to: GraphNodeIdSchema,
    allowedTypes: z.array(z.enum([
      'handoff',
      'finding',
      'question',
      'answer',
      'warning',
      'progress',
      'risk',
      'result'
    ])).min(1),
    label: z.string().max(256).optional()
  }).strict()
])
export type GraphEdgeV1 = z.infer<typeof GraphEdgeV1Schema>

export const GraphPhaseV1Schema = z.object({
  id: Identifier,
  title: z.string().trim().min(1).max(256),
  order: z.number().int().nonnegative(),
  description: z.string().max(2_048).optional(),
  collapsedByDefault: z.boolean().default(false)
}).strict()
export type GraphPhaseV1 = z.infer<typeof GraphPhaseV1Schema>

export const GraphPlanV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(256),
  goal: BoundedText,
  workspaceRoot: z.string().min(1).max(4_096),
  phases: z.array(GraphPhaseV1Schema).min(1).max(1_000),
  nodes: z.array(GraphNodeV1Schema).min(1).max(10_000),
  edges: z.array(GraphEdgeV1Schema).max(50_000),
  budget: GraphBudgetV1Schema,
  autoStart: z.boolean().default(false),
  completionNodeIds: z.array(GraphNodeIdSchema).min(1).max(1_000),
  strategy: GraphExecutionStrategyV1Schema.optional(),
  createdBy: z.enum(['lead', 'user', 'recipe', 'system']),
  createdAt: Timestamp
}).strict()
export type GraphPlanV1 = z.infer<typeof GraphPlanV1Schema>

export const GraphNodeAttemptV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  id: GraphAttemptIdSchema,
  runId: GraphRunIdSchema,
  nodeId: GraphNodeIdSchema,
  revision: z.number().int().positive(),
  attemptNumber: z.number().int().positive(),
  iteration: z.number().int().nonnegative(),
  commandId: GraphCommandIdSchema,
  idempotencyKey: IdempotencyKey,
  status: GraphAttemptStatusSchema,
  assignment: GraphAssignmentSnapshotV1Schema,
  childThreadId: Identifier.optional(),
  childTurnId: Identifier.optional(),
  result: GraphWorkerResultV1Schema.optional(),
  validation: GraphValidationResultV1Schema.optional(),
  failureClass: z.enum([
    'retryable',
    'terminal',
    'policy',
    'budget',
    'conflict',
    'interrupted',
    'unknown'
  ]).optional(),
  normalizedFailure: z.string().max(512).optional(),
  queuedAt: Timestamp,
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
  tokenUsage: z.number().int().nonnegative().default(0),
  elapsedMs: z.number().int().nonnegative().default(0)
}).strict()
export type GraphNodeAttemptV1 = z.infer<typeof GraphNodeAttemptV1Schema>

export const GraphMessageV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  id: GraphMessageIdSchema,
  runId: GraphRunIdSchema,
  sender: z.object({
    kind: z.enum(['worker', 'lead', 'user', 'system']),
    nodeId: GraphNodeIdSchema.optional(),
    attemptId: GraphAttemptIdSchema.optional()
  }).strict(),
  recipients: z.array(z.object({
    kind: z.enum(['worker', 'lead', 'user']),
    nodeId: GraphNodeIdSchema.optional()
  }).strict()).min(1).max(64),
  type: z.enum([
    'handoff',
    'finding',
    'question',
    'answer',
    'warning',
    'help',
    'steering',
    'system',
    'progress',
    'risk',
    'result'
  ]),
  priority: z.enum(['low', 'normal', 'high', 'blocking']),
  summary: BoundedSummary,
  details: BoundedText.optional(),
  artifactRefs: z.array(GraphArtifactReferenceV1Schema).max(32).default([]),
  correlationId: Identifier.optional(),
  replyRequired: z.boolean().default(false),
  status: z.enum(['queued', 'delivered', 'acknowledged', 'expired', 'rejected']),
  createdAt: Timestamp,
  expiresAt: Timestamp.optional(),
  acknowledgedAt: Timestamp.optional()
}).strict()
export type GraphMessageV1 = z.infer<typeof GraphMessageV1Schema>

export const GraphCleanupRecordV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  id: Identifier,
  runId: GraphRunIdSchema,
  attemptId: GraphAttemptIdSchema.optional(),
  resourceKind: z.enum(['worker', 'lease', 'worktree', 'artifact', 'journal']),
  resourceId: z.string().min(1).max(4_096),
  state: z.enum(['pending', 'running', 'completed', 'failed', 'orphaned', 'preserved']),
  retryCount: z.number().int().nonnegative(),
  lastError: z.string().max(2_048).optional(),
  updatedAt: Timestamp
}).strict()
export type GraphCleanupRecordV1 = z.infer<typeof GraphCleanupRecordV1Schema>

const GraphPatchAddNodeV1Schema = z.object({
  op: z.literal('add_node'),
  node: GraphNodeV1Schema
}).strict()
const GraphPatchReplaceNodeV1Schema = z.object({
  op: z.literal('replace_node'),
  nodeId: GraphNodeIdSchema,
  replacement: GraphNodeV1Schema,
  supersedesAcceptedWork: z.boolean().default(false)
}).strict()
const GraphPatchRebindNodeV1Schema = z.object({
  op: z.literal('rebind_node'),
  nodeId: GraphNodeIdSchema,
  assignment: GraphAssignmentReferenceV1Schema
}).strict()
const GraphPatchAddEdgeV1Schema = z.object({
  op: z.literal('add_edge'),
  edge: GraphEdgeV1Schema
}).strict()
const GraphPatchRemoveEdgeV1Schema = z.object({
  op: z.literal('remove_edge'),
  edgeId: GraphEdgeIdSchema
}).strict()
const GraphPatchUpdateBudgetV1Schema = z.object({
  op: z.literal('update_budget'),
  budget: GraphBudgetV1Schema
}).strict()
const GraphPatchUpdateReviewV1Schema = z.object({
  op: z.literal('update_review'),
  nodeId: GraphNodeIdSchema,
  review: GraphReviewPolicyV1Schema
}).strict()

export const GraphPatchOperationV1Schema = z.discriminatedUnion('op', [
  GraphPatchAddNodeV1Schema,
  GraphPatchReplaceNodeV1Schema,
  GraphPatchRebindNodeV1Schema,
  GraphPatchAddEdgeV1Schema,
  GraphPatchRemoveEdgeV1Schema,
  GraphPatchUpdateBudgetV1Schema,
  GraphPatchUpdateReviewV1Schema
])
export type GraphPatchOperationV1 = z.infer<typeof GraphPatchOperationV1Schema>

export const GraphPatchV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  patchId: Identifier,
  commandId: GraphCommandIdSchema,
  runId: GraphRunIdSchema,
  baseRevision: z.number().int().positive(),
  requester: z.object({
    kind: z.enum(['lead', 'user', 'system']),
    id: Identifier
  }).strict(),
  reason: BoundedText,
  operations: z.array(GraphPatchOperationV1Schema).min(1).max(1_000),
  createdAt: Timestamp
}).strict()
export type GraphPatchV1 = z.infer<typeof GraphPatchV1Schema>

export const GraphSteeringV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  steeringId: Identifier,
  runId: GraphRunIdSchema,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('run') }).strict(),
    z.object({ kind: z.literal('lead') }).strict(),
    z.object({ kind: z.literal('phase'), phaseId: Identifier }).strict(),
    z.object({ kind: z.literal('node'), nodeId: GraphNodeIdSchema }).strict(),
    z.object({
      kind: z.literal('attempt'),
      nodeId: GraphNodeIdSchema,
      attemptId: GraphAttemptIdSchema
    }).strict()
  ]),
  text: BoundedText,
  status: z.enum(['persisted', 'delivered', 'handled', 'superseded']),
  createdAt: Timestamp
}).strict()
export type GraphSteeringV1 = z.infer<typeof GraphSteeringV1Schema>

export const GraphRunSummaryV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  finalAnswer: BoundedText,
  evidenceRefs: z.array(GraphArtifactReferenceV1Schema).max(256).default([]),
  unresolvedRisks: z.array(BoundedSummary).max(128).default([]),
  changedFiles: z.array(RelativePath).max(10_000).default([]),
  validationResults: z.array(GraphCheckResultV1Schema).max(512).default([]),
  totalTokens: z.number().int().nonnegative(),
  totalElapsedMs: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative().optional(),
  completedAt: Timestamp
}).strict()
export type GraphRunSummaryV1 = z.infer<typeof GraphRunSummaryV1Schema>

export const GraphSupervisionObligationKindSchema = z.enum([
  'review_required',
  'repair_required',
  'stall',
  'conflict',
  'budget',
  'help',
  'recovery',
  'completion',
  'user_steering',
  'worker_report',
  'scheduler_error'
])
export type GraphSupervisionObligationKind = z.infer<
  typeof GraphSupervisionObligationKindSchema
>

export const GraphSupervisionObligationStateSchema = z.enum([
  'pending',
  'delivering',
  'awaiting_action',
  'retry_scheduled',
  'resolved',
  'needs_attention'
])
export type GraphSupervisionObligationState = z.infer<
  typeof GraphSupervisionObligationStateSchema
>

/**
 * Durable liveness record for one actionable source-Lead responsibility.
 * Prompt delivery is intentionally separate from semantic resolution.
 */
export const GraphSupervisionObligationV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  id: Identifier,
  kind: GraphSupervisionObligationKindSchema,
  reason: z.enum([
    'submitted',
    'failure',
    'stall',
    'conflict',
    'budget',
    'help',
    'recovery',
    'completion',
    'user_steering',
    'worker_report',
    'scheduler_error'
  ]),
  graphRevision: z.number().int().positive(),
  nodeIds: z.array(GraphNodeIdSchema).max(1_000).default([]),
  attemptIds: z.array(GraphAttemptIdSchema).max(1_000).default([]),
  digest: BoundedSummary,
  state: GraphSupervisionObligationStateSchema,
  deliveryAttempts: z.number().int().nonnegative().default(0),
  consecutiveDeliveryFailures: z.number().int().nonnegative().default(0),
  noProgressCount: z.number().int().nonnegative().default(0),
  lastProgressSeq: z.number().int().nonnegative().default(0),
  lastDeliveredSeq: z.number().int().nonnegative().optional(),
  deliveryLeaseId: Identifier.optional(),
  leaseUntil: Timestamp.optional(),
  nextWakeAt: Timestamp.optional(),
  lastDeliveredAt: Timestamp.optional(),
  lastError: BoundedSummary.optional(),
  attentionReason: BoundedSummary.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp.optional()
}).strict()
export type GraphSupervisionObligationV1 = z.infer<
  typeof GraphSupervisionObligationV1Schema
>

export const GraphNodeProjectionV1Schema = z.object({
  node: GraphNodeV1Schema,
  status: GraphNodeStatusSchema,
  attempts: z.array(GraphNodeAttemptV1Schema),
  acceptedAttemptId: GraphAttemptIdSchema.optional(),
  supersededByNodeId: GraphNodeIdSchema.optional(),
  loopIteration: z.number().int().nonnegative().default(0),
  lastTransitionReason: BoundedSummary.optional(),
  lastProgress: GraphProgressUpdateV1Schema.optional()
}).strict()
export type GraphNodeProjectionV1 = z.infer<typeof GraphNodeProjectionV1Schema>

export const GraphRunV1Schema = z.object({
  version: z.literal(GRAPH_CONTRACT_VERSION),
  id: GraphRunIdSchema,
  projectId: Identifier,
  threadId: Identifier,
  sourceTurnId: Identifier,
  status: GraphRunStatusSchema,
  pendingControlIntent: GraphControlIntentSchema.optional(),
  currentRevision: z.number().int().positive(),
  plans: z.array(GraphPlanV1Schema).min(1),
  nodes: z.record(GraphNodeIdSchema, GraphNodeProjectionV1Schema),
  reviews: z.array(GraphReviewResultV1Schema),
  messages: z.array(GraphMessageV1Schema),
  artifacts: z.array(GraphArtifactReferenceV1Schema),
  cleanup: z.array(GraphCleanupRecordV1Schema),
  steering: z.array(GraphSteeringV1Schema),
  supervisionObligations: z.array(GraphSupervisionObligationV1Schema).max(10_000).default([]),
  budget: GraphBudgetLedgerV1Schema,
  summary: GraphRunSummaryV1Schema.optional(),
  lastEventSeq: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional()
}).strict()
export type GraphRunV1 = z.infer<typeof GraphRunV1Schema>
