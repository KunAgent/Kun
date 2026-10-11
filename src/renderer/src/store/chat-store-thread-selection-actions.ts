import { createLiveThreadSubscription } from './chat-store-live-thread-subscription'
import { threadSnapshotNeedsRefresh } from './thread-snapshot-refresh'
import { restoreThreadWorkspaceOwner } from './restore-thread-workspace-owner'
import { loadEarlierThreadHistory } from './chat-store-thread-history'
import { codexReferenceRevision } from '../history-reference/codex-reference-state'
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
import {
  deriveThreadTitleFromPrompt,
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
import { threadIdBelongsToRemovedCodeProject } from './chat-store-navigation-workspace-removal'
import { currentTurnStartGeneration } from './turn-start-fence'
import {
  fetchRuntimeQueuedTurnsBestEffort,
  isPendingQueuedMessage,
  queuedMessagesForThread,
  reconcileQueuedMessages,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import {
  accountIdForComposerSelection,
  activeClawChannel,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
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
import { threadTodosForProjection } from './thread-todo-projection'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  isCodeSidebarThread,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
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
  clearedTurnTimingPatch,
  getThreadSnapshotForSelection,
  hydratedTurnTimingPatch,
  invalidateThreadSnapshot,
  snapshotThreadProjection,
  turnTimingSnapshotPatch
} from './thread-snapshot-cache'
import { copyLiveProjection, emptyLiveProjection, restoredLiveProjection } from './chat-store-live-projection'
import { getThreadPrewarmHandle } from './thread-detail-prewarm'
import { beginThreadSelection, finishThreadHydration, hydrateThreadDetail, isThreadHydrationCancellation, startThreadHydration } from './thread-selection-hydration'
import {
  ensureRuntimeProviderForSend,
  fallbackComposerProviderIdForSend,
  subscribeThreadEventsWithRecovery
} from './chat-store-thread-action-helpers'
import { resolveThreadComposerState } from './chat-store-thread-composer-state'
import { GitCheckpointAvailabilityCache } from '../lib/git-checkpoint-availability'
import { readDesignThreadRegistry } from '../design/design-thread-registry'
import { readSddThreadRegistry } from '../sdd/sdd-thread-registry'
import type { ComposerContextAttachment } from '@kun/extension-api'
import { mergeChatBlocks } from '../agent/kun-mapper'
import {
  activeChatWorkspaceRoot,
  activeWriteMessageContextMatches,
  createClientTurnRequestId,
  createWorkspaceCheckpointRequestId,
  hasRuntimeUserBlockForGuidance,
  localConversationErrorBlock,
  pendingComposerContexts,
  pendingQueuedMessage,
  prependOlderHistoryBlocks,
  startingQueuedSubmission,
  threadActionSharedState,
  turnAdmissionOutcomeMayBeUnknown,
  upsertQueuedSubmission,
  withoutConsumedComposerContexts,
  type StoreActionContext,
  type ThreadActionRuntime
} from './chat-store-thread-actions-support'
import { syncThreadAdditionalWorkspaces } from './chat-store-workspace-folder-sync'
import { completionIsCurrentlyVisible } from './unread-completions'

export function createThreadSelectionActions(
  context: StoreActionContext,
  runtime: ThreadActionRuntime
): Pick<ChatState, 'selectThread' | 'loadEarlierThreadHistory' | 'subscribeThreadEventsLive'> {
  const { set, get, sseAbortRef } = context
  return {
  selectThread: async (id, options) => {
    if (options?.selectionGuard?.() === false) return
    const currentState = get()
    const historyRevision = codexReferenceRevision()
    if (threadIdBelongsToRemovedCodeProject(id, currentState)) {
      set({ error: i18n.t('common:sidebarWorkspaceRemoveDialogDetail') })
      return
    }
    const targetThread = currentState.threads.find((thread) => thread.id === id) ??
      currentState.adeThreads.find((thread) => thread.id === id) ?? null
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const selectionGeneration = beginThreadSelection(runtime, currentState.activeThreadId, id)
    if (currentState.adeDraftOpen) set({ adeDraftOpen: false, adeDraftRevision: currentState.adeDraftRevision + 1 })
    const previousState = get()
    const prevId = previousState.activeThreadId
    const prevBusy = previousState.busy
    const selectionStillCurrent = (): boolean => {
      if (options?.selectionGuard?.() === false) return false
      if (selectionGeneration !== runtime.threadSelectionGeneration) return false
      return get().activeThreadId === id
    }
    let nextWatch = { ...get().watchTurnCompletion }
    delete nextWatch[id]
    clearWatchedCompletionNotification(id)
    if (prevId && prevId !== id && prevBusy) {
      nextWatch[prevId] = true
      watchTurnCompletionNotification(
        prevId,
        Date.now(),
        turnCompleteNotificationSource(prevId, previousState)
      )
    }
    const nextUnread = { ...get().unreadThreadIds }
    if (completionIsCurrentlyVisible({ ...get(), activeThreadId: id }, id)) delete nextUnread[id]

    const refreshingActiveThread = prevId === id
    if (!refreshingActiveThread) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
    }
    const p = getProvider()
    const durableQueuedMessages = queuedMessagesForThread(id)
    // Park the outgoing renderer projection before its state is replaced. This
    // is intentionally O(1): blocks stay immutable while another thread is
    // active, so no expensive JSON serialization runs on the click path.
    if (prevId && prevId !== id) {
      if (threadActionSharedState.expandedHistoryThreadIds.delete(prevId)) invalidateThreadSnapshot(prevId)
      else snapshotThreadProjection(previousState)
    }
    // Re-selecting the active conversation is an explicit refresh (and is
    // used by recovery paths to pick up durable queues), so only cross-thread
    // navigation may consume an in-memory snapshot.
    const cached = prevId !== id && targetThread
      ? getThreadSnapshotForSelection(targetThread)
      : null
    const refreshCached = Boolean(cached && targetThread && threadSnapshotNeedsRefresh(targetThread, cached))
    if (!refreshingActiveThread) {
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
    }
    if (cached) {
      // The durable queue is the only authoritative queue source. The parked
      // snapshot may hold a queue that was already consumed (e.g. guidance
      // finished while this thread was inactive), so its queuedMessages must
      // never be restored. durableQueuedMessages was read synchronously above
      // (before the old snapshot was parked), so it is still fresh here.
      const queuedMessages = reconcileQueuedMessages(durableQueuedMessages, {
        busy: cached.busy,
        turnId: cached.currentTurnId ?? undefined,
        blocks: cached.blocks
      }, durableQueuedMessages.length > 0
        ? await fetchRuntimeQueuedTurnsBestEffort(p, id)
        : undefined)
      if (selectionGeneration !== runtime.threadSelectionGeneration || options?.selectionGuard?.() === false) return
      if (historyRevision !== codexReferenceRevision()) {
        if (selectionGeneration !== runtime.threadSelectionGeneration || options?.selectionGuard?.() === false) return
        return get().selectThread(id, options)
      }
      const remembersCodeThread = targetThread != null &&
        targetThread.archived !== true &&
        isCodeSidebarThread(
          targetThread,
          get().clawChannels,
          readWriteThreadRegistry(),
          readDesignThreadRegistry(),
          readSddThreadRegistry()
        )
      const remembersAdeThread = targetThread != null &&
        targetThread.archived !== true && targetThread.workspaceMode === 'ade'
      const composerState = resolveThreadComposerState(get(), targetThread, {
        hasUserMessages: cached.blocks.some((block) => block.kind === 'user')
      })
      set((state) => ({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        awaitingUserInputThreadIds: cached.blocks.some((block) => block.kind === 'user_input' && block.status === 'pending' && block.live)
          ? { ...state.awaitingUserInputThreadIds, [id]: true }
          : Object.fromEntries(Object.entries(state.awaitingUserInputThreadIds ?? {}).filter(([threadId]) => threadId !== id)),
        activeThreadId: id,
        threadLoadingId: cached.busy || refreshCached ? id : null,
        threadRefreshingId: null,
        threadHistoryCursor: cached.threadHistoryCursor,
        threadHasMoreHistory: cached.threadHasMoreHistory,
        threadHistoryLoading: false,
        activeThreadRelation: cached.activeThreadRelation ?? 'primary',
        activeThreadParentId: cached.activeThreadParentId,
        activeThreadGoal: cached.activeThreadGoal,
        activeThreadTodos: threadTodosForProjection(state, id, cached.activeThreadTodos),
        blocks: cached.blocks,
        lastSeq: cached.lastSeq,
        ...copyLiveProjection(cached),
        error: null,
        busy: cached.busy,
        busyUnconfirmed: cached.busyUnconfirmed,
        ...turnTimingSnapshotPatch(cached),
        inspectorSelectedId: null,
        queuedMessages,
        ...composerState,
        threads: state.threads.map((thread) => thread.id === id
          ? { ...thread, status: cached.busy ? 'running' : 'idle' }
          : thread),
        adeThreads: (state.adeThreads ?? []).map((thread) => thread.id === id
          ? { ...thread, status: cached.busy ? 'running' : 'idle' }
          : thread),
        ...(remembersCodeThread ? { lastCodeThreadId: id } : {}),
        ...(remembersAdeThread ? { lastAdeThreadId: id } : {})
      }))
      saveQueuedMessagesForThread(id, queuedMessages)
      syncTurnCompletionPoll(set, get)
      if (!refreshCached) {
        const ac = new AbortController()
        sseAbortRef.current = ac
        const sink = buildThreadEventSink(set, get, {
          threadId: id,
          signal: ac.signal,
          sinceSeq: cached.lastSeq,
          awaitReplaySynchronization: cached.busy
        })
        subscribeThreadEventsWithRecovery(p, id, cached.lastSeq, sink, ac.signal, get)
        if (cached.busy) armBusyWatchdog(set, get)
        if (!(await restoreThreadWorkspaceOwner(p, id, set, get, selectionStillCurrent))) return
        if (queuedMessages.length > 0) void get().drainQueuedMessages()
        if (!cached.busy) {
          void syncThreadAdditionalWorkspaces({
            set,
            get,
            threadId: id,
            mergeExtras: targetThread?.additionalWorkspaces
          })
        }
        return
      }
    }
    // Give the sidebar its selected state in this render frame. The timeline
    // shows a skeleton and the composer is disabled until detail hydration
    // commits, preventing sends against an unhydrated thread.
    if (refreshingActiveThread) {
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        threadRefreshingId: id,
        error: null
      })
    } else if (!cached) {
      const initialComposerState = resolveThreadComposerState(get(), targetThread)
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        threadLoadingId: id,
        threadRefreshingId: null,
        threadHistoryCursor: null,
        threadHasMoreHistory: false,
        threadHistoryLoading: false,
        activeThreadRelation: targetThread?.relation ?? 'primary',
        activeThreadParentId: targetThread?.parentThreadId ?? null,
        activeThreadGoal: targetThread?.goal ?? null,
        activeThreadTodos: targetThread?.todos ?? null,
        blocks: [],
        lastSeq: 0,
        ...emptyLiveProjection(),
        busy: false,
        busyUnconfirmed: false,
        currentTurnId: null,
        currentTurnOrchestration: null,
        currentTurnUserId: null,
        turnStartedAtByUserId: {},
        turnDurationByUserId: {},
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
        inspectorSelectedId: null,
        queuedMessages: [],
        error: null,
        ...initialComposerState
      })
    }
    const hydrationAbort = startThreadHydration(runtime)
    try {
      const prewarmHandle = targetThread ? getThreadPrewarmHandle(targetThread) : null
      const detail = await hydrateThreadDetail(p, id, prewarmHandle, () => get().threads.find((thread) => thread.id === id) ?? null, hydrationAbort.signal)
      if (!selectionStillCurrent()) return
      const {
        blocks: rawBlocks,
        latestSeq,
        liveProjection,
        threadStatus,
        latestTurnId,
        latestTurnStatus,
        latestTurnOrchestration,
        latestUserMessageId,
        latestTurnStartedAtMs,
        turnDurationByUserId = {},
        usage: threadUsage,
        relation: threadRelation,
        parentThreadId: threadParentId,
        model: threadModel,
        designProfile: threadDesignProfile,
        goal,
        todos,
        payloadBytes,
        historyCursor,
        hasMoreHistory = false
      } = detail
      // A subagent's `side` thread has no locally-stored per-turn model labels
      // (it was never sent through the composer). Backfill the user blocks with
      // the child thread's resolved model so the session shows "which model",
      // matching the main conversation. Safe: a child runs on a single model.
      const labeledBlocks =
        threadRelation === 'side' && threadModel
          ? rawBlocks.map((block) =>
              block.kind === 'user' && !block.modelLabel
                ? { ...block, modelLabel: threadModel }
                : block
            )
          : rawBlocks
      const loaded = hydrateBlockModelLabels(id, labeledBlocks)
      const busy = detail.activeTurn !== undefined ? Boolean(detail.activeTurn)
        : threadSnapshotLooksRunning(loaded, threadStatus, latestTurnStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so selecting the thread doesn't keep it wedged (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const threadSnap = get().threads.find((thread) => thread.id === id) ??
        get().adeThreads.find((thread) => thread.id === id) ?? null
      // Code 工作台返回记忆：记录最近一次选中的 Code 或 Design 任务，
      // 供从设置、Work 或 Connect Phone 返回时恢复。Work/Claw 会话以及
      // 已归档会话不写入记忆。
      const remembersCodeThread = threadSnap != null &&
        threadSnap.archived !== true &&
        isCodeSidebarThread(
          threadSnap,
          get().clawChannels,
          readWriteThreadRegistry(),
          readDesignThreadRegistry(),
          readSddThreadRegistry()
        )
      const remembersAdeThread = threadSnap != null &&
        threadSnap.archived !== true && threadSnap.workspaceMode === 'ade'
      const composerState = resolveThreadComposerState(get(), threadSnap, {
        hasUserMessages: rawBlocks.some((block) => block.kind === 'user'),
        runtimeModel: threadModel
      })
      const queuedMessages = reconcileQueuedMessages(durableQueuedMessages, {
        busy,
        turnId: detail.activeTurn !== undefined ? detail.activeTurn?.id : latestTurnId,
        blocks
      }, await fetchRuntimeQueuedTurnsBestEffort(p, id))
      if (!selectionStillCurrent() || hydrationAbort.signal.aborted) return
      if (historyRevision !== codexReferenceRevision()) return get().selectThread(id, options)
      if (refreshingActiveThread) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        resetBusyRecoveryAttempts()
        clearBusyWatchdog()
      }
      // Re-derive the awaiting-input marker from the runtime's pending gate so
      // switching threads (or restarting) keeps the sidebar hint accurate.
      const hasLivePendingUserInput = blocks.some(
        (block) => block.kind === 'user_input' && block.status === 'pending' && block.live === true
      )
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        awaitingUserInputThreadIds: hasLivePendingUserInput
          ? { ...get().awaitingUserInputThreadIds, [id]: true }
          : (() => {
              const next = { ...get().awaitingUserInputThreadIds }
              delete next[id]
              return next
            })(),
        activeThreadId: id,
        threadLoadingId: busy && (!refreshingActiveThread || get().threadLoadingId === id) ? id : null,
        threadRefreshingId: null,
        threadHistoryCursor: historyCursor ?? null,
        threadHasMoreHistory: hasMoreHistory,
        threadHistoryLoading: false,
        activeThreadRelation: threadRelation ?? 'primary',
        activeThreadParentId: threadParentId ?? null,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: threadTodosForProjection(get(), id, todos),
        blocks,
        lastSeq: latestSeq,
        ...restoredLiveProjection(latestSeq, busy ? liveProjection : undefined),
        error: null,
        busy,
        // Replay synchronization confirms the restored running claim.
        busyUnconfirmed: busy,
        ...hydratedTurnTimingPatch({
          busy,
          latestTurnId: detail.activeTurn !== undefined ? detail.activeTurn?.id : latestTurnId,
          latestTurnOrchestration: detail.activeTurn !== undefined ? detail.activeTurn?.orchestration : latestTurnOrchestration,
          currentTurnUserId,
          latestTurnStartedAtMs,
          turnDurationByUserId
        }),
        inspectorSelectedId: null,
        queuedMessages,
        ...composerState,
        threads: get().threads.map((thread) => thread.id === id
          ? {
              ...thread,
              status: thread.archived ? thread.status : (busy ? 'running' : 'idle'),
              ...(latestTurnId ? { latestTurnId } : {}),
              ...(latestTurnStatus ? { latestTurnStatus } : {}),
              ...(threadDesignProfile ? { designProfile: threadDesignProfile } : {})
            }
          : thread),
        adeThreads: (get().adeThreads ?? []).map((thread) => thread.id === id
          ? {
              ...thread,
              status: thread.archived ? thread.status : (busy ? 'running' : 'idle'),
              ...(latestTurnId ? { latestTurnId } : {}),
              ...(latestTurnStatus ? { latestTurnStatus } : {})
            }
          : thread),
        ...(remembersCodeThread ? { lastCodeThreadId: id } : {}),
        ...(remembersAdeThread ? { lastAdeThreadId: id } : {})
      })
      snapshotThreadProjection(get(), payloadBytes)
      saveQueuedMessagesForThread(id, queuedMessages)
      syncTurnCompletionPoll(set, get)
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, {
        threadId: id,
        signal: ac.signal,
        sinceSeq: latestSeq,
        awaitReplaySynchronization: busy
      })
      subscribeThreadEventsWithRecovery(p, id, latestSeq, sink, ac.signal, get)
      if (busy) {
        armBusyWatchdog(set, get)
      }
      if (!(await restoreThreadWorkspaceOwner(p, id, set, get, selectionStillCurrent))) return
      if (queuedMessages.length > 0) void get().drainQueuedMessages()
    } catch (e) {
      if (hydrationAbort.signal.aborted) return
      if (isThreadHydrationCancellation(e) && !cached) {
        // An unrelated in-flight request was cancelled, not a selection failure.
        set({ threadLoadingId: null, threadRefreshingId: get().threadRefreshingId === id ? null : get().threadRefreshingId })
        return
      }
      if (!selectionStillCurrent()) return
      if (cached) {
        // Keep the visible, cursor-matched snapshot live if refresh failed.
        // Never pretend the sidebar's newer sequence was already projected.
        const ac = new AbortController()
        sseAbortRef.current = ac
        const sink = buildThreadEventSink(set, get, {
          threadId: id, signal: ac.signal, sinceSeq: cached.lastSeq,
          awaitReplaySynchronization: cached.busy
        })
        subscribeThreadEventsWithRecovery(p, id, cached.lastSeq, sink, ac.signal, get)
        if (cached.busy) armBusyWatchdog(set, get)
      }
      set({
        threadLoadingId: cached?.busy ? id : null,
        threadRefreshingId: get().threadRefreshingId === id ? null : get().threadRefreshingId,
        error: isThreadHydrationCancellation(e) ? null : formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    } finally { finishThreadHydration(runtime, hydrationAbort) }
  },
  loadEarlierThreadHistory: () => loadEarlierThreadHistory(set, get),
  subscribeThreadEventsLive: createLiveThreadSubscription(context, runtime)
  }
}
