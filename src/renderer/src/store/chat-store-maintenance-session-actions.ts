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
  cloneDesignDocumentForFork,
  type CloneDesignDocumentForForkInput,
  type PreparedDesignDocumentFork
} from '../design/design-document-fork'
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
  pauseQueuedMessagesForInterrupt,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import { invalidatePendingTurnStarts } from './turn-start-fence'
import { resolvePreparedDesignCloneAfterError } from './chat-store-design-clone-recovery'

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
  cloneDesignDocumentForResume?: (
    input: CloneDesignDocumentForForkInput
  ) => Promise<PreparedDesignDocumentFork>
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

export function createMaintenanceSessionActions(
  { set, get, sseAbortRef }: StoreActionContext,
  dependencies: MaintenanceActionDependencies = {}
): Pick<ChatState, 'resumeSessionIntoThread' | 'clearDesignHistory'> {
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
    let preparedDesignResume: PreparedDesignDocumentFork | null = null
    let resumeCommitted = false
    try {
      const state = get()
      let sourceThread = state.threads.find((thread) => thread.id === id)
      if (!sourceThread) {
        sourceThread = (await p.listThreads({
          includeArchived: true,
          includeSide: true,
          search: id,
          limit: 50
        })).find((thread) => thread.id === id)
      }
      const resumeMetadata = !sourceThread && typeof p.getResumeSessionMetadata === 'function'
        ? await p.getResumeSessionMetadata(id)
        : null
      const sourceTarget = sourceThread?.designProfile?.documentTarget ??
        resumeMetadata?.sourceDesignDocumentTarget ??
        resumeMetadata?.sourceDesignProfile?.documentTarget
      const sourceWorkspace = sourceThread?.workspace || resumeMetadata?.workspace
      if (sourceTarget) {
        if (!sourceWorkspace) {
          throw new Error('Design session source workspace is unavailable; resume was not attempted')
        }
        preparedDesignResume = await (
          dependencies.cloneDesignDocumentForResume ?? cloneDesignDocumentForFork
        )({
          workspaceRoot: sourceWorkspace,
          sourceTarget,
          operation: { kind: 'resume', sourceId: id, relation: 'resume' }
        })
      }
      await preparedDesignResume?.markRuntimeRequestStarted?.()
      const result = await p.resumeSession(id, {
        ...options,
        ...(sourceWorkspace || state.workspaceRoot
          ? { workspace: sourceWorkspace || state.workspaceRoot }
          : {}),
        ...(preparedDesignResume
          ? {
              designDocumentTarget: preparedDesignResume.designDocumentTarget,
              designCloneOperationId: preparedDesignResume.operationId
            }
          : {})
      })
      resumeCommitted = true
      await preparedDesignResume?.commit?.()
      await get().refreshThreads()
      await get().selectThread(result.threadId)
      return result.threadId
    } catch (e) {
      if (!resumeCommitted && preparedDesignResume) {
        const outcome = await resolvePreparedDesignCloneAfterError(
          getProvider(), preparedDesignResume, e
        )
        if (outcome.kind === 'committed') {
          resumeCommitted = true
          await preparedDesignResume.commit?.()
          await get().refreshThreads()
          await get().selectThread(outcome.thread.id)
          return outcome.thread.id
        }
      }
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },

  clearDesignHistory: async (workspaceRoot, docId, options = {}) => {
    const targetWorkspace = normalizeWorkspaceRoot(workspaceRoot)
    const targetDoc = docId.trim()
    const emptyResult = {
      cleared: false,
      deletedThreadIds: [] as string[],
      retainedThreadIds: [] as string[],
      recreatedThreadId: null as string | null
    }
    if (!targetWorkspace || !targetDoc) {
      set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
      return emptyResult
    }
    const registry = readDesignThreadRegistry()
    const originalRecord = registry.workspaces[designDocKey(targetWorkspace, targetDoc)]
    const originalThreadIds = [...new Set([
      ...(originalRecord?.threadIds ?? []),
      ...(options.includeThreadIds ?? []).map((threadId) => threadId.trim()).filter(Boolean)
    ])]
    const replaceRememberedThreads = (
      threadIds: readonly string[],
      preferredActiveThreadId?: string | null
    ): void => {
      saveDesignThreadRegistry(replaceDesignThreadsForDocument(
        targetWorkspace,
        targetDoc,
        threadIds,
        preferredActiveThreadId,
        readDesignThreadRegistry()
      ))
    }
    const restoreOriginalRecord = (): void => {
      replaceRememberedThreads(originalThreadIds, originalRecord?.activeThreadId)
    }
    const fail = (
      message: string,
      retainedThreadIds: string[],
      deletedThreadIds = originalThreadIds.filter((id) => !retainedThreadIds.includes(id))
    ) => {
      set({ error: message })
      return {
        ...emptyResult,
        deletedThreadIds,
        retainedThreadIds
      }
    }

    const historyMutationToken = beginDesignChatHistoryMutation(targetWorkspace, targetDoc)
    if (!historyMutationToken) {
      return fail(i18n.t('common:designAgentBusy'), originalThreadIds, [])
    }
    let historyMutationReleased = false
    const releaseHistoryMutation = (): void => {
      if (historyMutationReleased) return
      historyMutationReleased = true
      endDesignChatHistoryMutation(historyMutationToken)
    }

    try {
      // An empty registry can still have a stale local mirror after an earlier
      // interrupted cleanup. Make the operation idempotently finish that work,
      // but do not create a brand-new conversation when there was no history.
      if (originalThreadIds.length === 0) {
        await flushDesignPersistence(targetWorkspace)
        const mirrorDeleted = await deleteDesignChatDir({
          workspaceRoot: targetWorkspace,
          docId: targetDoc
        })
        if (!mirrorDeleted) {
          return fail('Failed to delete the local design conversation history.', [])
        }
        set({ error: null })
        return { ...emptyResult, cleared: true }
      }

      if (get().runtimeConnection !== 'ready') {
        return fail(
          i18n.t('common:runtimeActionNeedsConnection'),
          originalThreadIds,
          []
        )
      }

    const provider = getProvider()
    // A registered thread can be absent from the renderer's paged snapshot.
    // Ask Kun before deleting so an unloaded/racing active turn is treated as
    // busy instead of being destroyed underneath the agent.
    for (const threadId of originalThreadIds) {
      const localThread = get().threads.find((thread) => thread.id === threadId)
      if (
        localThread && threadLooksRunning(localThread)
      ) {
        return fail(i18n.t('common:designAgentBusy'), originalThreadIds, [])
      }
      try {
        const detail = await provider.getThreadDetail(threadId)
        if (threadSnapshotLooksRunning(
          detail.blocks,
          detail.threadStatus,
          detail.latestTurnStatus
        )) {
          return fail(i18n.t('common:designAgentBusy'), originalThreadIds, [])
        }
      } catch (error) {
        if (getRuntimeErrorCode(error) !== 'not_found') {
          return fail(formatRuntimeError(error), originalThreadIds, [])
        }
      }
    }
    const runtimeDeletedIds: string[] = []
    const runtimeFailedIds: string[] = []
    const failureMessages: string[] = []
    await Promise.all(originalThreadIds.map(async (threadId) => {
      try {
        await provider.deleteThread(threadId)
        invalidateThreadSnapshot(threadId)
        runtimeDeletedIds.push(threadId)
      } catch (error) {
        // A retry after an interrupted local cleanup commonly reaches a thread
        // already removed from Kun. That is success for this idempotent action.
        if (getRuntimeErrorCode(error) === 'not_found') {
          invalidateThreadSnapshot(threadId)
          runtimeDeletedIds.push(threadId)
          return
        }
        runtimeFailedIds.push(threadId)
        failureMessages.push(`${threadId}: ${formatRuntimeError(error)}`)
      }
    }))

    const runtimeDeletedSet = new Set(runtimeDeletedIds)
    const orderedRuntimeDeletedIds = originalThreadIds.filter((id) => runtimeDeletedSet.has(id))
    const orderedRuntimeFailedIds = originalThreadIds.filter((id) => runtimeFailedIds.includes(id))
    const preferredRetainedActive = originalRecord?.activeThreadId &&
      orderedRuntimeFailedIds.includes(originalRecord.activeThreadId)
      ? originalRecord.activeThreadId
      : orderedRuntimeFailedIds[0]
    // Removing successful ids before flushing prevents an in-flight transcript
    // refresh from enqueueing a new mirror after cleanup begins.
    replaceRememberedThreads(orderedRuntimeFailedIds, preferredRetainedActive)

    for (const threadId of orderedRuntimeDeletedIds) {
      forgetQueuedMessagesForThread(threadId)
      saveWriteThreadRegistry(forgetWriteThread(threadId))
      saveThreadForkRegistry(forgetThreadFork(threadId))
      releaseThreadWorktreeIfNeeded(threadId)
    }

    const deletingActive = Boolean(get().activeThreadId && runtimeDeletedSet.has(get().activeThreadId!))
    if (deletingActive) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
    }
    set((state) => {
      const watchTurnCompletion = { ...state.watchTurnCompletion }
      const unreadThreadIds = { ...state.unreadThreadIds }
      for (const threadId of orderedRuntimeDeletedIds) {
        delete watchTurnCompletion[threadId]
        delete unreadThreadIds[threadId]
        clearWatchedCompletionNotification(threadId)
      }
      return {
        threads: state.threads.filter((thread) => !runtimeDeletedSet.has(thread.id)),
        watchTurnCompletion,
        unreadThreadIds,
        ...(deletingActive ? clearedThreadSelection() : {}),
        error: null
      }
    })

    await flushDesignPersistence(targetWorkspace)

    if (orderedRuntimeFailedIds.length === 0) {
      const mirrorDeleted = await deleteDesignChatDir({
        workspaceRoot: targetWorkspace,
        docId: targetDoc
      })
      if (!mirrorDeleted) {
        // Keep the old ids as a durable retry journal. The next attempt treats
        // Kun's not_found response as success and retries only local cleanup.
        restoreOriginalRecord()
        return fail(
          'The conversations were deleted from Kun, but the local design history could not be removed.',
          originalThreadIds,
          orderedRuntimeDeletedIds
        )
      }

      if (options.recreate === false) {
        await get().refreshThreads()
        set({ error: null })
        return {
          cleared: true,
          deletedThreadIds: originalThreadIds,
          retainedThreadIds: [],
          recreatedThreadId: null
        }
      }

      set({ error: null })
      // The mirror directory is now gone and every older hydrate/persist read
      // carries a stale epoch, so replacement-thread persistence can resume.
      releaseHistoryMutation()
      const recreatedThreadId = await get().createDesignThread(
        targetWorkspace,
        targetDoc,
        { activate: false, suppressSettingsRedirect: true }
      )
      if (!recreatedThreadId && !get().error) {
        set({ error: 'Design history was cleared, but a new conversation could not be created.' })
      }
      return {
        cleared: true,
        deletedThreadIds: originalThreadIds,
        retainedThreadIds: [],
        recreatedThreadId
      }
    }

    // Runtime partial failure: preserve failed threads and their mirrors, while
    // permanently removing mirrors belonging to successfully deleted threads.
    if (orderedRuntimeDeletedIds.length === 0) {
      await get().refreshThreads()
      return fail(
        `Design history could not be cleared: ${failureMessages.join('; ')}`,
        originalThreadIds,
        []
      )
    }
    const mirrorDeleteResults = await Promise.all(orderedRuntimeDeletedIds.map(async (threadId) => ({
      threadId,
      deleted: await deleteDesignChatTranscript({
        workspaceRoot: targetWorkspace,
        docId: targetDoc,
        threadId
      })
    })))
    const mirrorFailedIds = mirrorDeleteResults
      .filter((result) => !result.deleted)
      .map((result) => result.threadId)
    for (const threadId of mirrorFailedIds) {
      failureMessages.push(`${threadId}: failed to delete the local transcript`)
    }
    const retainedSet = new Set([...orderedRuntimeFailedIds, ...mirrorFailedIds])
    const retainedThreadIds = originalThreadIds.filter((id) => retainedSet.has(id))
    const preferredActive = originalRecord?.activeThreadId && retainedSet.has(originalRecord.activeThreadId)
      ? originalRecord.activeThreadId
      : retainedThreadIds[0]
    replaceRememberedThreads(retainedThreadIds, preferredActive)

    const metaPersisted = await persistDesignChatMeta({
      workspaceRoot: targetWorkspace,
      docId: targetDoc,
      mutationToken: historyMutationToken
    })
    if (!metaPersisted) {
      restoreOriginalRecord()
      failureMessages.push('failed to update the local design conversation index')
      await get().refreshThreads()
      return fail(
        `Design history was only partially cleared: ${failureMessages.join('; ')}`,
        originalThreadIds,
        orderedRuntimeDeletedIds
      )
    }

    await get().refreshThreads()
    return fail(
      `Design history was only partially cleared: ${failureMessages.join('; ')}`,
      retainedThreadIds,
      orderedRuntimeDeletedIds
    )
    } finally {
      releaseHistoryMutation()
    }
  },
  }
}
