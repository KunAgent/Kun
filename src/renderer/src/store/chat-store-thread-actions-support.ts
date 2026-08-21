import type { ChatBlock, ReviewTarget } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  showWorkspaceMissingDialog,
  workspaceDirectoryExists,
  workspaceMissingError
} from '../lib/workspace-availability'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import { isDeterministicKunRejection } from '@shared/runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import {
  markThreadWorktree,
  saveThreadWorktreeRegistry
} from '../lib/thread-worktree-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import {
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootScopeKey
} from '../lib/workspace-path'
import {
  buildClawRuntimePrompt,
  buildCodeRuntimePrompt,
  getActiveAgentApiKey,
  getKunRuntimeSettings
} from '@shared/app-settings'
import type {
  ChatState,
  ChatStoreGet,
  ChatStoreSet,
  QueuedUserMessage,
  WriteAssistantMessageContext
} from './chat-store-types'
import { queuedMessageGuidancePayload } from './queued-message-guidance'
import { currentTurnStartGeneration } from './turn-start-fence'
import {
  isPendingQueuedMessage,
  queuedMessagesForThread,
  reconcileQueuedMessages,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import {
  accountIdForComposerSelection,
  activeClawChannel,
  compactCodeWorkspaceRoots,
  composerReasoningEffortForSelection,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  composerModeForThread,
  readThreadComposerMode,
  rememberCodeWorkspaceRoots,
  rememberThreadComposerSelection,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadHasPendingRuntimeWork,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteThreadId,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeFileKey,
  writeThreadBelongsToWorkspace,
  writeWorkspaceForThreadId
} from '../write/write-thread-registry'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { useGraphStore } from '../graph/graph-store'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeSidebarThread,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
  readActiveWriteWorkspace,
  readWriteWorkspaceRoots,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import {
  getThreadSnapshot,
  invalidateThreadSnapshot,
  snapshotThreadProjection
} from './thread-snapshot-cache'
import {
  composerSelectionForThread,
  ensureRuntimeProviderForSend,
  fallbackComposerProviderIdForSend,
  subscribeThreadEventsWithRecovery
} from './chat-store-thread-action-helpers'
import { GitCheckpointAvailabilityCache } from '../lib/git-checkpoint-availability'
import { readDesignThreadRegistry } from '../design/design-thread-registry'
import { readSddThreadRegistry } from '../sdd/sdd-thread-registry'
import type { ComposerContextAttachment } from '@kun/extension-api'
import { mergeChatBlocks } from '../agent/kun-mapper'

const GUIDED_MESSAGE_RACE_WINDOW_MS = 5_000

export function hasRuntimeUserBlockForGuidance(
  blocks: ChatBlock[],
  message: { text: string; displayText?: string },
  turnId: string,
  requestStartedAt: number,
  requestCompletedAt: number
): boolean {
  const expectedTexts = new Set(
    [message.text, message.displayText]
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text))
  )
  return blocks.some((block) => {
    if (
      block.kind !== 'user' ||
      block.id.startsWith('q-') ||
      block.id.startsWith('graph-steering-')
    ) return false
    const blockTurnId = block.turnId?.trim() || block.meta?.turnId?.trim()
    if (blockTurnId !== turnId) return false
    const blockTexts = [block.text, block.meta?.displayText]
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text))
    if (!blockTexts.some((text) => expectedTexts.has(text))) return false
    const createdAt = block.createdAt ? Date.parse(block.createdAt) : Number.NaN
    return Number.isFinite(createdAt) &&
      createdAt >= requestStartedAt - GUIDED_MESSAGE_RACE_WINDOW_MS &&
      createdAt <= requestCompletedAt + GUIDED_MESSAGE_RACE_WINDOW_MS
  })
}

export function prependOlderHistoryBlocks(
  current: readonly ChatBlock[],
  older: readonly ChatBlock[]
): ChatBlock[] {
  const currentIds = new Set(current.map((block) => block.id))
  const olderTools = new Map(
    older.flatMap((block) => block.kind === 'tool' ? [[block.id, block] as const] : [])
  )
  const mergedCurrent = current.map((block) => {
    const olderTool = block.kind === 'tool' ? olderTools.get(block.id) : undefined
    return olderTool ? mergeChatBlocks([olderTool, block])[0]! : block
  })
  return [
    ...older.filter((block) => !currentIds.has(block.id)),
    // Preserve the current page's order while enriching a result whose call
    // item fell on the preceding page.
    ...mergedCurrent
  ]
}

export type SseAbortRef = { current: AbortController | null }

export type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

export const threadActionSharedState = {
  drainingQueuedMessageThreadIds: new Set<string>(),
  guidingQueuedMessageIds: new Set<string>(),
  expandedHistoryThreadIds: new Set<string>(),
  checkpointGitAvailability: new GitCheckpointAvailabilityCache()
}

type RuntimeAdmissionWaiter = {
  promise: Promise<boolean>
  settle: (accepted: boolean) => void
}

const runtimeAdmissionWaiters = new Map<string, RuntimeAdmissionWaiter>()

export function waitForRuntimeTurnAdmission(clientRequestId: string): Promise<boolean> {
  const existing = runtimeAdmissionWaiters.get(clientRequestId)
  if (existing) return existing.promise
  let settle!: (accepted: boolean) => void
  const promise = new Promise<boolean>((resolve) => { settle = resolve })
  runtimeAdmissionWaiters.set(clientRequestId, { promise, settle })
  return promise
}

export function hasRuntimeTurnAdmissionWaiter(clientRequestId: string | undefined): boolean {
  return Boolean(clientRequestId && runtimeAdmissionWaiters.has(clientRequestId))
}

export function settleRuntimeTurnAdmission(
  clientRequestId: string | undefined,
  accepted: boolean
): void {
  if (!clientRequestId) return
  const waiter = runtimeAdmissionWaiters.get(clientRequestId)
  if (!waiter) return
  runtimeAdmissionWaiters.delete(clientRequestId)
  waiter.settle(accepted)
}

export function createWorkspaceCheckpointRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `gcp_${Date.now()}_${random}`
}

export function createClientTurnRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `turn_${random}`
}

export function pendingQueuedMessage(message: QueuedUserMessage): QueuedUserMessage {
  const pending = {
    ...message,
    deliveryState: 'pending' as const,
    ...(message.designProfile
      ? {
          designProfile: {
            ...message.designProfile,
            documentTarget: { ...message.designProfile.documentTarget },
            ...(message.designProfile.styleSnapshot
              ? { styleSnapshot: { ...message.designProfile.styleSnapshot } }
              : {}),
            context: {
              ...message.designProfile.context,
              tone: [...message.designProfile.context.tone]
            }
          }
        }
      : {}),
    ...(message.designDocumentTarget
      ? { designDocumentTarget: { ...message.designDocumentTarget } }
      : {}),
    ...(message.designImagePlacementTarget
      ? { designImagePlacementTarget: { ...message.designImagePlacementTarget } }
      : {})
  }
  delete pending.deliveryTurnId
  delete pending.deliveryUserMessageItemId
  return pending
}

export function upsertQueuedSubmission(
  messages: readonly QueuedUserMessage[],
  submission: QueuedUserMessage
): QueuedUserMessage[] {
  const pending = pendingQueuedMessage(submission)
  const existingIndex = messages.findIndex((message) =>
    message.id === pending.id ||
    Boolean(
      pending.clientRequestId &&
      message.clientRequestId === pending.clientRequestId
    )
  )
  if (existingIndex < 0) return [...messages, pending]
  return messages.map((message, index) => index === existingIndex
    ? { ...message, ...pending, id: message.id }
    : message)
}

export function startingQueuedSubmission(
  messages: readonly QueuedUserMessage[],
  submission: QueuedUserMessage
): QueuedUserMessage[] {
  const pending = upsertQueuedSubmission(messages, submission)
  return pending.map((message) => message.id === submission.id
    ? { ...message, deliveryState: 'starting' as const }
    : message)
}

/** Mark one queued submission terminal with the structured rejection view. */
export function failQueuedSubmission(
  messages: readonly QueuedUserMessage[],
  id: string,
  view: { code?: string; message?: string }
): QueuedUserMessage[] {
  return messages.map((message) =>
    message.id === id
      ? {
          ...message,
          deliveryState: 'failed' as const,
          ...(view.code ? { errorCode: view.code } : {}),
          ...(view.message ? { errorMessage: view.message } : {})
        }
      : message
  )
}

/** Return one queued submission to pending so a scheduled retry can re-drive it. */
export function resetQueuedSubmission(
  messages: readonly QueuedUserMessage[],
  id: string
): QueuedUserMessage[] {
  return messages.map((message) =>
    message.id === id ? pendingQueuedMessage(message) : message
  )
}

export function turnAdmissionOutcomeMayBeUnknown(error: unknown): boolean {
  const code = getRuntimeErrorCode(error)
  if (code) {
    // Deterministic client rejections have a known outcome: retrying the
    // identical request cannot succeed. Fail them once instead of recovering.
    if (isDeterministicKunRejection(code)) return false
    return code === 'unknown' || code === 'runtime_offline' || code === 'internal_error'
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  // A renderer-side 4xx response is a definitive rejection, even when a
  // legacy endpoint did not supply a structured code.
  return !/\bHTTP\s+4\d\d\b/i.test(message)
}

const MAX_UNKNOWN_OUTCOME_ATTEMPTS = 5
const UNKNOWN_OUTCOME_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
const unknownOutcomeAttempts = new Map<string, { count: number; nextAttemptAt: number }>()

/**
 * Backoff/circuit breaker for unknown send outcomes. Each failed attempt
 * schedules the next one with exponential delay; after the cap the submission
 * is terminal (`failed`) and only an explicit user retry can re-drive it.
 */
export function scheduleUnknownOutcomeRetry(key: string): { retryable: boolean; delayMs: number } {
  const entry = unknownOutcomeAttempts.get(key) ?? { count: 0, nextAttemptAt: 0 }
  if (entry.count >= MAX_UNKNOWN_OUTCOME_ATTEMPTS) {
    return { retryable: false, delayMs: 0 }
  }
  const delayMs = UNKNOWN_OUTCOME_BACKOFF_MS[Math.min(
    entry.count,
    UNKNOWN_OUTCOME_BACKOFF_MS.length - 1
  )]
  unknownOutcomeAttempts.set(key, {
    count: entry.count + 1,
    nextAttemptAt: Date.now() + delayMs
  })
  return { retryable: true, delayMs }
}

export function resetUnknownOutcomeAttempts(key: string): void {
  unknownOutcomeAttempts.delete(key)
}

export function localConversationErrorBlock(error: unknown, id: string): Extract<ChatBlock, { kind: 'system' }> {
  const view = describeRuntimeError(error)
  // The localized summary is the primary text; the raw (often English) runtime
  // message stays in `detail` so it never lands in a global banner unlocalized.
  const detail = view.message && view.message !== view.summary
    ? `${view.message}${view.detail ? `\n\n${view.detail}` : ''}`
    : view.detail
  return {
    kind: 'system',
    id,
    createdAt: new Date().toISOString(),
    text: view.summary,
    ...(view.code ? { code: view.code } : {}),
    ...(detail ? { detail } : {}),
    severity: 'error',
    runtimeError: true
  }
}

export function activeChatWorkspaceRoot(state: ChatState): string {
  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)
    : undefined
  return activeThread?.workspace?.trim() || state.workspaceRoot?.trim() || ''
}

export function pendingComposerContexts(state: ChatState): ComposerContextAttachment[] {
  if (state.route !== 'chat') return []
  const workspaceRoot = activeChatWorkspaceRoot(state)
  return state.extensionComposerContexts
    .filter((event) =>
      workspaceRootScopeKey(event.workspaceRoot) === workspaceRootScopeKey(workspaceRoot) &&
      (!event.threadId || event.threadId === state.activeThreadId)
    )
    .map((event) => event.attachment)
}

export function withoutConsumedComposerContexts(
  state: ChatState,
  consumed: readonly ComposerContextAttachment[]
): ChatState['extensionComposerContexts'] {
  if (consumed.length === 0) return state.extensionComposerContexts
  const consumedRevisions = new Set(consumed.map((attachment) => [
    attachment.attachmentId,
    attachment.revision,
    attachment.generation
  ].join(':')))
  return state.extensionComposerContexts.filter((event) => !consumedRevisions.has([
    event.attachment.attachmentId,
    event.attachment.revision,
    event.attachment.generation
  ].join(':')))
}

export function activeWriteMessageContextMatches(context: WriteAssistantMessageContext): boolean {
  const state = useWriteWorkspaceStore.getState()
  const whiteboardMatches = context.whiteboardId
    ? Boolean(
        Number.isInteger(context.whiteboardRevision) &&
        state.activeWhiteboardId === context.whiteboardId &&
        state.whiteboards[context.whiteboardId]?.revision === context.whiteboardRevision &&
        state.whiteboards[context.whiteboardId]?.threadId === (context.threadId ?? null)
      )
    : state.activeWhiteboardId === null
  return (
    whiteboardMatches &&
    writeFileKey(state.workspaceRoot) === writeFileKey(context.workspaceRoot) &&
    writeFileKey(state.activeFilePath) === writeFileKey(context.activeFilePath) &&
    state.documentEpoch === context.documentEpoch &&
    state.contentRevision === context.contentRevision &&
    state.saveStatus === 'saved' &&
    state.fileContent === state.persistedContent &&
    state.pendingAgentReview === null &&
    !state.reviewActive
  )
}

export type ThreadActionRuntime = {
  threadSelectionGeneration: number
  persistActiveQueuedMessages: () => void
}
