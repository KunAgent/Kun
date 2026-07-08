import type { ThreadGoal, ThreadGoalStatus, ThreadTodoList, ThreadTodoStatus } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { confirmDialog } from '../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
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
  forgetDesignThread,
  saveDesignThreadRegistry
} from '../design/design-thread-registry'
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
      currentTurnId: null,
      currentTurnUserId: null,
      error: null
    })
    const blocks = settlePendingRuntimeWorkAfterInterrupt(out.blocks ?? s.blocks)
    return { ...out, blocks }
  })
  // Release worktree slot when user manually stops the agent (unless queued
  // follow-ups will restart the turn in the same thread).
  if (threadId && get().queuedMessages.length === 0) {
    releaseThreadWorktreeIfNeeded(threadId)
  }
}

export function createMaintenanceActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'renameActiveThread' | 'renameThread' | 'pinThread' | 'archiveThread' | 'compactActiveThread' | 'forkActiveThread' | 'forkThreadFromTurn' | 'setActiveThreadGoal' | 'setActiveThreadGoalStatus' | 'clearActiveThreadGoal' | 'setActiveThreadTodoStatus' | 'clearActiveThreadTodos' | 'syncPlanTodosFromMarkdown' | 'resumeSessionIntoThread' | 'deleteThread' | 'rewindAndResend' | 'rollbackWorkspaceToCheckpoint' | 'resolveApproval' | 'resolveUserInput' | 'interrupt'> {
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
      // Manual compaction may use a model request for the summary, but the
      // chat context gauge is still based on the main turn's measured prompt.
      // Drop the last turn's total by the folded amount so the UI reflects the
      // compacted model-visible history immediately. The next real turn
      // replaces this with a precise provider count.
      const replacedTokens = result && typeof result.replacedTokens === 'number' ? result.replacedTokens : 0
      if (replacedTokens > 0) {
        set((s) => {
          const prev = s.lastTurnUsage
          if (!prev || prev.threadId !== activeThreadId) return {}
          const inputTokens = Math.max(0, prev.snapshot.inputTokens - replacedTokens)
          return {
            usageRefreshKey: s.usageRefreshKey + 1,
            lastTurnUsage: { threadId: prev.threadId, snapshot: { ...prev.snapshot, inputTokens } }
          }
        })
      } else {
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

  syncPlanTodosFromMarkdown: async (plan, markdown) => {
    const { activeThreadId, activeThreadTodos } = get()
    if (!activeThreadId) return false
    if (get().runtimeConnection !== 'ready') return false
    const p = getProvider()
    if (typeof p.setThreadTodos !== 'function') return false
    const now = new Date().toISOString()
    const planItems = extractPlanTodos({
      markdown,
      threadId: activeThreadId,
      planId: plan.id,
      relativePath: plan.relativePath,
      now
    })
    const nextTodos = mergePlanTodosForRenderer({
      threadId: activeThreadId,
      existing: activeThreadTodos,
      planItems,
      now
    })
    const currentWriteItems = activeThreadTodos ? threadTodoWriteItems(activeThreadTodos) : []
    const nextWriteItems = threadTodoWriteItems(nextTodos)
    if (sameTodoWriteItems(currentWriteItems, nextWriteItems)) return true
    try {
      const todos = await p.setThreadTodos(activeThreadId, nextWriteItems)
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

  resumeSessionIntoThread: async (sessionId, options) => {
    const id = sessionId.trim()
    if (!id) return null
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    const p = getProvider()
    if (typeof p.resumeSession !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return null
    }
    try {
      const result = await p.resumeSession(id, options)
      await get().refreshThreads()
      await get().selectThread(result.threadId)
      return result.threadId
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },

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
      saveWriteThreadRegistry(forgetWriteThread(targetId))
      saveDesignThreadRegistry(forgetDesignThread(targetId))
      saveThreadForkRegistry(forgetThreadFork(targetId))
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
    const checkpointId = targetBlock.meta?.workspaceCheckpointId
    if (checkpointId) {
      const restored = await window.kunGui.restoreGitCheckpoint({
        checkpointId,
        ...(state.activeThreadId ? { expectedThreadId: state.activeThreadId } : {}),
        ...(state.workspaceRoot ? { expectedWorkspaceRoot: state.workspaceRoot } : {})
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

    try {
      await p.rewindThread(state.activeThreadId, turnId)
      set({
        blocks: trimmedBlocks,
        liveReasoning: '',
        liveAssistant: '',
        currentTurnId: null,
        currentTurnUserId: null,
        turnStartedAtByUserId,
        turnDurationByUserId,
        turnReasoningFirstAtByUserId,
        turnReasoningLastAtByUserId,
        queuedMessages: [],
        error: null
      })
      await get().sendMessage(trimmed)
    } catch (e) {
      set({ error: formatRuntimeError(e) })
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
    const { activeThreadId, workspaceRoot } = get()
    let restored = await window.kunGui.restoreGitCheckpoint({
      checkpointId: targetCheckpointId,
      ...(activeThreadId ? { expectedThreadId: activeThreadId } : {}),
      ...(workspaceRoot ? { expectedWorkspaceRoot: workspaceRoot } : {})
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
          ...(workspaceRoot ? { expectedWorkspaceRoot: workspaceRoot } : {})
        })
        .catch((error) => ({
          ok: false as const,
          reason: 'error' as const,
          message: error instanceof Error ? error.message : String(error)
        }))
    }
    if (!restored.ok) {
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
      workspaceRoot,
      'thread:',
      activeThreadId
    )
    set({ error: null })
  },

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
      await p.submitApprovalDecision(
        block.approvalId,
        decision === 'allow' ? 'allow' : 'deny',
        false
      )
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval'
            ? { ...b, status: decision === 'allow' ? ('allowed' as const) : ('denied' as const) }
            : b
        )
      }))
    } catch (e) {
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
          b.id === blockId && b.kind === 'approval'
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
                  text: followupText
                }
              ],
              blocks: s.blocks.map((b) =>
                b.id === blockId && b.kind === 'user_input'
                  ? { ...b, status: 'submitted' as const, answers: action.answers }
                  : b
              )
            }))
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
    const { activeThreadId, currentTurnId } = get()
    if (!activeThreadId || !currentTurnId) return
    const p = getProvider()
    // Settle the UI before notifying the runtime: a slow or hung
    // interruptTurn must not keep the stop button unresponsive. The event
    // stream is aborted first because onDeltas/onTool flip `busy` back on
    // while the backend turn is still streaming.
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    settleInterruptedTurn(set, get)
    try {
      await p.interruptTurn(activeThreadId, currentTurnId, { discard: options?.discard === true })
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
  }
  }
}
