import type {
  ActingTurnModelRoute,
  GuiDesignArtifactContextJson,
  GuiPlanContextJson,
  Turn,
  TurnClientSurface,
  TurnReasoningEffort,
  SubagentResumeRequest,
  TurnServiceTier,
  TurnStatus
} from '../contracts/turns.js'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../contracts/policy.js'
import type { GraphOrchestrationStrategy } from '../contracts/graph.js'
import type { ThreadMode } from '../contracts/threads.js'
import type { TurnItem, UserMessageSource } from '../contracts/items.js'
import type { ComposerContextAttachmentJson } from '../contracts/composer-context.js'
import type {
  DesignDocumentTarget,
  DesignTaskProfile
} from '../contracts/design-task-profile.js'
import type { WriteTurnContext } from '../contracts/write-turn-context.js'

export type TurnEntity = Turn

export function createTurnRecord(input: {
  id: string
  threadId: string
  clientRequestId?: string
  clientRequestFingerprint?: string
  admissionPending?: boolean
  prompt: string
  messageSource?: UserMessageSource
  subagentResume?: SubagentResumeRequest
  model?: string
  providerId?: string
  accountId?: string
  actingModelRoute?: ActingTurnModelRoute
  reasoningEffort?: TurnReasoningEffort
  serviceTier?: TurnServiceTier
  clientSurface?: TurnClientSurface
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  attachmentIds?: string[]
  composerContexts?: ComposerContextAttachmentJson[]
  guiPlan?: GuiPlanContextJson
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  agentSurface?: 'code' | 'write' | 'design'
  designProfile?: DesignTaskProfile
  designDocumentTarget?: DesignDocumentTarget
  writeContext?: WriteTurnContext
  /** Turn-scoped persona text; stored so replay reconstructs the same request. */
  persona?: string
  guiDesignArtifact?: GuiDesignArtifactContextJson
  mode?: ThreadMode
  orchestration?: GraphOrchestrationStrategy
  disableUserInput?: boolean
  imContext?: boolean
  workspaceCheckpointId?: string
  workspaceCheckpointRequestId?: string
  extensionBudgetTokenBaseline?: number
  graphPlanningLifecycle?: import('../contracts/turns.js').GraphPlanningLifecycle
  createdAt?: string
  status?: TurnStatus
}): TurnEntity {
  const model = input.model?.trim()
  const providerId = input.providerId?.trim()
  const accountId = input.accountId?.trim()
  const clientRequestId = input.clientRequestId?.trim()
  const reasoningEffort = normalizeReasoningEffort(input.reasoningEffort)
  return {
    id: input.id,
    threadId: input.threadId,
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(input.clientRequestFingerprint
      ? { clientRequestFingerprint: input.clientRequestFingerprint }
      : {}),
    ...(input.admissionPending ? { admissionPending: true as const } : {}),
    status: input.status ?? 'queued',
    prompt: input.prompt,
    ...(input.messageSource ? { messageSource: input.messageSource } : {}),
    ...(input.subagentResume ? { subagentResume: { ...input.subagentResume } } : {}),
    orchestration: input.orchestration ?? 'direct',
    steering: [],
    items: [],
    attachmentIds: [...(input.attachmentIds ?? [])],
    composerContexts: [...(input.composerContexts ?? [])],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedInstructionSources: [],
    ...(model ? { model } : {}),
    ...(providerId ? { providerId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(input.actingModelRoute ? { actingModelRoute: { ...input.actingModelRoute } } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    ...(input.clientSurface ? { clientSurface: input.clientSurface } : {}),
    ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
    ...(input.sandboxMode ? { sandboxMode: input.sandboxMode } : {}),
    ...(input.approvalReviewer ? { approvalReviewer: input.approvalReviewer } : {}),
    ...(input.guiPlan ? { guiPlan: input.guiPlan } : {}),
    ...(input.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
    ...(input.guiDesignMode ? { guiDesignMode: true } : {}),
    ...(input.agentSurface ? { agentSurface: input.agentSurface } : {}),
    ...(input.designProfile ? { designProfile: input.designProfile } : {}),
    ...(input.designDocumentTarget ? { designDocumentTarget: input.designDocumentTarget } : {}),
    ...(input.writeContext ? { writeContext: input.writeContext } : {}),
    ...(input.persona?.trim() ? { persona: input.persona.trim() } : {}),
    ...(input.guiDesignArtifact ? { guiDesignArtifact: input.guiDesignArtifact } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.disableUserInput ? { disableUserInput: true } : {}),
    ...(input.imContext ? { imContext: true } : {}),
    ...(input.workspaceCheckpointId ? { workspaceCheckpointId: input.workspaceCheckpointId } : {}),
    ...(input.workspaceCheckpointRequestId
      ? { workspaceCheckpointRequestId: input.workspaceCheckpointRequestId }
      : {}),
    ...(input.extensionBudgetTokenBaseline !== undefined
      ? {
          extensionBudgetTokenBaseline: input.extensionBudgetTokenBaseline,
          extensionModelRequests: 0,
          extensionToolInvocations: 0
        }
      : {}),
    ...(input.graphPlanningLifecycle
      ? { graphPlanningLifecycle: { ...input.graphPlanningLifecycle } }
      : {}),
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}

function normalizeReasoningEffort(effort: TurnReasoningEffort | undefined): TurnReasoningEffort | undefined {
  return effort && effort !== 'auto' ? effort : undefined
}

export function appendTurnItem(turn: TurnEntity, item: TurnItem): TurnEntity {
  if (turn.items.some((existing) => existing.id === item.id)) {
    return {
      ...turn,
      items: turn.items.map((existing) => (existing.id === item.id ? item : existing))
    }
  }
  return { ...turn, items: [...turn.items, item] }
}

export function replaceTurnItem(
  turn: TurnEntity,
  itemId: string,
  patch: Partial<TurnItem>
): TurnEntity {
  return {
    ...turn,
    items: turn.items.map((existing) =>
      existing.id === itemId ? ({ ...existing, ...patch } as TurnItem) : existing
    )
  }
}

export function startTurn(turn: TurnEntity, startedAt?: string): TurnEntity {
  return {
    ...turn,
    status: 'running',
    startedAt: startedAt ?? new Date().toISOString()
  }
}

export function finishTurn(
  turn: TurnEntity,
  status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>,
  finishedAt?: string
): TurnEntity {
  return {
    ...turn,
    status,
    finishedAt: finishedAt ?? new Date().toISOString(),
    steering: []
  }
}
