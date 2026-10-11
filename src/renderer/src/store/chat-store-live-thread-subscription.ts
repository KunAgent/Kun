import { getProvider } from '../agent/registry'
import { formatRuntimeError } from '../lib/format-runtime-error'
import type { ChatState } from './chat-store-types'
import type { StoreActionContext, ThreadActionRuntime } from './chat-store-thread-actions-support'
import { hydrateBlockModelLabels } from './chat-store-helpers'
import { findLatestUserBlockId, settlePendingRuntimeWorkAfterInterrupt, threadSnapshotLooksRunning } from './chat-store-runtime-helpers'
import { clearBusyWatchdog, resetBusyRecoveryAttempts } from './chat-store-schedulers'
import { armBusyWatchdog, buildThreadEventSink, shouldOpenSettingsForError } from './chat-store-runtime'
import { clearedTurnTimingPatch, turnTimingSnapshotPatch } from './thread-snapshot-cache'
import { copyLiveProjection, emptyLiveProjection, restoredLiveProjection } from './chat-store-live-projection'
import { isPendingQueuedMessage, queuedMessagesForThread, reconcileQueuedMessages, saveQueuedMessagesForThread } from './queued-message-persistence'
import { subscribeThreadEventsWithRecovery } from './chat-store-thread-action-helpers'
import { threadTodosForProjection } from './thread-todo-projection'
import { syncThreadAdditionalWorkspaces } from './chat-store-workspace-folder-sync'

export function createLiveThreadSubscription(
  context: StoreActionContext,
  runtime: ThreadActionRuntime
): ChatState['subscribeThreadEventsLive'] {
  const { set, get, sseAbortRef } = context
  return async (threadId) => {
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
      ...(keepExistingBlocks && prevState.busy
        ? turnTimingSnapshotPatch(prevState)
        : clearedTurnTimingPatch({ keepExistingBlocks, previous: prevState })),
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
        activeTurn,
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
        goal,
        todos,
        historyCursor,
        hasMoreHistory = false,
        additionalWorkspaces
      } = await p.getThreadDetail(targetThreadId)
      if (ac.signal.aborted || get().activeThreadId !== targetThreadId) return
      const loaded = hydrateBlockModelLabels(targetThreadId, rawBlocks)
      const busy = activeTurn !== undefined ? Boolean(activeTurn)
        : threadSnapshotLooksRunning(loaded, threadStatus, latestTurnStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so the thread doesn't stay wedged on load (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const queuedMessages = reconcileQueuedMessages(get().queuedMessages, {
        busy,
        turnId: activeTurn !== undefined ? activeTurn?.id : latestTurnId,
        blocks
      })
      set({
        activeThreadGoal: goal ?? null,
        activeThreadTodos: threadTodosForProjection(get(), targetThreadId, todos),
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
        currentTurnId: activeTurn !== undefined ? activeTurn?.id ?? null : busy ? latestTurnId ?? null : null,
        currentTurnOrchestration: activeTurn !== undefined ? activeTurn?.orchestration ?? null : busy ? latestTurnOrchestration ?? 'direct' : null,
        currentTurnUserId,
        currentTurnStartedAtMs: busy ? latestTurnStartedAtMs ?? null : null,
        turnDurationByUserId,
        queuedMessages,
        threads: get().threads.map((thread) => thread.id === targetThreadId
          ? {
              ...thread,
              status: thread.archived ? thread.status : busy ? 'running' : 'idle',
              ...(latestTurnId ? { latestTurnId } : {}),
              ...(latestTurnStatus ? { latestTurnStatus } : {}),
              ...(additionalWorkspaces ? { additionalWorkspaces } : {})
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
      if (!busy) {
        void syncThreadAdditionalWorkspaces({
          set,
          get,
          threadId: targetThreadId,
          mergeExtras: additionalWorkspaces
        })
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
  }
}
