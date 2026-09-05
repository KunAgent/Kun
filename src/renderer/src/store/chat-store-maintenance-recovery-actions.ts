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
  forgetStoredThreadRightPanelExpansion
} from '../lib/thread-right-panel-expansion'
import {
  forgetThreadWorktree,
  readThreadWorktreeRegistry,
  saveThreadWorktreeRegistry
} from '../lib/thread-worktree-registry'
import {
  forgetQueuedMessagesForThread,
  pauseQueuedMessagesForInterrupt,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import { emptyLiveProjection } from './chat-store-live-projection'
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
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
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
import { threadTodoWriteItems } from '../plan/plan-todo-sync'

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
      currentTurnStartedAtMs: null,
      error: null
    })
    const watchTurnCompletion = { ...s.watchTurnCompletion }
    const unreadThreadIds = { ...s.unreadThreadIds }
    if (threadId) {
      delete watchTurnCompletion[threadId]
      delete unreadThreadIds[threadId]
    }
    // Interrupted turns never auto-drain the runtime queue; undelivered
    // entries pause until the user resumes the queue explicitly.
    const queuedMessages = pauseQueuedMessagesForInterrupt(s.queuedMessages)
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

export function createMaintenanceRecoveryActions(
  { set, get, sseAbortRef }: StoreActionContext,
  dependencies: MaintenanceActionDependencies = {}
): Pick<ChatState, 'deleteThread' | 'rewindAndResend' | 'rollbackWorkspaceToCheckpoint'> {
  const rewindAndResendInFlight = new Set<string>()
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
  deleteThread: async (threadId) => {
    const targetId = threadId.trim()
    if (!targetId) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { activeThreadId } = get()
    const p = getProvider()
    const deletingActive = activeThreadId === targetId
    // Release the worktree pool slot if this thread owned one. Best-effort:
    // a failure to release must not block thread deletion.
    const wtRecord = readThreadWorktreeRegistry().worktrees[targetId]
    if (wtRecord?.poolIndex !== undefined) {
      try {
        await window.kunGui.releaseWorktree({
          projectPath: wtRecord.projectPath,
          poolIndex: wtRecord.poolIndex
        })
      } catch {
        /* best-effort; the slot can be reclaimed later via Settings */
      }
    }
    try {
      await p.deleteThread(targetId)
      invalidateThreadSnapshot(targetId)
      forgetQueuedMessagesForThread(targetId)
      saveWriteThreadRegistry(forgetWriteThread(targetId))
      await useWriteWorkspaceStore.getState().forgetWhiteboardThread(targetId)
      saveDesignThreadRegistry(forgetDesignThread(targetId))
      saveThreadForkRegistry(forgetThreadFork(targetId))
      forgetStoredThreadRightPanelExpansion(targetId)
      if (wtRecord) saveThreadWorktreeRegistry(forgetThreadWorktree(targetId))
      if (deletingActive) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
      }
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        delete w[targetId]
        clearWatchedCompletionNotification(targetId)
        const u = { ...s.unreadThreadIds }
        delete u[targetId]
        return {
          threads: s.threads.filter((thread) => thread.id !== targetId),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(deletingActive ? clearedThreadSelection() : {}),
          error: null
        }
      })
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  rewindAndResend: async (userBlockId, newText) => {
    const trimmed = newText.trim()
    if (!trimmed) return
    const state = get()
    if (state.busy) {
      set({ error: i18n.t('common:rewindBusyError') })
      return
    }
    const idx = state.blocks.findIndex((b) => b.id === userBlockId && b.kind === 'user')
    if (idx < 0) return
    const targetBlock = state.blocks[idx]
    if (targetBlock?.kind !== 'user') return
    const turnId = targetBlock.meta?.turnId
    if (!state.activeThreadId || !turnId) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    const p = getProvider()
    if (typeof p.rewindThread !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    const threadId = state.activeThreadId
    const operationKey = JSON.stringify([threadId, targetBlock.id])
    if (rewindAndResendInFlight.has(operationKey)) return
    rewindAndResendInFlight.add(operationKey)
    try {
      const checkpointId = targetBlock.meta?.workspaceCheckpointId
      if (checkpointId) {
        const expectedWorkspaceRoot = resolveCheckpointExpectedWorkspaceRoot(state)
        const restored = await window.kunGui.restoreGitCheckpoint({
          checkpointId,
          expectedThreadId: threadId,
          ...(expectedWorkspaceRoot ? { expectedWorkspaceRoot } : {})
        }).catch((error) => ({
          ok: false as const,
          reason: 'error' as const,
          message: error instanceof Error ? error.message : String(error)
        }))
        if (!restored.ok) {
          set({ error: restored.message })
          return
        }
      }

      const trimmedBlocks = state.blocks.slice(0, idx)
      const attachmentIds = [...new Set([
        ...(targetBlock.meta?.attachmentIds ?? []),
        ...(targetBlock.meta?.attachments ?? []).map((attachment) => attachment.id)
      ].map((id) => id.trim()).filter(Boolean))]
      const attachments = (targetBlock.meta?.attachments ?? []).filter((attachment) =>
        attachment.id.trim().length > 0
      )
      const composerContexts = targetBlock.meta?.composerContexts ?? []
      const attachmentOverrides = {
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(composerContexts.length ? { composerContexts } : {})
      }

      const droppedUserIds = state.blocks
        .slice(idx)
        .filter((b) => b.kind === 'user')
        .map((b) => b.id)
      const turnStartedAtByUserId = { ...state.turnStartedAtByUserId }
      const turnDurationByUserId = { ...state.turnDurationByUserId }
      const turnReasoningFirstAtByUserId = { ...state.turnReasoningFirstAtByUserId }
      const turnReasoningLastAtByUserId = { ...state.turnReasoningLastAtByUserId }
      for (const id of droppedUserIds) {
        delete turnStartedAtByUserId[id]
        delete turnDurationByUserId[id]
        delete turnReasoningFirstAtByUserId[id]
        delete turnReasoningLastAtByUserId[id]
      }

      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()

      const canvasResend = await prepareCanvasResend({
        route: state.route,
        text: trimmed,
        previousCanvasTurn: targetBlock.meta?.guiDesignCanvas === true,
        fallbackWorkspaceRoot: state.workspaceRoot,
        threadWorkspaceRoot: state.threads.find(
          (thread) => thread.id === state.activeThreadId
        )?.workspace,
        threadId
      })
      if (canvasResend) openCodeCanvasPanel()
      await p.rewindThread(threadId, turnId)
      invalidateThreadSnapshot(threadId)
      set({
        blocks: trimmedBlocks,
        ...emptyLiveProjection(state.lastSeq),
        currentTurnId: null,
        currentTurnOrchestration: null,
        currentTurnUserId: null,
        currentTurnStartedAtMs: null,
        turnStartedAtByUserId,
        turnDurationByUserId,
        turnReasoningFirstAtByUserId,
        turnReasoningLastAtByUserId,
        error: null
      })
      if (canvasResend) {
        await get().sendMessage(canvasResend.text, 'agent', {
          displayText: canvasResend.displayText,
          guiDesignCanvas: true,
          ...attachmentOverrides
        })
      } else if (attachmentIds.length > 0 || composerContexts.length > 0) {
        await get().sendMessage(trimmed, undefined, attachmentOverrides)
      } else {
        await get().sendMessage(trimmed)
      }
    } catch (e) {
      const message = formatRuntimeError(e)
      // Rewind can lose a race with a server-started continuation. The SSE
      // stream was stopped before the mutation, so rehydrate the authoritative
      // turn and resubscribe before surfacing the localized conflict.
      if (get().activeThreadId === threadId) {
        await get().recoverActiveTurn().catch(() => false)
      }
      set({ error: message })
    } finally {
      rewindAndResendInFlight.delete(operationKey)
    }
  },

  rollbackWorkspaceToCheckpoint: async (checkpointId) => {
    const targetCheckpointId = checkpointId.trim()
    if (!targetCheckpointId) {
      set({ error: i18n.t('common:rollbackWorkspaceMissingCheckpoint') })
      return
    }
    if (get().busy) {
      set({ error: i18n.t('common:rollbackWorkspaceBusyError') })
      return
    }
    const confirmed = await confirmDialog(
      i18n.t('common:rollbackWorkspaceConfirm'),
      i18n.t('common:rollbackWorkspaceConfirmDetail')
    )
    if (!confirmed) return
    // Re-check busy: the user may have typed and sent a new turn while the
    // confirm dialog was open. Running `git reset --hard` mid-turn would
    // wipe files the running agent is actively editing.
    if (get().busy) {
      set({ error: i18n.t('common:rollbackWorkspaceBusyError') })
      return
    }
    const state = get()
    const { activeThreadId } = state
    const expectedWorkspaceRoot = resolveCheckpointExpectedWorkspaceRoot(state)
    let restored = await window.kunGui.restoreGitCheckpoint({
      checkpointId: targetCheckpointId,
      ...(activeThreadId ? { expectedThreadId: activeThreadId } : {}),
      ...(expectedWorkspaceRoot ? { expectedWorkspaceRoot } : {})
    }).catch((error) => ({
      ok: false as const,
      reason: 'error' as const,
      message: error instanceof Error ? error.message : String(error)
    }))
    // A partial checkpoint skipped some untracked files (too large to capture).
    // Restoring would delete them, so the main process refuses unless the user
    // opts in. Surface the at-risk files and, on confirmation, retry with the
    // opt-in (the main process then takes a full rescue checkpoint first).
    if (!restored.ok && restored.reason === 'partial') {
      const skipped = 'skippedUntracked' in restored && Array.isArray(restored.skippedUntracked)
        ? restored.skippedUntracked
        : []
      const preview = skipped.slice(0, 10).join(', ') + (skipped.length > 10 ? ` … (+${skipped.length - 10})` : '')
      const proceed = await confirmDialog(
        i18n.t('common:rollbackWorkspacePartialConfirm'),
        i18n.t('common:rollbackWorkspacePartialConfirmDetail', { files: preview })
      )
      if (!proceed) {
        set({ error: null })
        return
      }
      if (get().busy) {
        set({ error: i18n.t('common:rollbackWorkspaceBusyError') })
        return
      }
      restored = await window.kunGui
        .restoreGitCheckpoint({
          checkpointId: targetCheckpointId,
          allowPartialRestore: true,
          ...(activeThreadId ? { expectedThreadId: activeThreadId } : {}),
          ...(expectedWorkspaceRoot ? { expectedWorkspaceRoot } : {})
        })
        .catch((error) => ({
          ok: false as const,
          reason: 'error' as const,
          message: error instanceof Error ? error.message : String(error)
        }))
    }
    if (!restored.ok) {
      // The checkpoint was evicted by the hard retention cap / disk quota
      // (issue #1156). The message keeps its reference; surface the dedicated
      // expired-rollback message instead of a raw error.
      if (restored.reason === 'not_found') {
        set({ error: i18n.t('common:rollbackWorkspaceExpired') })
        return
      }
      set({ error: restored.message })
      return
    }
    // Surface the rescue checkpoint id so the user can `git stash apply` it
    // (or hand-copy from the data dir) if the rollback turns out to have
    // been a mistake. The destructive ops above already happened.
    const rescueId =
      'rescueCheckpointId' in restored && typeof restored.rescueCheckpointId === 'string'
        ? restored.rescueCheckpointId
        : null
    console.info(
      '[rollback] rescue checkpoint:',
      rescueId,
      'workspace:',
      expectedWorkspaceRoot,
      'thread:',
      activeThreadId
    )
    set({ error: null })
  },
  }
}
