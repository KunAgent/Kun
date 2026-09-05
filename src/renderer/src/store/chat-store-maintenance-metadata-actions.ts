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
  readThreadForkRegistry
} from '../lib/thread-fork-registry'
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
  createForkActiveThreadWithOptions,
  type CloneDesignDocumentForFork
} from './chat-store-maintenance-fork-action'
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
  cloneDesignDocumentForFork?: CloneDesignDocumentForFork
  cloneDesignDocumentForResume?: CloneDesignDocumentForFork
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

export function createMaintenanceMetadataActions(
  { set, get, sseAbortRef }: StoreActionContext,
  dependencies: MaintenanceActionDependencies = {}
): Pick<ChatState, 'renameActiveThread' | 'renameThread' | 'pinThread' | 'archiveThread' | 'compactActiveThread' | 'archiveActiveThreadToTurn' | 'forkActiveThread' | 'forkThreadFromTurn' | 'setActiveThreadGoal' | 'setActiveThreadGoalStatus' | 'clearActiveThreadGoal' | 'setActiveThreadTodoStatus' | 'clearActiveThreadTodos' | 'syncPlanTodosFromMarkdown'> {
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
    const forkActiveThreadWithOptions = createForkActiveThreadWithOptions(
      { set, get },
      dependencies.cloneDesignDocumentForFork
    )
  return {
  renameActiveThread: async (title) => {
    const { activeThreadId } = get()
    if (!activeThreadId) return
    await get().renameThread(activeThreadId, title)
  },

  renameThread: async (threadId, title) => {
    const targetId = threadId.trim()
    const nextTitle = title.trim()
    if (!targetId || !nextTitle) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider()
    try {
      // Manual rename → lock the title so the backend LLM titler won't overwrite it.
      await p.renameThread(targetId, nextTitle, false)
      set((s) => ({
        threads: s.threads.map((thread) =>
          thread.id === targetId ? { ...thread, title: nextTitle, titleAuto: false } : thread
        ),
        error: null
      }))
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

  pinThread: async (threadId, pinned) => {
    const targetId = threadId.trim()
    if (!targetId) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider()
    if (typeof p.updateThreadPinned !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      await p.updateThreadPinned(targetId, pinned)
      set((s) => ({
        threads: s.threads.map((thread) =>
          thread.id === targetId ? { ...thread, pinned } : thread
        ),
        error: null
      }))
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

  archiveThread: async (threadId, archived) => {
    const targetId = threadId.trim()
    if (!targetId) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { activeThreadId } = get()
    const p = getProvider()
    const archivingActive = archived && activeThreadId === targetId
    try {
      if (typeof p.archiveThread === 'function') {
        await p.archiveThread(targetId, archived)
      } else if (archived) {
        await p.deleteThread(targetId)
      } else {
        throw new Error(i18n.t('common:runtimeFeatureUnsupported'))
      }
      // An archived/unarchived projection can differ from the one currently
      // parked in memory; force a fresh durable snapshot next time.
      invalidateThreadSnapshot(targetId)
      if (archivingActive) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
      }
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        const u = { ...s.unreadThreadIds }
        if (archived) {
          delete w[targetId]
          delete u[targetId]
          clearWatchedCompletionNotification(targetId)
        }
        return {
          threads: s.threads.map((thread) =>
            thread.id === targetId ? { ...thread, archived } : thread
          ),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(archivingActive ? clearedThreadSelection() : {}),
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

  compactActiveThread: async (reason) => {
    const { activeThreadId, busy } = get()
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
    if (typeof p.compactThread !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      const result = await p.compactThread(activeThreadId, reason)
      await get().refreshThreads()
      await get().selectThread(activeThreadId)
      const replacedTokens = result && typeof result.replacedTokens === 'number' ? result.replacedTokens : 0
      if (replacedTokens <= 0) {
        // Nothing was folded (e.g. a near-empty thread). The compaction emits no
        // timeline row in that case, so surface a transient notice instead of
        // leaving the command silently doing nothing.
        set({ error: i18n.t('common:compactionNothingToCompact') })
      }
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  archiveActiveThreadToTurn: async (turnId) => {
    const targetTurnId = turnId.trim()
    const { activeThreadId, busy } = get()
    if (!activeThreadId || !targetTurnId) return
    if (busy) {
      set({ error: i18n.t('common:threadActionBusy') })
      return
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider()
    if (typeof p.archiveThreadHistory !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      const result = await p.archiveThreadHistory(activeThreadId, targetTurnId)
      await get().refreshThreads()
      await get().selectThread(activeThreadId)
      set({ error: i18n.t('common:archiveHistorySuccess', {
        count: result.archivedItems,
        tokens: result.replacedTokens,
        path: result.archivePath
      }) })
    } catch (e) {
      set({ error: formatRuntimeError(e) })
    }
  },

  forkActiveThread: async () => {
    await forkActiveThreadWithOptions()
  },

  forkThreadFromTurn: async (turnId) => {
    const targetTurnId = turnId.trim()
    if (!targetTurnId) return
    await forkActiveThreadWithOptions({ turnId: targetTurnId })
  },

  setActiveThreadGoal: async (objective) => {
    const trimmed = objective.trim()
    if (!trimmed) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    let { activeThreadId } = get()
    if (!activeThreadId) {
      await get().createThread()
      activeThreadId = get().activeThreadId
    }
    if (!activeThreadId) return false
    const p = getProvider()
    if (typeof p.setThreadGoal !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      const goal = await p.setThreadGoal(activeThreadId, {
        objective: trimmed,
        status: 'active'
      })
      applyGoalSnapshot(set, activeThreadId, goal)
      await get().refreshThreads()
      return get().sendMessage(goal.objective, 'agent', {
        displayText: i18n.t('common:goalUserMessage', { objective: goal.objective })
      })
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  },

  setActiveThreadGoalStatus: async (status: ThreadGoalStatus) => {
    const { activeThreadId } = get()
    if (!activeThreadId) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.setThreadGoal !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      const goal = await p.setThreadGoal(activeThreadId, { status })
      applyGoalSnapshot(set, activeThreadId, goal)
      await get().refreshThreads()
      return true
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  },

  clearActiveThreadGoal: async () => {
    const { activeThreadId } = get()
    if (!activeThreadId) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.clearThreadGoal !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      const cleared = await p.clearThreadGoal(activeThreadId)
      if (cleared) {
        applyGoalSnapshot(set, activeThreadId, null)
      }
      await get().refreshThreads()
      return cleared
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  },

  setActiveThreadTodoStatus: async (todoId: string, status: ThreadTodoStatus) => {
    const { activeThreadId, activeThreadTodos } = get()
    if (!activeThreadId || !activeThreadTodos) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.setThreadTodos !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      const nextItems = activeThreadTodos.items.map((item) => {
        if (item.id === todoId) return { ...item, status }
        if (status === 'in_progress' && item.status === 'in_progress') {
          return { ...item, status: 'pending' as const }
        }
        return item
      })
      const todos = await p.setThreadTodos(activeThreadId, threadTodoWriteItems({
        ...activeThreadTodos,
        items: nextItems
      }))
      applyTodosSnapshot(set, activeThreadId, todos)
      return true
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  },

  clearActiveThreadTodos: async () => {
    const { activeThreadId } = get()
    if (!activeThreadId) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.clearThreadTodos !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      const cleared = await p.clearThreadTodos(activeThreadId)
      if (cleared) applyTodosSnapshot(set, activeThreadId, null)
      return cleared
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  },

  syncPlanTodosFromMarkdown: async (threadId, plan, markdown) => {
    if (!threadId || get().activeThreadId !== threadId) return false
    if (get().runtimeConnection !== 'ready') return false
    const p = getProvider()
    if (typeof p.syncThreadTodosFromPlan !== 'function') return false
    try {
      const todos = await p.syncThreadTodosFromPlan(threadId, {
        planId: plan.id,
        relativePath: plan.relativePath,
        markdown
      })
      if (get().activeThreadId !== threadId) return false
      applyTodosSnapshot(set, threadId, todos)
      return true
    } catch (e) {
      if (get().activeThreadId === threadId) {
        set({
          error: formatRuntimeError(e),
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
      return false
    }
  },
  }
}
