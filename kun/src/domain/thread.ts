import { isAbsolute, relative, resolve } from 'node:path'
import {
  MAX_THREAD_KNOWLEDGE_BASES,
  type KnowledgeBaseMount,
  type ThreadMode,
  type ThreadRecord,
  type ThreadSummary,
  type ThreadGoal,
  type ThreadTodoList,
  type ThreadRelation,
  type ThreadStatus,
  type ThreadAgentSurface,
  type DesignCloneOperation,
  type ExtensionAgentProfileSnapshot,
  type ExtensionRunBudget,
  type ExtensionThreadVisibility,
  type ExtensionToolCatalogEpoch
} from '../contracts/threads.js'
import type { DesignTaskProfile } from '../contracts/design-task-profile.js'
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import { resolveThreadLockedTaskSurface } from './task-surface-lock.js'

/**
 * Domain helper for thread records. The contract type is the source of
 * truth; this module only adds small factory/utility helpers so the
 * services and stores can stay free of date-string formatting.
 */
export type ThreadEntity = ThreadRecord

const LEGACY_WRITE_THREAD_TITLE = 'Write Assistant'
const LEGACY_WRITE_CONTEXT_HEADING = '[写作上下文]'
const LEGACY_WRITE_INTERACTION_LIMIT =
  '交互限制: 当前 GUI 无法提交 request_user_input 的 HTTP 响应；需要更多信息时，直接用普通文本向用户提问，不要调用 request_user_input。'
const LEGACY_WRITE_INTERACTION_AGREEMENT =
  '交互约定: 需要更多信息时通常直接用普通文本向用户提问。仅当当前激活的专用工作流明确要求结构化确认（例如 PPT 视觉评审）时，调用该工作流提供的确认工具；其他写作任务不要滥用结构化交互。'

export function createThreadRecord(input: {
  id: string
  title: string
  titleAuto?: boolean
  workspace: string
  additionalWorkspaces?: string[]
  knowledgeBases?: KnowledgeBaseMount[]
  model: string
  agentSurface?: ThreadAgentSurface
  designProfile?: DesignTaskProfile
  designCloneOperation?: DesignCloneOperation
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
  mode?: ThreadMode
  status?: ThreadStatus
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  modelRequestCaptureEnabled?: boolean
  pinned?: boolean
  costBudgetUsd?: number
  costBudgetWarningSent?: boolean
  relation?: ThreadRelation
  parentThreadId?: string
  planBuildRunId?: string
  planBuildAdmissionFingerprint?: string
  planBuildAdmissionCapabilityHash?: string
  planBuildAdmissionFrozen?: boolean
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
    revision: 0,
    title: input.title,
    ...(input.titleAuto !== undefined ? { titleAuto: input.titleAuto } : {}),
    workspace: input.workspace,
    additionalWorkspaces: [...new Set(
      (input.additionalWorkspaces ?? []).map((entry) => entry.trim()).filter((entry) => entry && entry !== input.workspace)
    )],
    knowledgeBases: normalizeKnowledgeBaseMounts(input.knowledgeBases, input.workspace),
    model: input.model,
    ...(input.agentSurface ? { agentSurface: input.agentSurface } : {}),
    ...(input.designProfile ? { designProfile: input.designProfile } : {}),
    ...(input.designCloneOperation ? { designCloneOperation: input.designCloneOperation } : {}),
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
    mode: input.mode ?? 'agent',
    status: input.status ?? 'idle',
    approvalPolicy: input.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
    sandboxMode: input.sandboxMode ?? DEFAULT_SANDBOX_MODE,
    approvalReviewer: input.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    modelRequestCaptureEnabled: input.modelRequestCaptureEnabled ?? false,
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(input.costBudgetUsd !== undefined ? { costBudgetUsd: input.costBudgetUsd } : {}),
    ...(input.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: input.costBudgetWarningSent } : {}),
    relation: input.relation ?? 'primary',
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    ...(input.planBuildRunId ? { planBuildRunId: input.planBuildRunId } : {}),
    ...(input.planBuildAdmissionFingerprint
      ? { planBuildAdmissionFingerprint: input.planBuildAdmissionFingerprint }
      : {}),
    ...(input.planBuildAdmissionCapabilityHash
      ? { planBuildAdmissionCapabilityHash: input.planBuildAdmissionCapabilityHash }
      : {}),
    ...(input.planBuildAdmissionFrozen !== undefined
      ? { planBuildAdmissionFrozen: input.planBuildAdmissionFrozen }
      : {}),
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
): ThreadSummary {
  const lockedTaskSurface = resolveThreadLockedTaskSurface(thread)
  return {
    id: thread.id,
    title: thread.title,
    ...(thread.titleAuto !== undefined ? { titleAuto: thread.titleAuto } : {}),
    ...(thread.summary ? { summary: thread.summary } : {}),
    workspace: thread.workspace,
    additionalWorkspaces: thread.additionalWorkspaces,
    knowledgeBases: thread.knowledgeBases,
    model: thread.model,
    agentSurface: resolveThreadAgentSurface(thread),
    ...(lockedTaskSurface ? { lockedTaskSurface } : {}),
    ...(thread.designProfile ? { designProfile: thread.designProfile } : {}),
    ...(thread.designCloneOperation ? { designCloneOperation: thread.designCloneOperation } : {}),
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
    mode: thread.mode,
    status: thread.status,
    approvalPolicy: thread.approvalPolicy,
    sandboxMode: thread.sandboxMode,
    approvalReviewer: thread.approvalReviewer,
    modelRequestCaptureEnabled: thread.modelRequestCaptureEnabled,
    ...(thread.pinned !== undefined ? { pinned: thread.pinned } : {}),
    ...(thread.costBudgetUsd !== undefined ? { costBudgetUsd: thread.costBudgetUsd } : {}),
    ...(thread.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: thread.costBudgetWarningSent } : {}),
    relation: thread.relation ?? 'primary',
    ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
    ...(thread.planBuildRunId ? { planBuildRunId: thread.planBuildRunId } : {}),
    ...(thread.planBuildAdmissionFingerprint
      ? { planBuildAdmissionFingerprint: thread.planBuildAdmissionFingerprint }
      : {}),
    ...(thread.planBuildAdmissionCapabilityHash
      ? { planBuildAdmissionCapabilityHash: thread.planBuildAdmissionCapabilityHash }
      : {}),
    ...(thread.planBuildAdmissionFrozen !== undefined
      ? { planBuildAdmissionFrozen: thread.planBuildAdmissionFrozen }
      : {}),
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

export function normalizeKnowledgeBaseMounts(
  mounts: readonly KnowledgeBaseMount[] | undefined,
  workspace: string
): KnowledgeBaseMount[] {
  if ((mounts?.length ?? 0) > MAX_THREAD_KNOWLEDGE_BASES) {
    throw new Error(`a thread can mount at most ${MAX_THREAD_KNOWLEDGE_BASES} knowledge bases`)
  }
  const normalizedWorkspace = comparableKnowledgePath(workspace)
  const roots: string[] = []
  const ids = new Set<string>()
  return (mounts ?? []).map((mount) => {
    const id = mount.id.trim()
    const root = mount.root.trim()
    const name = mount.name.trim()
    if (!id || !root || !name) throw new Error('knowledge base id, root, and name are required')
    if (!isAbsolute(root)) throw new Error(`knowledge base root must be absolute: ${root}`)
    if (ids.has(id)) throw new Error(`duplicate knowledge base id: ${id}`)
    const key = comparableKnowledgePath(root)
    if (key === normalizedWorkspace) throw new Error('knowledge base root must differ from the thread workspace')
    if (roots.some((existing) => pathsOverlap(existing, key))) {
      throw new Error(`knowledge base roots must not overlap: ${root}`)
    }
    ids.add(id)
    roots.push(key)
    return { id, root: resolve(root), name, source: 'write-workspace', access: 'read-only' }
  })
}

function comparableKnowledgePath(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

function pathsOverlap(left: string, right: string): boolean {
  const leftToRight = relative(left, right)
  const rightToLeft = relative(right, left)
  return leftToRight === '' || rightToLeft === '' ||
    (!leftToRight.startsWith('..') && !isAbsolute(leftToRight)) ||
    (!rightToLeft.startsWith('..') && !isAbsolute(rightToLeft))
}

export function legacyWorkThreadTitleMatches(title: string): boolean {
  const normalized = title.trim()
  return normalized === LEGACY_WRITE_THREAD_TITLE ||
    normalized.startsWith(LEGACY_WRITE_CONTEXT_HEADING)
}

function legacyWorkEnvelope(text: string): boolean {
  if (!text.startsWith(`${LEGACY_WRITE_CONTEXT_HEADING}\n`)) return false
  const separator = text.indexOf('\n\n')
  if (separator < 0) return false
  const context = text.slice(LEGACY_WRITE_CONTEXT_HEADING.length + 1, separator)
  // Match the exact host-authored interaction line from either Work generation.
  // The edit rule was introduced independently and cannot identify every valid
  // historical record.
  return context.includes(LEGACY_WRITE_INTERACTION_LIMIT) ||
    context.includes(LEGACY_WRITE_INTERACTION_AGREEMENT)
}

/** A narrow compatibility proof for pre-surface Work/Reasonix records. */
export function legacyThreadCanClaimWrite(thread: ThreadEntity): boolean {
  if (
    thread.agentSurface ||
    thread.designProfile ||
    thread.turns.length === 0 ||
    !legacyWorkThreadTitleMatches(thread.title) ||
    thread.turns.some((turn) => turn.agentSurface !== undefined)
  ) return false
  return thread.turns.every((turn) => turn.items.some((item) =>
    item.kind === 'user_message' &&
    item.agentSurface === undefined &&
    item.threadAgentSurface === undefined &&
    legacyWorkEnvelope(item.text)
  ))
}

/**
 * Resolves legacy ownership without allowing a title or prompt alone to steal
 * a Code conversation. Explicit metadata wins. Otherwise only homogeneous
 * non-Code turn metadata, or a fully identifiable legacy Work record, can be
 * inferred. Empty, mixed, and partially annotated history remains Code.
 */
export function resolveThreadAgentSurface(
  thread: ThreadEntity
): ThreadAgentSurface {
  if (thread.agentSurface) return thread.agentSurface
  if (legacyThreadCanClaimWrite(thread)) return 'write'
  if (thread.turns.length === 0) return 'code'
  const candidate = thread.turns[0]?.agentSurface
  if (candidate !== 'write' && candidate !== 'design') return 'code'
  return thread.turns.every((turn) => turn.agentSurface === candidate) ? candidate : 'code'
}
