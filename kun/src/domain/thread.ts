import type {
  ThreadMode,
  ThreadRecord,
  ThreadGoal,
  ThreadTodoList,
  ThreadRelation,
  ThreadStatus,
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility,
  ExtensionToolCatalogEpoch,
  ConversationExecutionProfile
} from '../contracts/threads.js'
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type SandboxMode
} from '../contracts/policy.js'

/**
 * Domain helper for thread records. The contract type is the source of
 * truth; this module only adds small factory/utility helpers so the
 * services and stores can stay free of date-string formatting.
 */
export type ThreadEntity = ThreadRecord

export function createThreadRecord(input: {
  id: string
  title: string
  titleAuto?: boolean
  workspace: string
  model: string
  providerId?: string
  ownerExtensionId?: string
  ownerExtensionVersion?: string
  accountId?: string
  extensionVisibility?: ExtensionThreadVisibility
  extensionProfile?: ExtensionAgentProfileSnapshot
  extensionBudget?: ExtensionRunBudget
  toolCatalogEpoch?: ExtensionToolCatalogEpoch
  agentId?: string
  systemPrompt?: string
  executionProfile?: ConversationExecutionProfile
  mode?: ThreadMode
  status?: ThreadStatus
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  pinned?: boolean
  costBudgetUsd?: number
  costBudgetWarningSent?: boolean
  relation?: ThreadRelation
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: ThreadGoal
  todos?: ThreadTodoList
  createdAt?: string
}): ThreadEntity {
  const now = input.createdAt ?? new Date().toISOString()
  return {
    id: input.id,
    title: input.title,
    ...(input.titleAuto !== undefined ? { titleAuto: input.titleAuto } : {}),
    workspace: input.workspace,
    model: input.model,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.ownerExtensionId ? { ownerExtensionId: input.ownerExtensionId } : {}),
    ...(input.ownerExtensionVersion ? { ownerExtensionVersion: input.ownerExtensionVersion } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.extensionVisibility ? { extensionVisibility: input.extensionVisibility } : {}),
    ...(input.extensionProfile ? { extensionProfile: input.extensionProfile } : {}),
    ...(input.extensionBudget ? { extensionBudget: input.extensionBudget } : {}),
    ...(input.toolCatalogEpoch ? { toolCatalogEpoch: input.toolCatalogEpoch } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.executionProfile ? { executionProfile: input.executionProfile } : {}),
    mode: input.mode ?? 'agent',
    status: input.status ?? 'idle',
    approvalPolicy: input.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
    sandboxMode: input.sandboxMode ?? DEFAULT_SANDBOX_MODE,
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(input.costBudgetUsd !== undefined ? { costBudgetUsd: input.costBudgetUsd } : {}),
    ...(input.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: input.costBudgetWarningSent } : {}),
    relation: input.relation ?? 'primary',
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    ...(input.forkedFromThreadId ? { forkedFromThreadId: input.forkedFromThreadId } : {}),
    ...(input.forkedFromTitle ? { forkedFromTitle: input.forkedFromTitle } : {}),
    ...(input.forkedAt ? { forkedAt: input.forkedAt } : {}),
    ...(input.forkedFromMessageCount !== undefined ? { forkedFromMessageCount: input.forkedFromMessageCount } : {}),
    ...(input.forkedFromTurnCount !== undefined ? { forkedFromTurnCount: input.forkedFromTurnCount } : {}),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.todos ? { todos: input.todos } : {}),
    createdAt: now,
    updatedAt: now,
    turns: []
  }
}

export function touchThread(thread: ThreadEntity, updatedAt?: string): ThreadEntity {
  return { ...thread, updatedAt: updatedAt ?? new Date().toISOString() }
}

export function toThreadSummary(
  thread: ThreadEntity
): Pick<
  ThreadEntity,
  'id' | 'title' | 'titleAuto' | 'summary' | 'workspace' | 'model' | 'providerId' | 'agentId' | 'systemPrompt' | 'executionProfile' | 'mode' | 'status' | 'approvalPolicy' | 'sandboxMode' | 'pinned' | 'createdAt' | 'updatedAt'
  | 'ownerExtensionId' | 'ownerExtensionVersion' | 'accountId' | 'extensionVisibility'
  | 'extensionProfile' | 'extensionBudget' | 'toolCatalogEpoch'
  | 'costBudgetUsd' | 'costBudgetWarningSent'
  | 'relation' | 'parentThreadId'
  | 'forkedFromThreadId' | 'forkedFromTitle' | 'forkedAt' | 'forkedFromMessageCount' | 'forkedFromTurnCount'
  | 'goal' | 'todos'
> {
  return {
    id: thread.id,
    title: thread.title,
    ...(thread.titleAuto !== undefined ? { titleAuto: thread.titleAuto } : {}),
    ...(thread.summary ? { summary: thread.summary } : {}),
    workspace: thread.workspace,
    model: thread.model,
    ...(thread.providerId ? { providerId: thread.providerId } : {}),
    ...(thread.ownerExtensionId ? { ownerExtensionId: thread.ownerExtensionId } : {}),
    ...(thread.ownerExtensionVersion ? { ownerExtensionVersion: thread.ownerExtensionVersion } : {}),
    ...(thread.accountId ? { accountId: thread.accountId } : {}),
    ...(thread.extensionVisibility ? { extensionVisibility: thread.extensionVisibility } : {}),
    ...(thread.extensionProfile ? { extensionProfile: thread.extensionProfile } : {}),
    ...(thread.extensionBudget ? { extensionBudget: thread.extensionBudget } : {}),
    ...(thread.toolCatalogEpoch ? { toolCatalogEpoch: thread.toolCatalogEpoch } : {}),
    ...(thread.agentId ? { agentId: thread.agentId } : {}),
    ...(thread.systemPrompt ? { systemPrompt: thread.systemPrompt } : {}),
    ...(thread.executionProfile ? { executionProfile: thread.executionProfile } : {}),
    mode: thread.mode,
    status: thread.status,
    approvalPolicy: thread.approvalPolicy,
    sandboxMode: thread.sandboxMode,
    ...(thread.pinned !== undefined ? { pinned: thread.pinned } : {}),
    ...(thread.costBudgetUsd !== undefined ? { costBudgetUsd: thread.costBudgetUsd } : {}),
    ...(thread.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: thread.costBudgetWarningSent } : {}),
    relation: thread.relation ?? 'primary',
    ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
    ...(thread.forkedFromThreadId ? { forkedFromThreadId: thread.forkedFromThreadId } : {}),
    ...(thread.forkedFromTitle ? { forkedFromTitle: thread.forkedFromTitle } : {}),
    ...(thread.forkedAt ? { forkedAt: thread.forkedAt } : {}),
    ...(thread.forkedFromMessageCount !== undefined ? { forkedFromMessageCount: thread.forkedFromMessageCount } : {}),
    ...(thread.forkedFromTurnCount !== undefined ? { forkedFromTurnCount: thread.forkedFromTurnCount } : {}),
    ...(thread.goal ? { goal: thread.goal } : {}),
    ...(thread.todos ? { todos: thread.todos } : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  }
}
