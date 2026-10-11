import { z } from 'zod'

/** Lightweight HTTP mirror of Kun's dispatch contract, independent of its loop types. */
export type AgentDispatchPermissionMode = 'ask-for-approval' | 'approve-for-me' | 'full-access'
export type AgentDispatchIntentView = {
  intentId: string
  kind: 'worker' | 'workbench'
  state: 'pending_confirmation' | 'reviewing' | 'countdown' | 'paused' | 'queued' | 'starting' |
    'uncertain' | 'running' | 'awaiting_parent' | 'completed' | 'failed' | 'cancelled' | 'stopping'
  revision: number
  source: {
    threadId: string; turnId: string; toolCallId: string; applicationSessionId: string
    actingModelRoute?: { model: string; providerId?: string; accountId?: string;
      unresolvedGatewayAlias?: true; requestedGatewayAlias?: string }
  }
  policySnapshot: {
    approvalPolicy: 'always' | 'on-request' | 'untrusted' | 'never' | 'auto' | 'suggest'
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' | 'external-sandbox'
    approvalReviewer: 'user' | 'agent'
  }
  recommendation: {
    title: string; task: string; agentId: string; agentName?: string; model?: string; workspace?: string
    acceptanceCriteria?: string[]; permissionMode: AgentDispatchPermissionMode
    effectivePermissionMode?: AgentDispatchPermissionMode; agentSelection: 'user' | 'auto'
  }
  startRequestId: string
  batchId?: string
  deadline?: string
  decision?: { decision: 'allow' | 'deny'; reason: string; decidedAt: string }
  target?: AgentDispatchTargetView
  error?: string
  resultSummary?: string
  cancellationRequested: boolean
  takenOver: boolean
  takeoverApplied: boolean
  replacementCount: number
  replacementReason?: string
  previousTarget?: AgentDispatchTargetView
  createdAt: string
  updatedAt: string
}
export type AgentDispatchTargetView = {
  taskId?: string; threadId?: string; turnId?: string; workerIds?: string[]; dispatchIds?: string[]
}

const permission = z.enum(['ask-for-approval', 'approve-for-me', 'full-access'])
const target = z.object({ taskId: z.string().optional(), threadId: z.string().optional(),
  turnId: z.string().optional(), workerIds: z.array(z.string()).optional(), dispatchIds: z.array(z.string()).optional() }).strict()

// Public responses reject unknown fields, including private payloads and user excerpts.
export const AgentDispatchIntentPublicSchema: z.ZodType<AgentDispatchIntentView> = z.object({
  intentId: z.string().min(1), kind: z.enum(['worker', 'workbench']),
  state: z.enum(['pending_confirmation', 'reviewing', 'countdown', 'paused', 'queued', 'starting',
    'uncertain', 'running', 'awaiting_parent', 'completed', 'failed', 'cancelled', 'stopping']),
  revision: z.number().int().positive(),
  source: z.object({ threadId: z.string().min(1), turnId: z.string().min(1), toolCallId: z.string().min(1),
    applicationSessionId: z.string().min(1), actingModelRoute: z.object({ model: z.string().trim().min(1),
      providerId: z.string().trim().min(1).optional(), accountId: z.string().trim().min(1).optional(),
      unresolvedGatewayAlias: z.literal(true).optional(), requestedGatewayAlias: z.string().min(1).max(512).optional() }).strict().optional() }).strict(),
  policySnapshot: z.object({ approvalPolicy: z.enum(['always', 'on-request', 'untrusted', 'never', 'auto', 'suggest']),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access', 'external-sandbox']),
    approvalReviewer: z.enum(['user', 'agent']) }).strict(),
  recommendation: z.object({ title: z.string().min(1).max(512), task: z.string().min(1).max(128_000),
    agentId: z.string().min(1).max(512), agentName: z.string().max(512).optional(), model: z.string().max(512).optional(),
    workspace: z.string().max(4096).optional(), acceptanceCriteria: z.array(z.string().max(4096)).max(100).optional(),
    permissionMode: permission, effectivePermissionMode: permission.optional(), agentSelection: z.enum(['user', 'auto']) }).strict(),
  startRequestId: z.string().min(1), batchId: z.string().optional(), deadline: z.string().datetime().optional(),
  decision: z.object({ decision: z.enum(['allow', 'deny']), reason: z.string().min(1).max(8192), decidedAt: z.string().datetime() }).strict().optional(),
  target: target.optional(), error: z.string().max(8192).optional(), resultSummary: z.string().max(32_000).optional(),
  cancellationRequested: z.boolean().default(false), takenOver: z.boolean().default(false), takeoverApplied: z.boolean().default(false),
  replacementCount: z.number().int().min(0).max(1).default(0), replacementReason: z.string().max(8192).optional(),
  previousTarget: target.optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime()
}).strict()

export type AgentDispatchAction = 'start_now' | 'pause' | 'update' | 'resume' | 'cancel' | 'takeover'
export const agentDispatchPath = (intentId: string): string =>
  `/v1/agent-dispatch-intents/${encodeURIComponent(intentId)}`
