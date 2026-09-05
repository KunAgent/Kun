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
  threadLooksRunning,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import {
  clearUnreadCompletion,
  completionIsCurrentlyVisible,
  markUnreadCompletion
} from './unread-completions'
import { isAutoPlanIntermediatePlanCompletion } from '../plan/auto-plan-build-intents'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
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

export const BUSY_WATCHDOG_MS = 180_000
export const MAX_BUSY_RECOVERY_ATTEMPTS = 3
export const MAX_RUNTIME_EVENT_TIMER_AGE_MS = 30 * 60_000
export const CLOCK_SKEW_TOLERANCE_MS = 5_000
export const RUNTIME_STREAM_RECOVERING_KEY = 'common:runtimeStreamRecovering'
export const LEGACY_RUNTIME_STREAM_RECOVERING_VALUE = 'runtimeStreamRecovering'
export const COMPLETION_NOTIFICATION_DEDUPE_LIMIT = 200
export const MAX_WATCHED_COMPLETION_NOTIFICATIONS = 200
export const MAX_PENDING_CLAW_FEISHU_MIRRORS = 50
export const MAX_PENDING_CHILD_TOOL_UPDATES = 200
export const completionNotificationKeys: string[] = []
export const completionNotificationKeySet = new Set<string>()
export const watchCompletionNotificationKeys = new Map<string, string>()
export const watchCompletionNotificationSources = new Map<string, TurnCompleteNotificationSource>()
const lastCompletionWatchTimeByThread = new Map<string, number>()
let completionWatchGeneration = 0

export type PendingClawFeishuMirror = {
  threadId: string
  userBlockId: string
  userText: string
}

export const pendingClawFeishuMirrors = new Map<string, PendingClawFeishuMirror>()

export function watchTurnCompletionNotification(
  threadId: string,
  now = Date.now(),
  source: TurnCompleteNotificationSource = 'main-agent'
): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  watchCompletionNotificationKeys.delete(normalizedThreadId)
  watchCompletionNotificationSources.delete(normalizedThreadId)
  completionWatchGeneration += 1
  const sameTick = lastCompletionWatchTimeByThread.get(normalizedThreadId) === now
  lastCompletionWatchTimeByThread.set(normalizedThreadId, now)
  watchCompletionNotificationKeys.set(
    normalizedThreadId,
    `watch:${normalizedThreadId}:${now}${sameTick ? `:${completionWatchGeneration}` : ''}`
  )
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

/**
 * The opaque watch-generation token for a thread, when a background completion
 * watch is currently armed. Consumers compare a token captured at request start
 * against the current token at commit time to reject results from an older
 * watch that was removed and re-created for a newer turn.
 */
export function currentCompletionWatchToken(threadId: string | null | undefined): string | undefined {
  const normalizedThreadId = threadId?.trim()
  if (!normalizedThreadId) return undefined
  return watchCompletionNotificationKeys.get(normalizedThreadId)
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

export function isUserInputInterruptError(message: string | undefined): boolean {
  const lowered = message?.toLowerCase() ?? ''
  return lowered.includes('cancel') && lowered.includes('awaiting user input')
}

export function isInterruptSettledError(error: unknown, message: string): boolean {
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

export function isRuntimeStreamRecoveringError(error: string | null | undefined): boolean {
  return (
    error === runtimeStreamRecoveringMessage() ||
    error === LEGACY_RUNTIME_STREAM_RECOVERING_VALUE ||
    error === RUNTIME_STREAM_RECOVERING_KEY
  )
}

export function clearRuntimeStreamRecoveringError(error: string | null): string | null {
  return isRuntimeStreamRecoveringError(error) ? null : error
}

export function runtimeEventStartedAt(createdAt: string | undefined, now = Date.now()): number {
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

export function rememberCompletionNotificationKey(key: string): boolean {
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

export function notifyTurnComplete(
  threadId: string | null,
  state: ChatState,
  dedupeKey: string,
  source?: TurnCompleteNotificationSource,
  turnId?: string | null
): void {
  if (
    !threadId ||
    typeof window === 'undefined' ||
    typeof window.kunGui?.showTurnCompleteNotification !== 'function'
  ) {
    return
  }
  // The intermediate plan turn of an Automatic plan-and-build handoff is not
  // a user-facing completion: it would fire a "task done" notification right
  // before the build turn begins. Suppress it so the final build turn keeps
  // the ordinary once-only notification semantics.
  if (isAutoPlanIntermediatePlanCompletion(threadId, turnId)) return
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
 * Alert the user that a turn is parked on a user_input gate. Fires only when
 * the asking thread is not the one currently visible (e.g. a background watch
 * or after switching away); the asking thread itself shows the composer panel,
 * the awaiting progress row, and the top-bar badge instead.
 */
export function notifyUserInputAwaiting(
  threadId: string | null,
  state: ChatState,
  dedupeKey: string
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
      source: turnCompleteNotificationSource(threadId, state),
      title: i18n.t('common:userInputNotificationTitle'),
      body: i18n.t('common:userInputNotificationBody', { title: threadTitle })
    })
    .catch((error: unknown) => {
      if (typeof window.kunGui?.logError !== 'function') return
      void window.kunGui.logError('notification', 'User-input awaiting notification failed', {
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
