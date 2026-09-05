import type {
  AgentProvider,
  ChatBlock,
  CompactionBlock,
  NormalizedThread,
  ReviewBlock,
  ReviewEventPayload,
  RuntimeStatusEventPayload,
  ThreadEventSink,
  ToolBlock,
  ToolEventPayload,
  UserInputQuestion
} from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import { isOfficePreviewPath, publishLiveOfficePreview } from '../lib/live-office-preview'
import {
  isClawWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot
} from '../lib/workspace-path'
import type { ClawImChannelV1 } from '@shared/app-settings'
import type { TurnCompleteNotificationSource } from '@shared/kun-gui-api'
import { isBackgroundShellNoticeUserMessage } from '@shared/background-shell-notice'
import type { ChatState } from './chat-store-types'
import { isPendingQueuedMessage } from './queued-message-persistence'
import { hydrateBlockModelLabels, isClawThread } from './chat-store-helpers'
import {
  collectAssistantTextForTurn,
  isOptimisticUserBlockId,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadLooksRunning,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import {
  clearUnreadCompletion,
  completionIsCurrentlyVisible,
  markUnreadCompletion
} from './unread-completions'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import {
  isWriteAssistantThread,
  type WriteThreadRegistry
} from '../write/write-thread-registry'
import {
  isSddAssistantThread,
  type SddThreadRegistry
} from '../sdd/sdd-thread-registry'
import type { DesignThreadRegistry } from '../design/design-thread-registry'
import { isDesignWorkbenchThread } from '../design/design-task-classification'
import { readThreadWorktreeRegistry, saveThreadWorktreeRegistry, forgetThreadWorktree } from '../lib/thread-worktree-registry'
import { notifySddChatTranscriptMirror } from '../sdd/sdd-chat-transcript'
import { notifyDesignChatTranscriptMirror } from '../design/design-chat-transcript'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  flushLiveProjection,
  mergeToolProjectionEvents,
  reduceChatProjection,
  toolBlockChildId,
  toolEventChildId
} from './chat-projection-reducer'
import {
  completionProjectionEffects,
  terminalFailureProjectionEffects,
  type ChatProjectionEffect
} from './chat-projection-effects'
import {
  receiveGraphChildRuntimeEvent,
  receiveGraphPlanningRuntimeEvent,
  receiveGraphRuntimeEvent
} from '../graph/graph-store'
import {
  armBusyWatchdog as armBusyWatchdogImpl,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  syncTurnCompletionPoll as syncTurnCompletionPollImpl
} from './chat-store-schedulers'

export function releaseThreadWorktreeIfNeeded(threadId: string | null): void {
  if (!threadId || typeof window === 'undefined') return
  if (typeof window.kunGui?.releaseWorktree !== 'function') return
  const record = readThreadWorktreeRegistry().worktrees[threadId]
  if (!record) return
  if (record.poolIndex === undefined) return
  void window.kunGui
    .releaseWorktree({
      projectPath: record.projectPath,
      poolIndex: record.poolIndex
    })
    .catch(() => undefined) // best-effort
  saveThreadWorktreeRegistry(forgetThreadWorktree(threadId))
}

/**
 * Compute the patch that finalizes timing for the current in-progress turn.
 * No-op if there is no current turn or its start time was not recorded.
 */
export function finalizeTurnTiming(state: ChatState): Partial<ChatState> {
  const userId = state.currentTurnUserId
  if (!userId) return {}
  // Fall back to the persisted turn start recovered on hydration; a mid-turn
  // rehydrate clears turnStartedAtByUserId but keeps currentTurnStartedAtMs.
  const startedAt = state.turnStartedAtByUserId[userId] ?? state.currentTurnStartedAtMs ?? undefined
  if (typeof startedAt !== 'number') {
    return { currentTurnUserId: null }
  }
  return {
    currentTurnUserId: null,
    turnDurationByUserId: {
      ...state.turnDurationByUserId,
      [userId]: Math.max(0, Date.now() - startedAt)
    }
  }
}

export function flushLiveBlocks(state: ChatState, base: Partial<ChatState> = {}): Partial<ChatState> {
  return flushLiveProjection(state, Date.now(), base)
}

export function goalStatusText(status: string): string {
  switch (status) {
    case 'active':
      return i18n.t('common:goalStatusActive')
    case 'paused':
      return i18n.t('common:goalStatusPaused')
    case 'blocked':
      return i18n.t('common:goalStatusBlocked')
    case 'usageLimited':
      return i18n.t('common:goalStatusUsageLimited')
    case 'budgetLimited':
      return i18n.t('common:goalStatusBudgetLimited')
    case 'complete':
      return i18n.t('common:goalStatusComplete')
    default:
      return status
  }
}

export function goalTimelineText(goal: NonNullable<ChatState['activeThreadGoal']> | null, cleared?: boolean): string {
  if (!goal || cleared) return i18n.t('common:goalClearedTimeline')
  return i18n.t('common:goalUpdatedTimeline', {
    status: goalStatusText(goal.status),
    objective: goal.objective
  })
}

export function shouldOpenSettingsForError(error: unknown): boolean {
  return describeRuntimeError(error).settingsAction === 'agents'
}

export function looksLikeActiveTurnError(error: unknown): boolean {
  const code = getRuntimeErrorCode(error)
  if (code === 'thread_busy' || code === 'turn_in_progress') return true
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return raw.toLowerCase().includes('active turn')
}

export function isCodeThread(
  thread: NormalizedThread,
  clawChannels: ClawImChannelV1[] = [],
  writeRegistry?: WriteThreadRegistry,
  designRegistry?: DesignThreadRegistry,
  sddRegistry?: SddThreadRegistry
): boolean {
  return thread.archived !== true &&
    !isSddAssistantThread(thread, sddRegistry) &&
    isCodeSidebarThread(thread, clawChannels, writeRegistry, designRegistry, sddRegistry)
}

export function isCodeSidebarThread(
  thread: NormalizedThread,
  clawChannels: ClawImChannelV1[] = [],
  writeRegistry?: WriteThreadRegistry,
  designRegistry?: DesignThreadRegistry,
  sddRegistry?: SddThreadRegistry
): boolean {
  const workspace = normalizeWorkspaceRoot(thread.workspace)
  const designTask = isDesignWorkbenchThread(thread.id, thread, designRegistry)
  return Boolean(workspace) &&
    thread.agentSurface !== 'write' &&
    (thread.agentSurface !== 'design' || designTask) &&
    !isInternalTemporaryWorkspace(thread.workspace) &&
    !isInternalDeepSeekGuiWorkspace(thread.workspace) &&
    !isClawWorkspacePath(thread.workspace) &&
    !isClawThread(thread, clawChannels) &&
    !isWriteAssistantThread(thread, writeRegistry)
}

export function latestThread(threads: NormalizedThread[]): NormalizedThread | null {
  return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
}

export function normalizeFilePathForMatch(path?: string | null): string {
  return path?.trim().replace(/\\/g, '/').replace(/\/+$/, '') ?? ''
}

export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

export function resolveWriteToolFilePath(filePath: string | undefined, workspaceRoot: string): string {
  const raw = normalizeFilePathForMatch(filePath)
  if (!raw) return ''
  if (isAbsoluteFilePath(raw)) return raw
  return `${normalizeFilePathForMatch(workspaceRoot)}/${raw.replace(/^\.?\//, '')}`
}

export function notifyWriteWorkspaceFileRefresh(
  get: () => ChatState,
  event?: Pick<ToolEventPayload, 'filePath' | 'status' | 'toolKind'>
): void {
  if (get().route !== 'write') return
  if (event && (event.toolKind !== 'file_change' || event.status !== 'success')) return

  const writeState = useWriteWorkspaceStore.getState()
  const workspaceRoot = normalizeFilePathForMatch(writeState.workspaceRoot)
  const activeFilePath = normalizeFilePathForMatch(writeState.activeFilePath)
  if (!workspaceRoot || !activeFilePath) return

  const candidatePath = resolveWriteToolFilePath(event?.filePath, workspaceRoot)
  const hasCandidate = candidatePath.length > 0
  const candidateInWorkspace = hasCandidate
    ? candidatePath === workspaceRoot || candidatePath.startsWith(`${workspaceRoot}/`)
    : true
  if (!candidateInWorkspace) return

  void useWriteWorkspaceStore.getState().refreshWorkspace(workspaceRoot)

  if (hasCandidate && candidatePath !== activeFilePath) return
  void useWriteWorkspaceStore.getState().syncActiveFileFromDisk(workspaceRoot, {
    path: activeFilePath,
    animate: true,
    force: true,
    reviewAsDiff: true
  })
}

function toolEventMetaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toolEventSha256(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = toolEventMetaString(meta, key)
  return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined
}

export function publishLiveOfficePreviewForToolEvent(
  state: ChatState,
  event: ToolEventPayload,
  boundThreadId?: string
): void {
  const activeThreadId = state.activeThreadId?.trim()
  const workspaceRoot = state.threads.find((thread) => thread.id === activeThreadId)?.workspace?.trim()
    || state.workspaceRoot?.trim()
  if (
    state.route !== 'chat' ||
    !activeThreadId ||
    !workspaceRoot ||
    (boundThreadId && activeThreadId !== boundThreadId) ||
    event.toolKind !== 'file_change'
  ) return

  const current = state.blocks.find((block) => block.kind === 'tool' && block.id === event.itemId)
  const path = event.filePath ?? (current?.kind === 'tool' ? current.filePath : undefined)
  if (!isOfficePreviewPath(path)) return

  const meta = { ...(current?.kind === 'tool' ? current.meta : {}), ...(event.meta ?? {}) }
  const toolName = toolEventMetaString(meta, 'toolName')
  const turnId = event.turnId?.trim() ?? (current?.kind === 'tool' ? current.turnId?.trim() : undefined) ?? state.currentTurnId?.trim()
  if (!turnId) return

  const phase = event.status === 'running' ? 'editing' : event.status === 'success' ? 'committed' : 'failed'
  const expectedSha256 = toolName === 'office_edit'
    ? phase === 'committed'
      ? toolEventSha256(meta, 'afterSha256')
      : toolEventSha256(meta, 'expectedSha256')
    : undefined
  publishLiveOfficePreview({
    path,
    workspaceRoot,
    turnId,
    phase,
    ...(expectedSha256 ? { expectedSha256 } : {})
  })
}

export function compactGraphGateFailureSummary(value: string | undefined): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized) return ''
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized
}

export function runtimeStatusText(event: RuntimeStatusEventPayload): string {
  if (event.kind === 'tool_result_upload_wait') {
    return i18n.t('common:toolUploadWaitStatus', { count: event.toolResultCount ?? 0 })
  }
  if (event.kind === 'model_request_retry') {
    const key = event.retryReason === 'network'
      ? 'common:modelNetworkRetryStatus'
      : event.retryReason === 'stream_transport'
        ? 'common:modelStreamRetryStatus'
        : event.retryReason === 'context_overflow'
          ? 'common:modelContextOverflowRetryStatus'
          : 'common:modelRequestRetryStatus'
    return i18n.t(key, {
      status: event.status ?? '',
      attempt: event.attempt ?? 0,
      max: event.maxAttempts ?? 0,
      seconds: Math.ceil((event.delayMs ?? 0) / 1000)
    })
  }
  if (event.kind === 'tool_catalog_changed') {
    return event.message?.trim() || i18n.t('common:toolCatalogChangedStatus')
  }
  if (event.kind === 'tool_storm_suppressed') {
    return event.message?.trim() || i18n.t('common:toolStormSuppressedStatus', {
      tool: event.toolName ?? 'tool'
    })
  }
  if (event.kind === 'compaction_summary_fallback') {
    return event.message?.trim() || i18n.t('common:compactionSummaryFallbackStatus')
  }
  if (event.kind === 'required_tool_gate') {
    const key = event.phase === 'retrying'
      ? 'common:graphCreateRetryingStatus'
      : event.phase === 'succeeded'
        ? 'common:graphCreateSucceededStatus'
        : event.phase === 'failed'
          ? 'common:graphCreateFailedStatus'
          : 'common:graphCreatePreparingStatus'
    const base = i18n.t(key, {
      tool: event.toolName ?? 'tool',
      attempt: event.attempt ?? 0,
      max: event.maxAttempts ?? 0,
      retry: Math.max(1, (event.attempt ?? 1) - 1),
      retryMax: Math.max(1, (event.maxAttempts ?? 1) - 1)
    })
    const reason = compactGraphGateFailureSummary(event.failureSummary)
    return reason && (event.phase === 'retrying' || event.phase === 'failed')
      ? `${base} · ${i18n.t('common:graphCreateFailureReason', { reason })}`
      : base
  }
  return event.message?.trim() || ''
}

export function runtimeErrorPayloadToError(event: {
  message: string
  code?: string
  details?: unknown
  modelRequestFailure?: import('../agent/kun-contract').CoreModelRequestFailureJson
  severity?: string
}): Error {
  return new Error(JSON.stringify({
    ...(event.code ? { code: event.code } : {}),
    message: event.message,
    ...(event.details !== undefined ? { details: event.details } : {}),
    ...(event.modelRequestFailure ? { modelRequestFailure: event.modelRequestFailure } : {}),
    ...(event.severity ? { severity: event.severity } : {})
  }))
}

export function normalizeRuntimeErrorText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function sameRuntimeErrorContent(
  left: Extract<ChatBlock, { kind: 'system' }>,
  right: Extract<ChatBlock, { kind: 'system' }>
): boolean {
  return (
    left.severity === right.severity &&
    left.code === right.code &&
    JSON.stringify(left.modelRequestFailure) === JSON.stringify(right.modelRequestFailure) &&
    normalizeRuntimeErrorText(left.text) === normalizeRuntimeErrorText(right.text) &&
    normalizeRuntimeErrorText(left.detail) === normalizeRuntimeErrorText(right.detail)
  )
}

export function findSameTurnRuntimeErrorIndex(
  blocks: ChatBlock[],
  block: Extract<ChatBlock, { kind: 'system' }>
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const candidate = blocks[index]
    if (candidate.kind === 'user') break
    if (candidate.kind === 'system' && sameRuntimeErrorContent(candidate, block)) return index
  }
  return -1
}

export function upsertRuntimeErrorBlock(blocks: ChatBlock[], block: Extract<ChatBlock, { kind: 'system' }>): ChatBlock[] {
  const index = blocks.findIndex((candidate) => candidate.kind === 'system' && candidate.id === block.id)
  if (index < 0) {
    const duplicateIndex = findSameTurnRuntimeErrorIndex(blocks, block)
    if (duplicateIndex < 0) return [...blocks, block]
    const next = [...blocks]
    const existing = next[duplicateIndex]
    next[duplicateIndex] = {
      ...block,
      createdAt: existing?.createdAt ?? block.createdAt
    }
    return next
  }
  const next = [...blocks]
  next[index] = block
  return next
}

export function eventDetailRecord(event: ToolEventPayload): Record<string, unknown> | undefined {
  if (!event.detail?.trim()) return undefined
  try {
    const parsed = JSON.parse(event.detail) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export function isDetachedSubagentToolEvent(event: ToolEventPayload): boolean {
  const child = event.meta?.child
  if (child && typeof child === 'object' && (child as Record<string, unknown>).detached === true) {
    return true
  }
  return eventDetailRecord(event)?.detached === true
}
