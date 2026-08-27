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
  getThreadSnapshotForSelection,
  invalidateThreadSnapshot,
  snapshotThreadProjection
} from './thread-snapshot-cache'
import { copyLiveProjection, emptyLiveProjection, restoredLiveProjection } from './chat-store-live-projection'
import { getThreadPrewarmHandle, threadPrewarmHandleIsCurrent } from './thread-detail-prewarm'
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

export function createThreadSelectionActions(
  context: StoreActionContext,
  runtime: ThreadActionRuntime
): Pick<ChatState, 'selectThread' | 'loadEarlierThreadHistory' | 'subscribeThreadEventsLive'> {
  const { set, get, sseAbortRef } = context
  return {
  selectThread: async (id, options) => {
    if (options?.selectionGuard?.() === false) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const selectionGeneration = ++runtime.threadSelectionGeneration
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
    delete nextUnread[id]

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
    const targetThread = get().threads.find((thread) => thread.id === id) ?? null
    const cached = prevId !== id && targetThread
      ? getThreadSnapshotForSelection(targetThread)
      : null
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
      })
      const remembersCodeThread = targetThread != null &&
        targetThread.archived !== true &&
        isCodeSidebarThread(
          targetThread,
          get().clawChannels,
          readWriteThreadRegistry(),
          readDesignThreadRegistry(),
          readSddThreadRegistry()
        )
      const composerState = resolveThreadComposerState(get(), targetThread, {
        hasUserMessages: cached.blocks.some((block) => block.kind === 'user')
      })
      set((state) => ({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        threadLoadingId: cached.busy ? id : null,
        threadRefreshingId: null,
        threadHistoryCursor: cached.threadHistoryCursor,
        threadHasMoreHistory: cached.threadHasMoreHistory,
        threadHistoryLoading: false,
        activeThreadRelation: cached.activeThreadRelation ?? 'primary',
        activeThreadParentId: cached.activeThreadParentId,
        activeThreadGoal: cached.activeThreadGoal,
        activeThreadTodos: cached.activeThreadTodos,
        blocks: cached.blocks,
        lastSeq: cached.lastSeq,
        ...copyLiveProjection(cached),
        error: null,
        busy: cached.busy,
        busyUnconfirmed: cached.busyUnconfirmed,
        currentTurnId: cached.currentTurnId,
        currentTurnOrchestration: cached.currentTurnOrchestration,
        currentTurnUserId: cached.currentTurnUserId,
        turnStartedAtByUserId: cached.turnStartedAtByUserId,
        turnDurationByUserId: cached.turnDurationByUserId,
        turnReasoningFirstAtByUserId: cached.turnReasoningFirstAtByUserId,
        turnReasoningLastAtByUserId: cached.turnReasoningLastAtByUserId,
        inspectorSelectedId: null,
        queuedMessages,
        ...composerState,
        threads: state.threads.map((thread) => thread.id === id
          ? { ...thread, status: cached.busy ? 'running' : 'idle' }
          : thread),
        ...(remembersCodeThread ? { lastCodeThreadId: id } : {})
      }))
      saveQueuedMessagesForThread(id, queuedMessages)
      syncTurnCompletionPoll(set, get)
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
      else if (queuedMessages.some(isPendingQueuedMessage)) void get().drainQueuedMessages()
      return
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
    } else {
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
    try {
      const prewarmHandle = targetThread ? getThreadPrewarmHandle(targetThread) : null
      let detail = await (prewarmHandle?.promise ?? p.getThreadDetail(id))
      if (!selectionStillCurrent()) return
      if (prewarmHandle) {
        const currentThread = get().threads.find((thread) => thread.id === id) ?? null
        // The thread may have advanced while the prewarm request was in
        // flight; a stale detail would both render outdated blocks and be
        // re-cached under the new fingerprint by snapshotThreadProjection.
        if (!threadPrewarmHandleIsCurrent(prewarmHandle, currentThread)) {
          detail = await p.getThreadDetail(id)
          if (!selectionStillCurrent()) return
        }
      }
      const {
        blocks: rawBlocks,
        latestSeq,
        liveProjection,
        threadStatus,
        latestTurnId,
        latestTurnStatus,
        latestTurnOrchestration,
        latestUserMessageId,
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
      const busy = threadSnapshotLooksRunning(loaded, threadStatus, latestTurnStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so selecting the thread doesn't keep it wedged (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const threadSnap = get().threads.find((thread) => thread.id === id) ?? null
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
      const composerState = resolveThreadComposerState(get(), threadSnap, {
        hasUserMessages: rawBlocks.some((block) => block.kind === 'user'),
        runtimeModel: threadModel
      })
      const queuedMessages = reconcileQueuedMessages(durableQueuedMessages, {
        busy,
        turnId: latestTurnId,
        blocks
      })
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
        activeThreadTodos: todos ?? null,
        blocks,
        lastSeq: latestSeq,
        ...restoredLiveProjection(latestSeq, busy ? liveProjection : undefined),
        error: null,
        busy,
        // Replay synchronization confirms the restored running claim.
        busyUnconfirmed: busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnOrchestration: busy ? latestTurnOrchestration ?? 'direct' : null,
        currentTurnUserId,
        turnStartedAtByUserId: {},
        turnDurationByUserId,
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
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
        ...(remembersCodeThread ? { lastCodeThreadId: id } : {}),
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
      } else if (queuedMessages.some(isPendingQueuedMessage)) {
        void get().drainQueuedMessages()
      }
    } catch (e) {
      if (!selectionStillCurrent()) return
      set({
        threadLoadingId: null,
        threadRefreshingId: get().threadRefreshingId === id ? null : get().threadRefreshingId,
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },
  loadEarlierThreadHistory: async () => {
    const state = get()
    const threadId = state.activeThreadId
    const cursor = state.threadHistoryCursor
    if (
      !threadId ||
      !cursor ||
      !state.threadHasMoreHistory ||
      state.threadHistoryLoading
    ) return false
    set({ threadHistoryLoading: true })
    try {
      const detail = await getProvider().getThreadDetail(threadId, { before: cursor })
      if (get().activeThreadId !== threadId) return false
      const olderBlocks = hydrateBlockModelLabels(threadId, detail.blocks)
      if (
        detail.hasMoreHistory === true &&
        (!detail.historyCursor || detail.historyCursor === cursor)
      ) {
        throw new Error('thread history cursor did not advance')
      }
      set((current) => {
        if (current.activeThreadId !== threadId) return { threadHistoryLoading: false }
        return {
          blocks: prependOlderHistoryBlocks(current.blocks, olderBlocks),
          threadHistoryCursor: detail.historyCursor ?? null,
          threadHasMoreHistory: detail.hasMoreHistory === true,
          threadHistoryLoading: false,
          turnDurationByUserId: {
            ...current.turnDurationByUserId,
            ...(detail.turnDurationByUserId ?? {})
          }
        }
      })
      threadActionSharedState.expandedHistoryThreadIds.add(threadId)
      // Expanded history can outgrow the projection cache; a later switch
      // safely rehydrates the latest bounded page instead.
      invalidateThreadSnapshot(threadId)
      return true
    } catch (error) {
      if (get().activeThreadId !== threadId) return false
      set({
        threadHistoryLoading: false,
        error: formatRuntimeError(error)
      })
      return false
    }
  },
  subscribeThreadEventsLive: async (threadId) => {
    if (get().runtimeConnection !== 'ready') return
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return
    runtime.threadSelectionGeneration += 1
    // Live-only entry point for claw channel events (e.g. Feishu / Lark bot
    // replies). Hydrate the canonical persisted snapshot first, then subscribe
    // from exactly that snapshot's latestSeq. Events committed after the HTTP
    // snapshot are replayed by the persisted SSE route, closing the hydrate /
    // subscribe window without replaying historical non-delta lifecycle events
    // over terminal snapshot state.
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    const p = getProvider()
    const prevState = get()
    // Same-thread fallback retains a projection that matches its cursor if the
    // snapshot request fails. Cross-thread fallback starts from an empty
    // projection/cursor and can safely replay from zero.
    const keepExistingBlocks = prevState.activeThreadId === targetThreadId
    const hydratingTarget = !keepExistingBlocks
    const fallbackSinceSeq = keepExistingBlocks ? prevState.lastSeq : 0
    resetBusyRecoveryAttempts()
    clearBusyWatchdog()
    set({
      activeThreadId: targetThreadId,
      threadLoadingId: hydratingTarget ? targetThreadId : prevState.threadLoadingId,
      threadHistoryCursor: keepExistingBlocks ? prevState.threadHistoryCursor : null,
      threadHasMoreHistory: keepExistingBlocks ? prevState.threadHasMoreHistory : false,
      threadHistoryLoading: false,
      blocks: keepExistingBlocks ? prevState.blocks : [],
      lastSeq: fallbackSinceSeq,
      ...(keepExistingBlocks
        ? copyLiveProjection(prevState)
        : emptyLiveProjection(fallbackSinceSeq)),
      unreadThreadIds: { ...prevState.unreadThreadIds, [targetThreadId]: false },
      busy: true,
      busyUnconfirmed: keepExistingBlocks ? prevState.busyUnconfirmed : true,
      currentTurnId:
        keepExistingBlocks && prevState.busy ? prevState.currentTurnId : null,
      currentTurnOrchestration:
        keepExistingBlocks && prevState.busy ? prevState.currentTurnOrchestration : null,
      currentTurnUserId:
        keepExistingBlocks && prevState.busy ? prevState.currentTurnUserId : null,
      turnStartedAtByUserId: keepExistingBlocks ? prevState.turnStartedAtByUserId : {},
      turnDurationByUserId: keepExistingBlocks ? prevState.turnDurationByUserId : {},
      turnReasoningFirstAtByUserId:
        keepExistingBlocks ? prevState.turnReasoningFirstAtByUserId : {},
      turnReasoningLastAtByUserId:
        keepExistingBlocks ? prevState.turnReasoningLastAtByUserId : {},
      inspectorSelectedId: null,
      queuedMessages: keepExistingBlocks
        ? prevState.queuedMessages
        : queuedMessagesForThread(targetThreadId)
    })
    const ac = new AbortController()
    sseAbortRef.current = ac
    const subscribeFrom = (sinceSeq: number, awaitReplaySynchronization = false): void => {
      const sink = buildThreadEventSink(set, get, {
        threadId: targetThreadId,
        signal: ac.signal,
        sinceSeq,
        awaitReplaySynchronization
      })
      subscribeThreadEventsWithRecovery(p, targetThreadId, sinceSeq, sink, ac.signal, get)
    }
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
        liveProjection,
        threadStatus,
        latestTurnId,
        latestTurnStatus,
        latestTurnOrchestration,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos,
        historyCursor,
        hasMoreHistory = false
      } = await p.getThreadDetail(targetThreadId)
      if (ac.signal.aborted || get().activeThreadId !== targetThreadId) return
      const loaded = hydrateBlockModelLabels(targetThreadId, rawBlocks)
      const busy = threadSnapshotLooksRunning(loaded, threadStatus, latestTurnStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so the thread doesn't stay wedged on load (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const queuedMessages = reconcileQueuedMessages(get().queuedMessages, {
        busy,
        turnId: latestTurnId,
        blocks
      })
      set({
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        threadLoadingId: busy && (hydratingTarget || get().threadLoadingId === targetThreadId)
          ? targetThreadId : null,
        threadHistoryCursor: historyCursor ?? null,
        threadHasMoreHistory: hasMoreHistory,
        threadHistoryLoading: false,
        blocks,
        lastSeq: latestSeq,
        ...restoredLiveProjection(latestSeq, busy ? liveProjection : undefined),
        busy,
        // Replay synchronization confirms the restored running claim.
        busyUnconfirmed: busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnOrchestration: busy ? latestTurnOrchestration ?? 'direct' : null,
        currentTurnUserId,
        turnDurationByUserId,
        queuedMessages,
        threads: get().threads.map((thread) => thread.id === targetThreadId
          ? {
              ...thread,
              status: thread.archived ? thread.status : busy ? 'running' : 'idle',
              ...(latestTurnId ? { latestTurnId } : {}),
              ...(latestTurnStatus ? { latestTurnStatus } : {})
            }
          : thread)
      })
      saveQueuedMessagesForThread(targetThreadId, queuedMessages)
      // The server replays every event persisted after latestSeq, including
      // events committed while getThreadDetail was in flight.
      subscribeFrom(latestSeq, busy)
      if (busy) armBusyWatchdog(set, get)
      if (!busy && queuedMessages.some(isPendingQueuedMessage)) {
        void get().drainQueuedMessages()
      }
    } catch (e) {
      if (ac.signal.aborted || get().activeThreadId !== targetThreadId) return
      // The fallback cursor matches the projection installed above, so this
      // cannot replay older lifecycle records over newer on-screen state.
      subscribeFrom(fallbackSinceSeq)
      if (get().busy) armBusyWatchdog(set, get)
      set({
        threadLoadingId: get().threadLoadingId === targetThreadId ? null : get().threadLoadingId,
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },
  }
}
