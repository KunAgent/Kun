import type { ThreadGoal, ThreadGoalStatus, ThreadTodoList, ThreadTodoStatus } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { confirmDialog } from '../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import { requestCodeCanvasPanelOpen } from '../lib/code-canvas-panel-event'
import {
  prepareCodeCanvasResend,
  type PrepareCodeCanvasResendOptions,
  type PreparedCodeCanvasResend
} from '../design/canvas/code-canvas-resend'
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
  forgetThreadWorktree,
  readThreadWorktreeRegistry,
  saveThreadWorktreeRegistry
} from '../lib/thread-worktree-registry'
import {
  forgetQueuedMessagesForThread,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import { invalidatePendingTurnStarts } from './turn-start-fence'

/**
 * Release the worktree pool slot owned by a thread when the task completes
 * or is interrupted. Fire-and-forget — a failure must not block the UI.
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
    .catch(() => undefined)
  saveThreadWorktreeRegistry(forgetThreadWorktree(threadId))
}

import { workspaceLabelFromPath } from '../lib/workspace-label'
import { isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import { buildClawRuntimePrompt, getActiveAgentApiKey } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  activeClawChannel,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  readStoredComposerModel,
  rememberCodeWorkspaceRoots,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadLooksRunning,
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
  writeThreadBelongsToWorkspace,
  writeWorkspaceForThreadId
} from '../write/write-thread-registry'
import {
  designDocKey,
  forgetDesignThread,
  readDesignThreadRegistry,
  replaceDesignThreadsForDocument,
  saveDesignThreadRegistry
} from '../design/design-thread-registry'
import {
  beginDesignChatHistoryMutation,
  deleteDesignChatDirForDoc,
  deleteDesignChatTranscriptForThread,
  endDesignChatHistoryMutation,
  persistDesignChatMetaForDoc
} from '../design/design-chat-transcript'
import { flushDesignPersistenceQueue } from '../design/design-persistence-coordinator'
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
  watchTurnCompletionNotification
} from './chat-store-runtime'
import {
  extractPlanTodos,
  mergePlanTodosForRenderer,
  sameTodoWriteItems,
  threadTodoWriteItems
} from '../plan/plan-todo-sync'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

function applyGoalSnapshot(
  set: ChatStoreSet,
  threadId: string,
  goal: ThreadGoal | null,
  updatedAt = new Date().toISOString()
): void {
  set((s) => ({
    activeThreadGoal: s.activeThreadId === threadId ? goal : s.activeThreadGoal,
    threads: s.threads.map((thread) =>
      thread.id === threadId
        ? { ...thread, goal, updatedAt: goal?.updatedAt ?? updatedAt }
        : thread
    )
  }))
}

function applyTodosSnapshot(
  set: ChatStoreSet,
  threadId: string,
  todos: ThreadTodoList | null,
  updatedAt = new Date().toISOString()
): void {
  set((s) => ({
    activeThreadTodos: s.activeThreadId === threadId ? todos : s.activeThreadTodos,
    threads: s.threads.map((thread) =>
      thread.id === threadId
        ? { ...thread, todos, updatedAt: todos?.updatedAt ?? updatedAt }
        : thread
    )
  }))
}

function settleInterruptedTurn(set: ChatStoreSet, get: ChatStoreGet): void {
  resetBusyRecoveryAttempts()
  clearBusyWatchdog()
  const threadId = get().activeThreadId
  set((s) => {
    const out = flushLiveBlocks(s, {
      ...finalizeTurnTiming(s),
      busy: false,
      busyUnconfirmed: false,
      currentTurnId: null,
      currentTurnOrchestration: null,
      currentTurnUserId: null,
      error: null
    })
    const watchTurnCompletion = { ...s.watchTurnCompletion }
    const unreadThreadIds = { ...s.unreadThreadIds }
    if (threadId) {
      delete watchTurnCompletion[threadId]
      delete unreadThreadIds[threadId]
    }
    const queuedMessages = s.queuedMessages.map((message) => {
      if (message.deliveryState && message.deliveryState !== 'pending') return message
      const paused = { ...message, deliveryState: 'paused' as const }
      delete paused.deliveryTurnId
      delete paused.deliveryUserMessageItemId
      return paused
    })
    const blocks = settlePendingRuntimeWorkAfterInterrupt(out.blocks ?? s.blocks)
    return {
      ...out,
      blocks,
      queuedMessages,
      watchTurnCompletion,
      unreadThreadIds,
      threads: threadId
        ? s.threads.map((thread) => thread.id === threadId
            ? { ...thread, status: 'idle' as const, latestTurnStatus: 'aborted' as const }
            : thread)
        : s.threads
    }
  })
  if (threadId) {
    clearWatchedCompletionNotification(threadId)
    invalidateThreadSnapshot(threadId)
    saveQueuedMessagesForThread(threadId, get().queuedMessages)
    releaseThreadWorktreeIfNeeded(threadId)
  }
}

export type MaintenanceActionDependencies = {
  prepareCodeCanvasResend?: (
    options: PrepareCodeCanvasResendOptions
  ) => Promise<PreparedCodeCanvasResend | null>
  requestCodeCanvasPanelOpen?: () => void
  deleteDesignChatDirForDoc?: typeof deleteDesignChatDirForDoc
  deleteDesignChatTranscriptForThread?: typeof deleteDesignChatTranscriptForThread
  persistDesignChatMetaForDoc?: typeof persistDesignChatMetaForDoc
  flushDesignPersistenceQueue?: typeof flushDesignPersistenceQueue
}

/**
 * Checkpoint create/restore identity must follow the thread workspace, not the
 * currently selected global workspace picker. Multi-project sidebars can keep
 * one thread open under DeepSeek-GUI while `workspaceRoot` still points at
 * another project (e.g. KunUIExtend).
 */
function resolveCheckpointExpectedWorkspaceRoot(state: {
  activeThreadId: string | null
  threads: Array<{ id: string; workspace?: string | null }>
  workspaceRoot: string
}): string {
  const threadWorkspace = state.threads.find((thread) => thread.id === state.activeThreadId)?.workspace
  return normalizeWorkspaceRoot(threadWorkspace) || normalizeWorkspaceRoot(state.workspaceRoot)
}

export function createMaintenanceInteractionActions(
  { set, get, sseAbortRef }: StoreActionContext,
  dependencies: MaintenanceActionDependencies = {}
): Pick<ChatState, 'resolveApproval' | 'resolveUserInput' | 'interrupt' | 'cancelToolCall'> {
  const prepareCanvasResend = dependencies.prepareCodeCanvasResend ?? prepareCodeCanvasResend
    const openCodeCanvasPanel =
      dependencies.requestCodeCanvasPanelOpen ?? requestCodeCanvasPanelOpen
    const deleteDesignChatDir =
      dependencies.deleteDesignChatDirForDoc ?? deleteDesignChatDirForDoc
    const deleteDesignChatTranscript =
      dependencies.deleteDesignChatTranscriptForThread ?? deleteDesignChatTranscriptForThread
    const persistDesignChatMeta =
      dependencies.persistDesignChatMetaForDoc ?? persistDesignChatMetaForDoc
    const flushDesignPersistence =
      dependencies.flushDesignPersistenceQueue ?? flushDesignPersistenceQueue
    const forkActiveThreadWithOptions = async (options: { turnId?: string } = {}): Promise<void> => {
      const { activeThreadId, busy, blocks } = get()
      if (!activeThreadId) return
      if (busy) {
        set({ error: i18n.t('common:threadActionBusy') })
        return
      }
      if (get().runtimeConnection !== 'ready') {
        set({ error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      const p = getProvider()
      if (typeof p.forkThread !== 'function') {
        set({ error: i18n.t('common:runtimeFeatureUnsupported') })
        return
      }
      const turnId = options.turnId?.trim()
      try {
        const parentThread =
          get().threads.find((thread) => thread.id === activeThreadId) ?? {
            id: activeThreadId,
            title: activeThreadId.slice(0, 8)
          }
        const forked = await p.forkThread(activeThreadId, turnId ? { turnId } : undefined)
        saveThreadForkRegistry(
          markThreadFork(
            forked.id,
            parentThread,
            {
              createdAt: forked.forkedAt ?? new Date().toISOString(),
              forkedFromMessageCount: forked.forkedFromMessageCount ?? forkedMessageCount(blocks),
              forkedFromTurnCount: forked.forkedFromTurnCount ?? forkedTurnCount(blocks)
            },
            readThreadForkRegistry()
          )
        )
        await get().refreshThreads()
        await get().selectThread(forked.id)
      } catch (e) {
        set({
          error: formatRuntimeError(e),
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    }
  return {
  resolveApproval: async (blockId, decision) => {
    const { blocks } = get()
    const block = blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'approval' || block.status !== 'pending') return
    const p = getProvider()
    if (typeof p.submitApprovalDecision !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    set((s) => ({
      blocks: s.blocks.map((b) =>
        b.id === blockId && b.kind === 'approval' && b.status === 'pending'
          ? { ...b, status: 'submitting' as const, errorMessage: undefined }
          : b
      )
    }))
    try {
      const outcome = await p.submitApprovalDecision(
        block.approvalId,
        decision === 'allow' ? 'allow' : 'deny',
        true
      )
      if (outcome === 'cancelled') {
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === blockId && b.kind === 'approval' && b.status === 'submitting'
              ? {
                  ...b,
                  status: 'pending' as const,
                  errorMessage: i18n.t('common:approvalNativeConfirmationCancelled')
                }
              : b
          )
        }))
        return
      }
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval' && b.status === 'submitting'
            ? { ...b, status: decision === 'allow' ? ('allowed' as const) : ('denied' as const) }
            : b
        )
      }))
    } catch (e) {
      const stillSubmitting = get().blocks.some((b) =>
        b.id === blockId && b.kind === 'approval' && b.status === 'submitting'
      )
      if (!stillSubmitting) return
      const msg = formatRuntimeError(e)
      void window.kunGui.logError('approval', 'Failed to submit approval decision', {
        message: msg,
        blockId
      }).catch(() => undefined)
      set((s) => ({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {}),
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval' && b.status === 'submitting'
            ? { ...b, status: 'error' as const, errorMessage: msg }
            : b
        )
      }))
    }
  },

  resolveUserInput: async (blockId, action) => {
    const { blocks } = get()
    const block = blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'user_input' || block.status !== 'pending') return
    const p = getProvider()
    try {
      if (action.kind === 'submit') {
        const state = get()
        if (typeof p.submitUserInputResponse !== 'function') {
          throw new Error(i18n.t('common:runtimeUserInputUnsupported'))
        }
        try {
          await p.submitUserInputResponse(block.requestId, action.answers)
        } catch (fallbackErr) {
          const activeThreadId = state.activeThreadId
          const currentTurnId = state.currentTurnId
          if (
            getRuntimeErrorCode(fallbackErr) === 'runtime_request_user_input_unsupported' &&
            typeof p.interruptTurn === 'function' &&
            activeThreadId &&
            currentTurnId
          ) {
            const followupText = buildFollowupMessageFromUserInput(block.questions, action.answers)
            set((s) => ({
              queuedMessages: [
                ...s.queuedMessages,
                {
                  id: `q-${Date.now()}-${s.queuedMessages.length}`,
                  text: followupText,
                  deliveryState: 'pending' as const
                }
              ],
              blocks: s.blocks.map((b) =>
                b.id === blockId && b.kind === 'user_input'
                  ? { ...b, status: 'submitted' as const, answers: action.answers }
                  : b
              )
            }))
            saveQueuedMessagesForThread(activeThreadId, get().queuedMessages)
            await p.interruptTurn(activeThreadId, currentTurnId)
            settleInterruptedTurn(set, get)
            void get().refreshThreads()
            void get().drainQueuedMessages()
            return
          }
          throw fallbackErr
        }
        if (get().busy) armBusyWatchdog(set, get)
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === blockId && b.kind === 'user_input'
              ? { ...b, status: 'submitted' as const, answers: action.answers }
              : b
          )
        }))
        return
      }

      if (typeof p.cancelUserInput !== 'function') {
        throw new Error(i18n.t('common:runtimeUserInputUnsupported'))
      }
      await p.cancelUserInput(block.requestId)
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'user_input'
            ? { ...b, status: 'cancelled' as const }
            : b
        )
      }))
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.kunGui.logError('user-input', 'Failed to resolve user input', {
        message: msg,
        blockId
      }).catch(() => undefined)
      set((s) => ({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {}),
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'user_input'
            ? {
                ...b,
                status: 'error' as const,
                errorMessage: msg,
                // Keep the chosen answers on the record so the read-only bubble
                // still echoes what the user picked when a submit RPC fails,
                // mirroring the success / interrupt-fallback paths above.
                ...(action.kind === 'submit' ? { answers: action.answers } : {})
              }
            : b
        )
      }))
    }
  },

  interrupt: async (options) => {
    const { activeThreadId, currentTurnId, busy } = get()
    if (!activeThreadId || (!currentTurnId && !busy)) return
    invalidatePendingTurnStarts()
    const p = getProvider()
    // Settle the UI before notifying the runtime: a slow or hung
    // interruptTurn must not keep the stop button unresponsive. The event
    // stream is aborted first because onDeltas/onTool flip `busy` back on
    // while the backend turn is still streaming.
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    settleInterruptedTurn(set, get)
    try {
      if (currentTurnId) {
        await p.interruptTurn(activeThreadId, currentTurnId, { discard: options?.discard === true })
      }
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.kunGui.logError('interrupt', 'Failed to interrupt turn', { message: msg }).catch(() => undefined)
      set({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
    void get().refreshThreads()
    // Re-sync from the runtime snapshot and re-subscribe the event stream
    // aborted above; recoverActiveTurn also drains queued messages once the
    // thread is idle. Skip when the user already moved on to another thread
    // or a newer stream owns the subscription.
    if (get().activeThreadId === activeThreadId && sseAbortRef.current === null) {
      await get().recoverActiveTurn()
    }
  },

  cancelToolCall: async (threadId, turnId, callId) => {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    const normalizedCallId = callId.trim()
    if (!normalizedThreadId || !normalizedTurnId || !normalizedCallId) return false
    const p = getProvider()
    if (typeof p.cancelToolCall !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      await p.cancelToolCall(normalizedThreadId, normalizedTurnId, normalizedCallId)
      return true
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.kunGui.logError('tool-cancel', 'Failed to cancel tool call', {
        message: msg,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId,
        callId: normalizedCallId
      }).catch(() => undefined)
      set({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  }
  }
}
