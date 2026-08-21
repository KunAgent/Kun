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

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
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
    const cached = prevId !== id ? getThreadSnapshot(id) : null
    const targetThread = get().threads.find((thread) => thread.id === id) ?? null
    resetBusyRecoveryAttempts()
    clearBusyWatchdog()
    if (cached) {
      const queuedMessages = reconcileQueuedMessages(cached.queuedMessages, {
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
      set((state) => ({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        threadLoadingId: null,
        threadHistoryCursor: cached.threadHistoryCursor,
        threadHasMoreHistory: cached.threadHasMoreHistory,
        threadHistoryLoading: false,
        activeThreadRelation: cached.activeThreadRelation ?? 'primary',
        activeThreadParentId: cached.activeThreadParentId,
        activeThreadGoal: cached.activeThreadGoal,
        activeThreadTodos: cached.activeThreadTodos,
        blocks: cached.blocks,
        lastSeq: cached.lastSeq,
        liveDeltaSeqFloor: cached.liveDeltaSeqFloor,
        liveReasoning: cached.liveReasoning,
        liveAssistant: cached.liveAssistant,
        error: null,
        busy: cached.busy,
        currentTurnId: cached.currentTurnId,
        currentTurnOrchestration: cached.currentTurnOrchestration,
        currentTurnUserId: cached.currentTurnUserId,
        turnStartedAtByUserId: cached.turnStartedAtByUserId,
        turnDurationByUserId: cached.turnDurationByUserId,
        turnReasoningFirstAtByUserId: cached.turnReasoningFirstAtByUserId,
        turnReasoningLastAtByUserId: cached.turnReasoningLastAtByUserId,
        inspectorSelectedId: null,
        queuedMessages,
        composerMode: cached.composerMode,
        composerModel: cached.composerModel,
        composerProviderId: cached.composerProviderId,
        composerReasoningEffort: cached.composerReasoningEffort,
        threads: state.threads.map((thread) => thread.id === id
          ? { ...thread, status: cached.busy ? 'running' : 'idle' }
          : thread),
        ...(remembersCodeThread ? { lastCodeThreadId: id } : {})
      }))
      saveQueuedMessagesForThread(id, queuedMessages)
      syncTurnCompletionPoll(set, get)
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: id, signal: ac.signal, sinceSeq: cached.lastSeq })
      subscribeThreadEventsWithRecovery(p, id, cached.lastSeq, sink, ac.signal, get)
      if (cached.busy) armBusyWatchdog(set, get)
      else if (queuedMessages.some(isPendingQueuedMessage)) void get().drainQueuedMessages()
      return
    }
    // Give the sidebar its selected state in this render frame. The timeline
    // shows a skeleton and the composer is disabled until detail hydration
    // commits, preventing sends against an unhydrated thread.
    set({
      watchTurnCompletion: nextWatch,
      unreadThreadIds: nextUnread,
      activeThreadId: id,
      threadLoadingId: id,
      threadHistoryCursor: null,
      threadHasMoreHistory: false,
      threadHistoryLoading: false,
      activeThreadRelation: targetThread?.relation ?? 'primary',
      activeThreadParentId: targetThread?.parentThreadId ?? null,
      activeThreadGoal: targetThread?.goal ?? null,
      activeThreadTodos: targetThread?.todos ?? null,
      blocks: [],
      lastSeq: 0,
      liveDeltaSeqFloor: 0,
      liveReasoning: '',
      liveAssistant: '',
      busy: false,
      currentTurnId: null,
      currentTurnOrchestration: null,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      inspectorSelectedId: null,
      queuedMessages: [],
      error: null
    })
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
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
      } = await p.getThreadDetail(id)
      if (!selectionStillCurrent()) return
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
      const composerSelection = composerSelectionForThread(get(), threadSnap, {
        hasUserMessages: rawBlocks.some((block) => block.kind === 'user'),
        runtimeModel: threadModel
      })
      const composerMode = composerModeForThread(threadSnap, readThreadComposerMode(id))
      const queuedMessages = reconcileQueuedMessages(durableQueuedMessages, {
        busy,
        turnId: latestTurnId,
        blocks
      })
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        threadLoadingId: null,
        threadHistoryCursor: historyCursor ?? null,
        threadHasMoreHistory: hasMoreHistory,
        threadHistoryLoading: false,
        activeThreadRelation: threadRelation ?? 'primary',
        activeThreadParentId: threadParentId ?? null,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        blocks,
        lastSeq: latestSeq,
        liveDeltaSeqFloor: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnOrchestration: busy ? latestTurnOrchestration ?? 'direct' : null,
        currentTurnUserId,
        turnStartedAtByUserId: {},
        turnDurationByUserId,
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
        inspectorSelectedId: null,
        queuedMessages,
        composerMode,
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
        ...(composerSelection
          ? {
              composerModel: composerSelection.model,
              composerProviderId: composerSelection.providerId,
              composerReasoningEffort: composerReasoningEffortForSelection(
                get().composerModelGroups,
                composerSelection.model,
                composerSelection.providerId
              )
            }
          : {})
      })
      snapshotThreadProjection(get(), payloadBytes)
      saveQueuedMessagesForThread(id, queuedMessages)
      syncTurnCompletionPoll(set, get)
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: id, signal: ac.signal, sinceSeq: latestSeq })
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
      state.threadHistoryLoading ||
      state.busy
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
    const fallbackSinceSeq = keepExistingBlocks ? prevState.lastSeq : 0
    resetBusyRecoveryAttempts()
    clearBusyWatchdog()
    set({
      activeThreadId: targetThreadId,
      threadLoadingId: null,
      threadHistoryCursor: keepExistingBlocks ? prevState.threadHistoryCursor : null,
      threadHasMoreHistory: keepExistingBlocks ? prevState.threadHasMoreHistory : false,
      threadHistoryLoading: false,
      blocks: keepExistingBlocks ? prevState.blocks : [],
      lastSeq: fallbackSinceSeq,
      liveDeltaSeqFloor: fallbackSinceSeq,
      liveReasoning: '',
      liveAssistant: '',
      unreadThreadIds: { ...prevState.unreadThreadIds, [targetThreadId]: false },
      busy: true,
      currentTurnId: null,
      currentTurnOrchestration:
        keepExistingBlocks && prevState.busy ? prevState.currentTurnOrchestration : null,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      inspectorSelectedId: null,
      queuedMessages: keepExistingBlocks
        ? prevState.queuedMessages
        : queuedMessagesForThread(targetThreadId)
    })
    const ac = new AbortController()
    sseAbortRef.current = ac
    const subscribeFrom = (sinceSeq: number): void => {
      const sink = buildThreadEventSink(set, get, {
        threadId: targetThreadId,
        signal: ac.signal,
        sinceSeq
      })
      subscribeThreadEventsWithRecovery(p, targetThreadId, sinceSeq, sink, ac.signal, get)
    }
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
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
      if (ac.signal.aborted) return
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
        threadHistoryCursor: historyCursor ?? null,
        threadHasMoreHistory: hasMoreHistory,
        threadHistoryLoading: false,
        blocks,
        lastSeq: latestSeq,
        liveDeltaSeqFloor: latestSeq,
        busy,
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
      subscribeFrom(latestSeq)
      if (busy) armBusyWatchdog(set, get)
      if (!busy && queuedMessages.some(isPendingQueuedMessage)) {
        void get().drainQueuedMessages()
      }
    } catch (e) {
      if (ac.signal.aborted) return
      // The fallback cursor matches the projection installed above, so this
      // cannot replay older lifecycle records over newer on-screen state.
      subscribeFrom(fallbackSinceSeq)
      if (get().busy) armBusyWatchdog(set, get)
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },
  }
}
