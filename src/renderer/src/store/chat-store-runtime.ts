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
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import {
  isWriteAssistantThread,
  type WriteThreadRegistry
} from '../write/write-thread-registry'
import {
  isSddAssistantThread,
  type SddThreadRegistry
} from '../sdd/sdd-thread-registry'
import { isDesignThreadId, type DesignThreadRegistry } from '../design/design-thread-registry'
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

const BUSY_WATCHDOG_MS = 180_000
const MAX_BUSY_RECOVERY_ATTEMPTS = 3
const MAX_RUNTIME_EVENT_TIMER_AGE_MS = 30 * 60_000
const CLOCK_SKEW_TOLERANCE_MS = 5_000
const RUNTIME_STREAM_RECOVERING_KEY = 'common:runtimeStreamRecovering'
const LEGACY_RUNTIME_STREAM_RECOVERING_VALUE = 'runtimeStreamRecovering'
const COMPLETION_NOTIFICATION_DEDUPE_LIMIT = 200
export const MAX_WATCHED_COMPLETION_NOTIFICATIONS = 200
export const MAX_PENDING_CLAW_FEISHU_MIRRORS = 50
export const MAX_PENDING_CHILD_TOOL_UPDATES = 200
const completionNotificationKeys: string[] = []
const completionNotificationKeySet = new Set<string>()
const watchCompletionNotificationKeys = new Map<string, string>()
const watchCompletionNotificationSources = new Map<string, TurnCompleteNotificationSource>()

export type PendingClawFeishuMirror = {
  threadId: string
  userBlockId: string
  userText: string
}

const pendingClawFeishuMirrors = new Map<string, PendingClawFeishuMirror>()

export function watchTurnCompletionNotification(
  threadId: string,
  now = Date.now(),
  source: TurnCompleteNotificationSource = 'main-agent'
): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  watchCompletionNotificationKeys.delete(normalizedThreadId)
  watchCompletionNotificationSources.delete(normalizedThreadId)
  watchCompletionNotificationKeys.set(normalizedThreadId, `watch:${normalizedThreadId}:${now}`)
  watchCompletionNotificationSources.set(normalizedThreadId, source)
  while (watchCompletionNotificationKeys.size > MAX_WATCHED_COMPLETION_NOTIFICATIONS) {
    const oldestThreadId = watchCompletionNotificationKeys.keys().next().value
    if (!oldestThreadId) break
    watchCompletionNotificationKeys.delete(oldestThreadId)
    watchCompletionNotificationSources.delete(oldestThreadId)
  }
}

export function completionNotificationDedupeKeyForWatchedThread(
  threadId: string | null | undefined,
  now = Date.now()
): string {
  const normalizedThreadId = threadId?.trim()
  if (!normalizedThreadId) return `watch:unknown:${now}`
  return watchCompletionNotificationKeys.get(normalizedThreadId) ?? `watch:${normalizedThreadId}:${now}`
}

export function clearWatchedCompletionNotifications(): void {
  watchCompletionNotificationKeys.clear()
  watchCompletionNotificationSources.clear()
}

export function rememberPendingClawFeishuMirror(
  turnId: string,
  mirror: PendingClawFeishuMirror
): void {
  const normalizedTurnId = turnId.trim()
  const normalizedMirror = {
    threadId: mirror.threadId.trim(),
    userBlockId: mirror.userBlockId.trim(),
    userText: mirror.userText.trim()
  }
  if (
    !normalizedTurnId ||
    !normalizedMirror.threadId ||
    !normalizedMirror.userBlockId ||
    !normalizedMirror.userText
  ) {
    return
  }
  pendingClawFeishuMirrors.delete(normalizedTurnId)
  pendingClawFeishuMirrors.set(normalizedTurnId, normalizedMirror)
  while (pendingClawFeishuMirrors.size > MAX_PENDING_CLAW_FEISHU_MIRRORS) {
    const oldestTurnId = pendingClawFeishuMirrors.keys().next().value
    if (!oldestTurnId) break
    pendingClawFeishuMirrors.delete(oldestTurnId)
  }
}

export function takePendingClawFeishuMirror(
  turnId: string | null | undefined
): PendingClawFeishuMirror | undefined {
  const normalizedTurnId = turnId?.trim()
  if (!normalizedTurnId) return undefined
  const mirror = pendingClawFeishuMirrors.get(normalizedTurnId)
  pendingClawFeishuMirrors.delete(normalizedTurnId)
  return mirror
}

export function clearPendingClawFeishuMirrors(): void {
  pendingClawFeishuMirrors.clear()
}

export function buildFollowupMessageFromUserInput(
  questions: UserInputQuestion[],
  answers: Array<{ id: string; label: string; value?: string; values?: string[] }>
): string {
  const isZh = i18n.language.toLowerCase().startsWith('zh')
  const title = isZh
    ? '上一个回合请求了 request_user_input，但当前运行时无法通过 HTTP 直接提交该工具结果。请把下面的用户回答当作 request_user_input 的结果继续执行：'
    : 'The previous turn requested request_user_input, but this runtime cannot submit that tool result over HTTP. Please treat the answers below as the request_user_input result and continue:'
  const unansweredLabel = isZh ? '（未回答）' : '(not answered)'
  const answerPrefix = isZh ? '回答: ' : 'Answer: '
  const noAnswerLabel = isZh ? '用户未提供问题回答。' : 'User did not provide answers.'
  if (questions.length === 0 || answers.length === 0) {
    return noAnswerLabel
  }
  const answerById = new Map<string, string>(
    answers.map((answer) => [
      answer.id,
      answer.values && answer.values.length > 0
        ? answer.values.join(', ')
        : answer.value || answer.label
    ])
  )
  const lines = [title]
  for (const question of questions) {
    const answerValue = answerById.get(question.id)
    const responseLine = answerValue ? `${answerPrefix}${answerValue}` : unansweredLabel
    lines.push(`${question.header}: ${question.question}`, responseLine)
  }
  return lines.join('\n')
}

function isUserInputInterruptError(message: string | undefined): boolean {
  const lowered = message?.toLowerCase() ?? ''
  return lowered.includes('cancel') && lowered.includes('awaiting user input')
}

function isInterruptSettledError(error: unknown, message: string): boolean {
  const code = getRuntimeErrorCode(error)
  if (code === 'aborted') return true
  if (isUserInputInterruptError(message)) return true
  const lowered = message.toLowerCase()
  return lowered.includes('interrupted') ||
    lowered.includes('aborted') ||
    lowered.includes('cancelled') ||
    lowered.includes('canceled')
}

export async function readActiveWriteWorkspace(fallbackWorkspaceRoot: string): Promise<string> {
  try {
    const settings = await rendererRuntimeClient.getSettings()
    return normalizeWorkspaceRoot(
      settings.write.activeWorkspaceRoot ||
      settings.write.defaultWorkspaceRoot ||
      settings.write.workspaces[0] ||
      fallbackWorkspaceRoot
    )
  } catch {
    return normalizeWorkspaceRoot(fallbackWorkspaceRoot)
  }
}

export async function readWriteWorkspaceRoots(): Promise<string[]> {
  try {
    const settings = await rendererRuntimeClient.getSettings()
    const roots = [
      settings.write.defaultWorkspaceRoot,
      settings.write.activeWorkspaceRoot,
      ...settings.write.workspaces
    ]
      .map((workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot))
      .filter(Boolean)
    return [...new Set(roots)]
  } catch {
    return []
  }
}

export function runtimeErrorDetail(error: unknown): string {
  const view = describeRuntimeError(error)
  if (view.detail) return view.detail
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return raw === view.summary ? '' : raw
}

export function runtimeStreamRecoveringMessage(): string {
  return i18n.t(RUNTIME_STREAM_RECOVERING_KEY)
}

function isRuntimeStreamRecoveringError(error: string | null | undefined): boolean {
  return (
    error === runtimeStreamRecoveringMessage() ||
    error === LEGACY_RUNTIME_STREAM_RECOVERING_VALUE ||
    error === RUNTIME_STREAM_RECOVERING_KEY
  )
}

function clearRuntimeStreamRecoveringError(error: string | null): string | null {
  return isRuntimeStreamRecoveringError(error) ? null : error
}

function runtimeEventStartedAt(createdAt: string | undefined, now = Date.now()): number {
  if (!createdAt) return now
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return now
  if (parsed > now + CLOCK_SKEW_TOLERANCE_MS) return now
  if (now - parsed > MAX_RUNTIME_EVENT_TIMER_AGE_MS) return now
  return parsed
}

export function forkedMessageCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'user' || block.kind === 'assistant').length
}

export function forkedTurnCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'user').length
}

function rememberCompletionNotificationKey(key: string): boolean {
  if (!key) return true
  if (completionNotificationKeySet.has(key)) return false
  completionNotificationKeySet.add(key)
  completionNotificationKeys.push(key)
  while (completionNotificationKeys.length > COMPLETION_NOTIFICATION_DEDUPE_LIMIT) {
    const stale = completionNotificationKeys.shift()
    if (stale) completionNotificationKeySet.delete(stale)
  }
  return true
}

export function clearWatchedCompletionNotification(threadId: string): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  watchCompletionNotificationKeys.delete(normalizedThreadId)
  watchCompletionNotificationSources.delete(normalizedThreadId)
}

export function turnCompleteNotificationSource(
  threadId: string,
  state: Pick<ChatState, 'threads'> &
    Partial<Pick<ChatState, 'activeThreadId' | 'activeThreadRelation' | 'sideConversations'>>
): TurnCompleteNotificationSource {
  return (
    state.threads.find((thread) => thread.id === threadId)?.relation === 'side' ||
    (state.activeThreadId === threadId && state.activeThreadRelation === 'side') ||
    Boolean(state.sideConversations?.[threadId])
  )
    ? 'subagent'
    : 'main-agent'
}

function notifyTurnComplete(
  threadId: string | null,
  state: ChatState,
  dedupeKey: string,
  source?: TurnCompleteNotificationSource
): void {
  if (
    !threadId ||
    typeof window === 'undefined' ||
    typeof window.kunGui?.showTurnCompleteNotification !== 'function'
  ) {
    return
  }
  if (!rememberCompletionNotificationKey(dedupeKey)) return

  const threadTitle =
    state.threads.find((thread) => thread.id === threadId)?.title?.trim() ||
    i18n.t('common:untitledThread')

  void window.kunGui
    .showTurnCompleteNotification({
      threadId,
      source: source ?? turnCompleteNotificationSource(threadId, state),
      title: i18n.t('common:turnCompleteNotificationTitle'),
      body: i18n.t('common:turnCompleteNotificationBody', { title: threadTitle })
    })
    .then((result) => {
      if (result.ok || typeof window.kunGui?.logError !== 'function') return
      void window.kunGui.logError('notification', 'Turn completion notification failed', {
        message: result.message,
        threadId
      }).catch(() => undefined)
    })
    .catch((error: unknown) => {
      if (typeof window.kunGui?.logError !== 'function') return
      void window.kunGui.logError('notification', 'Turn completion notification failed', {
        message: error instanceof Error ? error.message : String(error),
        threadId
      }).catch(() => undefined)
    })
}

/**
 * Release the worktree pool slot owned by a thread when the task completes.
 * This makes worktree slots task-scoped (like Talkcody) rather than
 * thread-scoped: the slot is returned to the pool as soon as the agent
 * finishes responding, so the same slot can be reused by a future task.
 *
 * Fire-and-forget — a failure to release must not disrupt the UI flow.
 * The deleteThread action still releases as a safety-net fallback.
 */
function releaseThreadWorktreeIfNeeded(threadId: string | null): void {
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
  const startedAt = state.turnStartedAtByUserId[userId]
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

function goalStatusText(status: string): string {
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

function goalTimelineText(goal: NonNullable<ChatState['activeThreadGoal']> | null, cleared?: boolean): string {
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
  return Boolean(workspace) &&
    !isInternalTemporaryWorkspace(thread.workspace) &&
    !isInternalDeepSeekGuiWorkspace(thread.workspace) &&
    !isClawWorkspacePath(thread.workspace) &&
    !isClawThread(thread, clawChannels) &&
    !isWriteAssistantThread(thread, writeRegistry) &&
    !isDesignThreadId(thread.id, designRegistry)
}

export function latestThread(threads: NormalizedThread[]): NormalizedThread | null {
  return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
}

function normalizeFilePathForMatch(path?: string | null): string {
  return path?.trim().replace(/\\/g, '/').replace(/\/+$/, '') ?? ''
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

function resolveWriteToolFilePath(filePath: string | undefined, workspaceRoot: string): string {
  const raw = normalizeFilePathForMatch(filePath)
  if (!raw) return ''
  if (isAbsoluteFilePath(raw)) return raw
  return `${normalizeFilePathForMatch(workspaceRoot)}/${raw.replace(/^\.?\//, '')}`
}

function notifyWriteWorkspaceFileRefresh(
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

function compactGraphGateFailureSummary(value: string | undefined): string {
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

function runtimeErrorPayloadToError(event: {
  message: string
  code?: string
  details?: unknown
  severity?: string
}): Error {
  return new Error(JSON.stringify({
    ...(event.code ? { code: event.code } : {}),
    message: event.message,
    ...(event.details !== undefined ? { details: event.details } : {}),
    ...(event.severity ? { severity: event.severity } : {})
  }))
}

function normalizeRuntimeErrorText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function sameRuntimeErrorContent(
  left: Extract<ChatBlock, { kind: 'system' }>,
  right: Extract<ChatBlock, { kind: 'system' }>
): boolean {
  return (
    left.severity === right.severity &&
    left.code === right.code &&
    normalizeRuntimeErrorText(left.text) === normalizeRuntimeErrorText(right.text) &&
    normalizeRuntimeErrorText(left.detail) === normalizeRuntimeErrorText(right.detail)
  )
}

function findSameTurnRuntimeErrorIndex(
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

function upsertRuntimeErrorBlock(blocks: ChatBlock[], block: Extract<ChatBlock, { kind: 'system' }>): ChatBlock[] {
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

function eventDetailRecord(event: ToolEventPayload): Record<string, unknown> | undefined {
  if (!event.detail?.trim()) return undefined
  try {
    const parsed = JSON.parse(event.detail) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function isDetachedSubagentToolEvent(event: ToolEventPayload): boolean {
  const child = event.meta?.child
  if (child && typeof child === 'object' && (child as Record<string, unknown>).detached === true) {
    return true
  }
  return eventDetailRecord(event)?.detached === true
}

export function armBusyWatchdog(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  armBusyWatchdogImpl(set, get, {
    timeoutMs: BUSY_WATCHDOG_MS,
    maxAttempts: MAX_BUSY_RECOVERY_ATTEMPTS,
    finalizeBusyState: finalizeTurnTiming,
    // Settle stuck running/pending blocks alongside the live flush: a
    // timed-out turn that leaves a tool block "running" keeps
    // hasPendingRuntimeWork true, which queues every later message
    // forever ("queued, sends after current reply") with nothing to
    // drain it.
    flushLiveBlocks: (state, base) => {
      const flushed = flushLiveBlocks(state, base)
      const blocks = settlePendingRuntimeWorkAfterInterrupt(flushed.blocks ?? state.blocks)
      return { ...flushed, blocks }
    },
    busyTimeoutMessage: () => i18n.t('common:busyTimeout', { minutes: Math.round((BUSY_WATCHDOG_MS * MAX_BUSY_RECOVERY_ATTEMPTS) / 60_000) })
  })
}

export function syncTurnCompletionPoll(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  syncTurnCompletionPollImpl(set, get, {
    loadThreadState: async (state, threadId) => {
      const provider = getProvider()
      return provider.getThreadDetail(threadId)
    },
    threadLooksRunning: threadSnapshotLooksRunning,
    onCompletedThreads: async (doneIds, state, setState, getState) => {
      for (const id of doneIds) {
        notifyTurnComplete(
          id,
          state,
          completionNotificationDedupeKeyForWatchedThread(id),
          watchCompletionNotificationSources.get(id)
        )
        clearWatchedCompletionNotification(id)
      }
      setState((snapshot) => {
        const watchTurnCompletion = { ...snapshot.watchTurnCompletion }
        const unreadThreadIds = { ...snapshot.unreadThreadIds }
        for (const id of doneIds) {
          delete watchTurnCompletion[id]
          unreadThreadIds[id] = true
        }
        return { watchTurnCompletion, unreadThreadIds }
      })
      void getState().refreshThreads()
    }
  })
}

export type ThreadEventSinkBinding = {
  threadId?: string
  signal?: AbortSignal
  /**
   * Seq the subscription replays from. Deltas at or below this floor are
   * duplicates of text already in the timeline (a replayed backlog or a
   * re-delivered live event) and are dropped instead of appended, so a
   * stale cursor can no longer re-stream the whole conversation into the
   * live bubble.
   */
  sinceSeq?: number
  getThreadDetail?: AgentProvider['getThreadDetail']
}

async function reconcileCompletedTurnFromThreadDetail(input: {
  threadId: string | null | undefined
  turnId: string | null | undefined
  userBlockId: string | null | undefined
  loadThreadDetail: AgentProvider['getThreadDetail']
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
}): Promise<void> {
  const threadId = input.threadId?.trim()
  if (!threadId) return

  try {
    const detail = await input.loadThreadDetail(threadId)
    const loaded = hydrateBlockModelLabels(threadId, detail.blocks)

    input.set((state) => reduceChatProjection(state, {
      type: 'thread_snapshot_reconciled',
      payload: {
        threadId,
        blocks: loaded,
        latestSeq: detail.latestSeq,
        threadStatus: detail.threadStatus,
        goal: detail.goal,
        todos: detail.todos,
        turnId: input.turnId,
        userBlockId: input.userBlockId
      }
    }, {
      now: Date.now(),
      clearRecoveringError: clearRuntimeStreamRecoveringError,
      goalTimelineText,
      runtimeStatusText,
      runtimeErrorView: (event) => describeRuntimeError(runtimeErrorPayloadToError(event)),
      upsertRuntimeError: upsertRuntimeErrorBlock,
      formatRuntimeError,
      runtimeErrorDetail,
      isInterruptSettledError,
      settlePendingRuntimeWork: settlePendingRuntimeWorkAfterInterrupt,
      threadSnapshotLooksRunning
    }))
  } catch (error) {
    if (typeof window === 'undefined') return
    void window.kunGui?.logError?.('turn-completion-reconcile', 'Failed to reconcile completed turn', {
      message: error instanceof Error ? error.message : String(error),
      threadId
    }).catch(() => undefined)
  }
}

export function buildThreadEventSink(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  binding: ThreadEventSinkBinding = {}
): ThreadEventSink {
  const boundThreadId = binding.threadId?.trim() ?? ''
  let appliedDeltaSeqFloor = binding.sinceSeq ?? 0
  // Update-only child lifecycle events can race their parent tool card. Keep
  // that short-lived repair state inside this one stream so reconnects and
  // other threads cannot consume each other's child ids.
  const pendingChildToolUpdates = new Map<string, ToolEventPayload>()
  const loadThreadDetail = binding.getThreadDetail ?? ((threadId: string) => getProvider().getThreadDetail(threadId))
  const isCurrentStream = (): boolean => {
    if (binding.signal?.aborted) return false
    return !boundThreadId || get().activeThreadId === boundThreadId
  }
  const reduce = (state: ChatState, action: Parameters<typeof reduceChatProjection>[1]): Partial<ChatState> =>
    reduceChatProjection(state, action, {
      now: Date.now(),
      clearRecoveringError: clearRuntimeStreamRecoveringError,
      goalTimelineText,
      runtimeStatusText,
      runtimeErrorView: (event) => describeRuntimeError(runtimeErrorPayloadToError(event)),
      upsertRuntimeError: upsertRuntimeErrorBlock,
      formatRuntimeError,
      runtimeErrorDetail,
      isInterruptSettledError,
      settlePendingRuntimeWork: settlePendingRuntimeWorkAfterInterrupt,
      threadSnapshotLooksRunning
    })
  const runEffects = (effects: readonly ChatProjectionEffect[]): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'arm_stream_watchdog':
          armBusyWatchdog(set, get)
          break
        case 'refresh_write_workspace':
          notifyWriteWorkspaceFileRefresh(get, effect.event)
          break
        case 'mirror_claw_reply':
          if (typeof window.kunGui?.mirrorClawChannelMessage === 'function') {
            void window.kunGui.mirrorClawChannelMessage(effect.threadId, effect.text, 'assistant')
              .catch(() => undefined)
          }
          break
        case 'notify_turn_complete':
          notifyTurnComplete(effect.threadId, effect.state, effect.dedupeKey)
          break
        case 'mirror_sdd_transcript':
          notifySddChatTranscriptMirror(get)
          break
        case 'mirror_design_transcript':
          notifyDesignChatTranscriptMirror(get)
          break
        case 'sync_completion_poll':
          syncTurnCompletionPoll(set, get)
          break
        case 'reload_completed_turn':
          void reconcileCompletedTurnFromThreadDetail({
            threadId: effect.threadId,
            turnId: effect.turnId,
            userBlockId: effect.userBlockId,
            loadThreadDetail,
            set,
            get
          })
          break
        case 'refresh_threads':
          void get().refreshThreads?.()
          break
        case 'release_worktree':
          releaseThreadWorktreeIfNeeded(effect.threadId)
          break
        case 'drain_queued_messages':
          void get().drainQueuedMessages?.()
          break
      }
    }
  }

  return {
    onSeq: (seq) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      // Re-arm the busy watchdog on every live tick so it behaves as an
      // *inactivity* timer rather than an absolute one. onSeq fires for
      // every SSE batch — both content events and the runtime's 15s
      // heartbeat (kun events route) — so a healthy turn always keeps the
      // watchdog postponed, even a long-running tool call that produces no
      // output for minutes. Recovery ("正在恢复运行时事件流…") then only
      // triggers after the heartbeat genuinely stops for BUSY_WATCHDOG_MS
      // (a dead stream), instead of on any turn that simply runs past it.
      if (get().busy) armBusyWatchdog(set, get)
      // Monotonic: heartbeats and replays must never rewind the cursor —
      // a rewound lastSeq becomes the next subscription's since_seq and
      // replays history.
      set((s) => ({
        lastSeq: Math.max(s.lastSeq, seq),
        error: clearRuntimeStreamRecoveringError(s.error)
      }))
    },
    onUserMessage: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'user_message_received', payload: event }))
    },
    onDeltas: (rawDeltas) => {
      if (!isCurrentStream()) return
      const deltas: typeof rawDeltas = []
      for (const delta of rawDeltas) {
        if (typeof delta.seq === 'number') {
          if (delta.seq <= appliedDeltaSeqFloor) continue
          appliedDeltaSeqFloor = delta.seq
        }
        deltas.push(delta)
      }
      if (deltas.length === 0) return
      resetBusyRecoveryAttempts()
      if (!get().busy) armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'deltas_received', deltas }))
    },
    onAssistantItem: (item) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'assistant_item_upserted', payload: item }))
    },
    onTool: (event) => {
      if (!isCurrentStream()) return
      runEffects([{ type: 'refresh_write_workspace', event }])
      resetBusyRecoveryAttempts()
      if (!get().busy && !event.updateOnly && !isDetachedSubagentToolEvent(event)) {
        armBusyWatchdog(set, get)
      }
      set((state) => {
        const eventChildId = toolEventChildId(event)
        const existing = state.blocks.some((block) =>
          block.kind === 'tool' && (
            block.id === event.itemId ||
            Boolean(eventChildId && toolBlockChildId(block) === eventChildId)
          )
        )
        if (!existing && event.updateOnly) {
          if (eventChildId) {
            pendingChildToolUpdates.delete(eventChildId)
            pendingChildToolUpdates.set(eventChildId, event)
            while (pendingChildToolUpdates.size > MAX_PENDING_CHILD_TOOL_UPDATES) {
              const oldestChildId = pendingChildToolUpdates.keys().next().value
              if (!oldestChildId) break
              pendingChildToolUpdates.delete(oldestChildId)
            }
          }
          return {}
        }
        let projectedEvent = event
        if (!existing && eventChildId) {
          const pending = pendingChildToolUpdates.get(eventChildId)
          if (pending) {
            pendingChildToolUpdates.delete(eventChildId)
            projectedEvent = mergeToolProjectionEvents(event, pending)
          }
        }
        return reduce(state, { type: 'tool_updated', payload: projectedEvent })
      })
    },
    onCompaction: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (!get().busy && event.status === 'running') armBusyWatchdog(set, get)
      if (get().busy && event.status !== 'running' && !get().currentTurnId) clearBusyWatchdog()
      set((state) => reduce(state, { type: 'compaction_updated', payload: event }))
    },
    onReview: (event: ReviewEventPayload) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (!get().busy && event.status === 'running') armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'review_updated', payload: event }))
    },
    onApproval: (request) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'approval_received', payload: request }))
    },
    onApprovalStatus: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'approval_status_changed', payload: event }))
    },
    onApprovalReview: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (!get().busy && event.status === 'in-progress') armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'approval_review_updated', payload: event }))
    },
    onUserInput: (request) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      set((state) => reduce(state, { type: 'user_input_requested', payload: request }))
    },
    onUserInputStatus: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (event.status === 'submitted' && get().busy) armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'user_input_status_changed', payload: event }))
    },
    onRuntimeStatus: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (!get().busy) armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'runtime_status_received', payload: event }))
    },
    onRuntimeError: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'runtime_error_received', payload: event }))
    },
    onGoal: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'goal_changed', payload: event }))
    },
    onTodos: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'todos_changed', payload: event }))
    },
    onThreadUpdated: (event) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, { type: 'thread_metadata_changed', payload: event }))
    },
    onTurnComplete: (event) => {
      if (!isCurrentStream()) return
      const terminalThreadId = event?.threadId?.trim()
      const terminalTurnId = event?.turnId?.trim()
      if (terminalThreadId && boundThreadId && terminalThreadId !== boundThreadId) return
      if (terminalTurnId && get().currentTurnId && get().currentTurnId !== terminalTurnId) return
      // Reconnect/replay can deliver the same terminal event after the first
      // projection already cleared the active turn. Treat it as a no-op so
      // notifications, mirrors, workspace refreshes and queue drains remain
      // once-only for one completion identity.
      if (!get().busy && !get().currentTurnId) {
        if (terminalThreadId) {
          set((state) => reduce(state, {
            type: 'turn_completed',
            threadId: terminalThreadId,
            ...(terminalTurnId ? { turnId: terminalTurnId } : {})
          }))
        }
        return
      }
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const completedState = get()
      const completedThreadId = completedState.activeThreadId
      const completedTurnId = completedState.currentTurnId
      const completedUserBlockId = completedState.currentTurnUserId
      const completedKey = completedState.currentTurnId
        ? `turn:${completedState.currentTurnId}`
        : `active:${completedThreadId ?? 'unknown'}:${completedState.lastSeq}`
      const pendingMirror = takePendingClawFeishuMirror(completedTurnId)
      const assistantMirrorText =
        pendingMirror
          ? collectAssistantTextForTurn(
              completedState.blocks,
              pendingMirror.userBlockId,
              completedState.liveAssistant
            )
          : ''
      set((state) => reduce(state, {
        type: 'turn_completed',
        ...(terminalThreadId ? { threadId: terminalThreadId } : {}),
        ...(terminalTurnId ? { turnId: terminalTurnId } : {})
      }))
      if (completedThreadId) clearWatchedCompletionNotification(completedThreadId)
      runEffects(completionProjectionEffects({
        state: completedState,
        threadId: completedThreadId,
        turnId: completedTurnId,
        userBlockId: completedUserBlockId,
        dedupeKey: completedKey,
        mirrorText: pendingMirror && assistantMirrorText ? assistantMirrorText : undefined,
        mirrorThreadId: pendingMirror?.threadId,
        reconcile: true,
        releaseWorktree: !get().queuedMessages.some(isPendingQueuedMessage)
      }))
    },
    onError: (err, options) => {
      if (!isCurrentStream()) return
      if (options?.terminal && options.threadId?.trim() && boundThreadId && options.threadId.trim() !== boundThreadId) return
      if (options?.terminal && options.turnId?.trim() && get().currentTurnId && get().currentTurnId !== options.turnId.trim()) {
        return
      }
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const state = get()
      const terminal = options?.terminal === true
      takePendingClawFeishuMirror(state.currentTurnId)
      set((current) => reduce(current, { type: 'turn_failed', error: err, options }))
      if (terminal && state.activeThreadId) {
        clearWatchedCompletionNotification(state.activeThreadId)
        void reconcileCompletedTurnFromThreadDetail({
          threadId: state.activeThreadId,
          turnId: state.currentTurnId,
          userBlockId: state.currentTurnUserId,
          loadThreadDetail,
          set,
          get
        })
      }
      if (terminal) {
        runEffects(terminalFailureProjectionEffects(
          state.activeThreadId,
          !get().queuedMessages.some(isPendingQueuedMessage)
        ))
        return
      }
      // Re-arm the watchdog so a stuck SSE stream doesn't leave the UI
      // permanently in the busy state.
      if (get().busy) runEffects([{ type: 'arm_stream_watchdog' }])
    },
    onUsage: (usage) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, { type: 'usage_received', payload: usage }))
    },
    onContextSnapshot: (snapshot) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, { type: 'context_snapshot_received', payload: snapshot }))
    },
    onDelegatedRuntimeState: (runtimeState) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, {
        type: 'delegated_runtime_received',
        payload: runtimeState
      }))
    },
    onChildRuntimeEvent: (event) => {
      if (!isCurrentStream()) return
      receiveGraphChildRuntimeEvent(event)
    },
    onGraphEvent: (event) => {
      if (!isCurrentStream()) return
      receiveGraphRuntimeEvent(event)
    },
    onGraphPlanningEvent: (event) => {
      if (!isCurrentStream()) return
      receiveGraphPlanningRuntimeEvent(event)
    }
  }
}
