import type {
  ChatBlock,
  CompactionBlock,
  NormalizedThread,
  ReviewBlock,
  ReviewEventPayload,
  RuntimeStatusEventPayload,
  ThreadEventSink,
  ToolBlock,
  ToolEventPayload,
  TurnTerminalEvent,
  UserInputQuestion
} from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import {
  isClawWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot
} from '../lib/workspace-path'
import type { ClawImChannelV1 } from '@shared/app-settings'
import type { TurnCompleteNotificationSource } from '@shared/kun-gui-api'
import { isBackgroundShellNoticeUserMessage } from '@shared/background-shell-notice'
import type { ChatState } from './chat-store-types'
import { drainBackgroundQueuedMessage } from './chat-store-background-queue'
import { isPendingQueuedMessage } from './queued-message-persistence'
import {
  clearThreadAwaitingUserInput,
  markThreadAwaitingUserInput,
  withoutAwaitingUserInput
} from './awaiting-user-input-registry'
import { reconcileCompletedTurnFromThreadDetail } from './chat-store-runtime-reconcile'
import { hydrateBlockModelLabels, isClawThread } from './chat-store-helpers'
import {
  collectAssistantTextForTurn,
  isOptimisticUserBlockId,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadLooksRunning,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import {
  clearUnreadCompletion,
  completionOutcomeForTurnStatus,
  completionIsCurrentlyVisible,
  markUnreadCompletion
} from './unread-completions'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import {
  isWriteAssistantThread,
  type WriteThreadRegistry
} from '../write/write-thread-registry'
import {
  isSddAssistantThread,
  type SddThreadRegistry
} from '../sdd/sdd-thread-registry'
import { isDesignThreadId, type DesignThreadRegistry } from '../design/design-thread-registry'
import { readThreadWorktreeRegistry, saveThreadWorktreeRegistry, forgetThreadWorktree } from '../lib/thread-worktree-registry'
import { notifySddChatTranscriptMirror } from '../sdd/sdd-chat-transcript'
import { notifyDesignChatTranscriptMirror } from '../design/design-chat-transcript'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { recordCanvasTurnTerminal } from '../design/canvas/canvas-turn-terminal-registry'
import {
  flushLiveProjection,
  mergeToolProjectionEvents,
  reduceChatProjection,
  toolBlockChildId,
  toolEventChildId
} from './chat-projection-reducer'
import {
  completionProjectionEffects,
  terminalFailureProjectionEffects,
  type ChatProjectionEffect
} from './chat-projection-effects'
import {
  receiveGraphChildRuntimeEvent,
  receiveGraphPlanningRuntimeEvent,
  receiveGraphRuntimeEvent
} from '../graph/graph-store'
import {
  armBusyWatchdog as armBusyWatchdogImpl,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  syncTurnCompletionPoll as syncTurnCompletionPollImpl
} from './chat-store-schedulers'

import {
  BUSY_WATCHDOG_MS,
  MAX_BUSY_RECOVERY_ATTEMPTS,
  MAX_PENDING_CHILD_TOOL_UPDATES,
  clearRuntimeStreamRecoveringError,
  clearWatchedCompletionNotification,
  completionNotificationDedupeKeyForWatchedThread,
  isInterruptSettledError,
  notifyTurnComplete,
  notifyUserInputAwaiting,
  runtimeErrorDetail,
  takePendingClawFeishuMirror,
  watchTurnCompletionNotification,
  watchCompletionNotificationKeys,
  watchCompletionNotificationSources
} from './chat-store-runtime-notifications'
import {
  finalizeTurnTiming,
  flushLiveBlocks,
  goalTimelineText,
  isDetachedSubagentToolEvent,
  notifyWriteWorkspaceFileRefresh,
  publishLiveOfficePreviewForToolEvent,
  releaseThreadWorktreeIfNeeded,
  runtimeErrorPayloadToError,
  runtimeStatusText,
  upsertRuntimeErrorBlock
} from './chat-store-runtime-projection-support'
import { loadThreadStates as loadProviderThreadStates } from '../agent/thread-state-loader'
import {
  replayCursorPatch,
  replayLoadingIsPending,
  replaySynchronizedPatch,
  type ThreadEventSinkBinding
} from './thread-presentation-readiness'

export * from './chat-store-runtime-reexports'
export type { ThreadEventSinkBinding } from './thread-presentation-readiness'

export function armBusyWatchdog(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  armBusyWatchdogImpl(set, get, {
    timeoutMs: BUSY_WATCHDOG_MS,
    maxAttempts: MAX_BUSY_RECOVERY_ATTEMPTS,
    finalizeBusyState: finalizeTurnTiming,
    // Settle stuck running/pending blocks alongside the live flush: a
    // timed-out turn that leaves a tool block "running" keeps
    // hasPendingRuntimeWork true, which queues every later message
    // forever ("queued, sends after current reply") with nothing to
    // drain it.
    flushLiveBlocks: (state, base) => {
      const flushed = flushLiveBlocks(state, base)
      const blocks = settlePendingRuntimeWorkAfterInterrupt(flushed.blocks ?? state.blocks)
      return { ...flushed, blocks }
    },
    busyTimeoutMessage: () => i18n.t('common:busyTimeout', { minutes: Math.round((BUSY_WATCHDOG_MS * MAX_BUSY_RECOVERY_ATTEMPTS) / 60_000) })
  })
}

export function syncTurnCompletionPoll(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  syncTurnCompletionPollImpl(set, get, {
    loadThreadState: async (state, threadId) => {
      const provider = getProvider()
      const completionWatchKey = watchCompletionNotificationKeys.get(threadId)
      return {
        ...(await provider.getThreadState(threadId)),
        ...(completionWatchKey ? { completionWatchKey } : {})
      }
    },
    loadThreadStates: async (_state, threadIds) => {
      const provider = getProvider()
      const results = await loadProviderThreadStates(provider, threadIds)
      return results.map((result) => result.ok
        ? {
            id: result.id,
            ok: true as const,
            state: {
              ...result.state,
              ...(watchCompletionNotificationKeys.get(result.id)
                ? { completionWatchKey: watchCompletionNotificationKeys.get(result.id) }
                : {})
            }
          }
        : {
            id: result.id,
            ok: false as const,
            missing: result.error.code === 'not_found'
          })
    },
    threadLooksRunning,
    onCompletedThreads: async (done, _state, setState, getState) => {
      // Claim watches atomically inside the functional update. Between the
      // poll response and this commit the user may have switched away and
      // re-created a watch for a newer turn on the same thread; only the watch
      // token captured at request start may be cleared, and only when it is
      // still the current one. Notifications/cache invalidation run after the
      // claim so they never fire for a watch that was not actually removed.
      let claimed: typeof done = []
      setState((snapshot) => {
        const accepted = done.filter(({ id, completionWatchKey, latestTurnId }) => {
          if (!snapshot.watchTurnCompletion[id]) return false
          if (
            completionWatchKey &&
            watchCompletionNotificationKeys.get(id) !== completionWatchKey
          ) return false
          // A slow poll can answer for an already-replaced turn. Never claim
          // the newer watch with terminal evidence whose turn identity no
          // longer matches the thread's current turn.
          if (
            latestTurnId &&
            snapshot.activeThreadId === id &&
            snapshot.currentTurnId &&
            latestTurnId !== snapshot.currentTurnId
          ) return false
          return true
        })
        if (accepted.length === 0) return snapshot
        claimed = accepted
        const watchTurnCompletion = { ...snapshot.watchTurnCompletion }
        let unreadThreadIds = snapshot.unreadThreadIds
        const completedById = new Map(accepted.map((item) => [item.id, item]))
        for (const { id } of accepted) {
          delete watchTurnCompletion[id]
          const outcome = completionOutcomeForTurnStatus(completedById.get(id)?.latestTurnStatus)
          unreadThreadIds = !outcome || completionIsCurrentlyVisible(snapshot, id)
            ? clearUnreadCompletion(unreadThreadIds, id)
            : markUnreadCompletion(unreadThreadIds, id, outcome)
        }
        return {
          watchTurnCompletion,
          unreadThreadIds,
          threads: snapshot.threads.map((thread) => {
            const completion = completedById.get(thread.id)
            if (!completion) return thread
            return {
              ...thread,
              status: thread.archived ? thread.status : 'idle',
              ...(completion.latestTurnId ? { latestTurnId: completion.latestTurnId } : {}),
              ...(completion.latestTurnStatus ? { latestTurnStatus: completion.latestTurnStatus } : {})
            }
          })
        }
      })
      if (claimed.length === 0) return
      const notificationState = getState()
      for (const { id, completionWatchKey, latestTurnId } of claimed) {
        const notificationSource = watchCompletionNotificationSources.get(id)
        notifyTurnComplete(
          id,
          notificationState,
          completionWatchKey ?? completionNotificationDedupeKeyForWatchedThread(id),
          notificationSource
        )
        clearWatchedCompletionNotification(id)
        invalidateThreadSnapshot(id)
        await drainBackgroundQueuedMessage({
          threadId: id,
          completedTurnId: latestTurnId,
          provider: getProvider(),
          set: setState,
          get: getState,
          onTurnStarted: () => {
            setState((snapshot) => ({
              watchTurnCompletion: { ...snapshot.watchTurnCompletion, [id]: true }
            }))
            watchTurnCompletionNotification(id, Date.now(), notificationSource)
            syncTurnCompletionPoll(setState, getState)
            if (getState().activeThreadId === id) {
              void getState().recoverActiveTurn()
            }
          }
        })
      }
      void getState().refreshThreads()
    },
    isMissingThreadError: (error) => getRuntimeErrorCode(error) === 'not_found',
    onMissingThreads: async (ids, _state, setState) => {
      let cleared: string[] = []
      setState((snapshot) => {
        const removed = ids.filter((id) => snapshot.watchTurnCompletion[id])
        if (removed.length === 0) return snapshot
        cleared = removed
        const watchTurnCompletion = { ...snapshot.watchTurnCompletion }
        const unreadThreadIds = { ...snapshot.unreadThreadIds }
        for (const id of removed) {
          delete watchTurnCompletion[id]
          delete unreadThreadIds[id]
        }
        return { watchTurnCompletion, unreadThreadIds }
      })
      for (const id of cleared) {
        clearWatchedCompletionNotification(id)
        invalidateThreadSnapshot(id)
      }
    }
  })
}

export function buildThreadEventSink(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  binding: ThreadEventSinkBinding = {}
): ThreadEventSink {
  const boundThreadId = binding.threadId?.trim() ?? ''
  let appliedDeltaSeqFloor = binding.sinceSeq ?? 0
  // Hydrated threads subscribe exactly at their snapshot's high-water mark, so
  // the first accepted event on a stream is live runtime evidence: any pending
  // unconfirmed busy flag from snapshot hydration is resolved as soon as one
  // arrives. Heartbeats alone do not confirm a running turn.
  const confirmBusyOnce = (): void => {
    if (get().busyUnconfirmed) set({ busyUnconfirmed: false })
  }
  // Update-only child lifecycle events can race their parent tool card. Keep
  // that short-lived repair state inside this one stream so reconnects and
  // other threads cannot consume each other's child ids.
  const pendingChildToolUpdates = new Map<string, ToolEventPayload>()
  const loadThreadDetail = binding.getThreadDetail ?? ((threadId: string) => getProvider().getThreadDetail(threadId))
  const reduce = (state: ChatState, action: Parameters<typeof reduceChatProjection>[1]): Partial<ChatState> =>
    reduceChatProjection(state, action, {
      now: Date.now(),
      clearRecoveringError: clearRuntimeStreamRecoveringError,
      goalTimelineText,
      runtimeStatusText,
      runtimeErrorView: (event) => describeRuntimeError(runtimeErrorPayloadToError(event)),
      upsertRuntimeError: upsertRuntimeErrorBlock,
      formatRuntimeError,
      runtimeErrorDetail,
      isInterruptSettledError,
      settlePendingRuntimeWork: settlePendingRuntimeWorkAfterInterrupt,
      threadSnapshotLooksRunning
    })
  const isCurrentStream = (): boolean => {
    if (binding.signal?.aborted) return false
    return !boundThreadId || get().activeThreadId === boundThreadId
  }
  const runEffects = (effects: readonly ChatProjectionEffect[]): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'arm_stream_watchdog':
          armBusyWatchdog(set, get)
          break
        case 'refresh_write_workspace':
          notifyWriteWorkspaceFileRefresh(get, effect.event)
          break
        case 'mirror_claw_reply':
          if (typeof window.kunGui?.mirrorClawChannelMessage === 'function') {
            void window.kunGui.mirrorClawChannelMessage(effect.threadId, effect.text, 'assistant')
              .catch(() => undefined)
          }
          break
        case 'notify_turn_complete':
          notifyTurnComplete(effect.threadId, effect.state, effect.dedupeKey)
          break
        case 'mirror_sdd_transcript':
          notifySddChatTranscriptMirror(get)
          break
        case 'mirror_design_transcript':
          notifyDesignChatTranscriptMirror(get)
          break
        case 'sync_completion_poll':
          syncTurnCompletionPoll(set, get)
          break
        case 'reload_completed_turn':
          void reconcileCompletedTurnFromThreadDetail({
            threadId: effect.threadId,
            turnId: effect.turnId,
            userBlockId: effect.userBlockId,
            loadThreadDetail,
            set,
            get
          })
          break
        case 'refresh_threads':
          void get().refreshThreads?.()
          break
        case 'release_worktree':
          releaseThreadWorktreeIfNeeded(effect.threadId)
          break
        case 'drain_queued_messages':
          void get().drainQueuedMessages?.()
          break
      }
    }
  }

  return {
    onSeq: (seq) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      // Every event/heartbeat postpones recovery; only stream inactivity
      // should trip the busy watchdog during a long-running tool call.
      if (get().busy) armBusyWatchdog(set, get)
      set((s) => ({
        ...replayCursorPatch(s, seq),
        error: clearRuntimeStreamRecoveringError(s.error)
      }))
    },
    onReplaySynchronized: (cursor) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => ({
        ...replaySynchronizedPatch(state, boundThreadId, binding.awaitReplaySynchronization, cursor),
        error: clearRuntimeStreamRecoveringError(state.error)
      }))
    },
    onUserMessage: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      armBusyWatchdog(set, get)
      confirmBusyOnce()
      set((state) => reduce(state, { type: 'user_message_received', payload: event }))
    },
    onDeltas: (rawDeltas) => {
      if (!isCurrentStream()) return
      const deltas: typeof rawDeltas = []
      for (const delta of rawDeltas) {
        if (typeof delta.seq === 'number') {
          if (delta.seq <= appliedDeltaSeqFloor) continue
          appliedDeltaSeqFloor = delta.seq
        }
        deltas.push(delta)
      }
      if (deltas.length === 0) return
      resetBusyRecoveryAttempts()
      if (!get().busy) armBusyWatchdog(set, get)
      confirmBusyOnce()
      set((state) => reduce(state, { type: 'deltas_received', deltas }))
    },
    onAssistantItem: (item) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'assistant_item_upserted', payload: item }))
    },
    onTool: (event) => {
      if (!isCurrentStream()) return
      publishLiveOfficePreviewForToolEvent(get(), event, boundThreadId || undefined)
      runEffects([{ type: 'refresh_write_workspace', event }])
      resetBusyRecoveryAttempts()
      confirmBusyOnce()
      if (!get().busy && !event.updateOnly && !isDetachedSubagentToolEvent(event)) {
        armBusyWatchdog(set, get)
      }
      set((state) => {
        const eventChildId = toolEventChildId(event)
        const existing = state.blocks.some((block) =>
          block.kind === 'tool' && (
            block.id === event.itemId ||
            Boolean(eventChildId && toolBlockChildId(block) === eventChildId)
          )
        )
        if (!existing && event.updateOnly) {
          if (eventChildId) {
            pendingChildToolUpdates.delete(eventChildId)
            pendingChildToolUpdates.set(eventChildId, event)
            while (pendingChildToolUpdates.size > MAX_PENDING_CHILD_TOOL_UPDATES) {
              const oldestChildId = pendingChildToolUpdates.keys().next().value
              if (!oldestChildId) break
              pendingChildToolUpdates.delete(oldestChildId)
            }
          }
          return {}
        }
        let projectedEvent = event
        if (!existing && eventChildId) {
          const pending = pendingChildToolUpdates.get(eventChildId)
          if (pending) {
            pendingChildToolUpdates.delete(eventChildId)
            projectedEvent = mergeToolProjectionEvents(event, pending)
          }
        }
        return reduce(state, { type: 'tool_updated', payload: projectedEvent })
      })
    },
    onCompaction: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      confirmBusyOnce()
      if (!get().busy && event.status === 'running') armBusyWatchdog(set, get)
      if (get().busy && event.status !== 'running' && !get().currentTurnId) clearBusyWatchdog()
      set((state) => reduce(state, { type: 'compaction_updated', payload: event }))
    },
    onReview: (event: ReviewEventPayload) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (!get().busy && event.status === 'running') armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'review_updated', payload: event }))
    },
    onApproval: (request) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'approval_received', payload: request }))
    },
    onApprovalStatus: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'approval_status_changed', payload: event }))
    },
    onApprovalReview: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (!get().busy && event.status === 'in-progress') armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'approval_review_updated', payload: event }))
    },
    onUserInput: (request) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const awaitingThreadId = boundThreadId || get().activeThreadId
      markThreadAwaitingUserInput(set, get, awaitingThreadId)
      // Only notify when the asking thread is not on screen; the visible thread
      // already shows the composer panel, awaiting progress row, and badge.
      if (awaitingThreadId && awaitingThreadId !== get().activeThreadId) {
        notifyUserInputAwaiting(awaitingThreadId, get(), `user-input:${request.requestId}`)
      }
      set((state) => reduce(state, { type: 'user_input_requested', payload: request }))
    },
    onUserInputStatus: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearThreadAwaitingUserInput(set, get, boundThreadId || get().activeThreadId)
      if (event.status === 'submitted' && get().busy) armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'user_input_status_changed', payload: event }))
    },
    onRuntimeStatus: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (!get().busy) armBusyWatchdog(set, get)
      set((state) => reduce(state, { type: 'runtime_status_received', payload: event }))
    },
    onRuntimeError: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'runtime_error_received', payload: event }))
    },
    onGoal: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'goal_changed', payload: event }))
    },
    onTodos: (event) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((state) => reduce(state, { type: 'todos_changed', payload: event }))
    },
    onThreadUpdated: (event) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, { type: 'thread_metadata_changed', payload: event }))
    },
    onTurnComplete: (event: TurnTerminalEvent = { status: 'completed' }) => {
      if (!isCurrentStream()) return
      // The mapper now preserves terminal identity. A child lifecycle event or
      // a replay for an older turn must never settle this stream's active turn.
      if (event.child) return
      if (event.turnId) recordCanvasTurnTerminal(event.turnId, event.status, event.threadId)
      const activeState = get()
      if (event.threadId && event.threadId !== (boundThreadId || activeState.activeThreadId)) return
      if (!event.turnId) {
        // Older producers dropped terminal identity. Do not settle the active
        // turn from that weak signal; wake the state poll so the durable
        // thread state can confirm it instead.
        syncTurnCompletionPoll(set, get)
        return
      }
      if (event.turnId !== activeState.currentTurnId) return
      // Reconnect/replay can deliver the same terminal event after the first
      // projection already cleared the active turn. Treat it as a no-op so
      // notifications, mirrors, workspace refreshes and queue drains remain
      // once-only for one completion identity.
      if (!activeState.busy && !activeState.currentTurnId) return
      const status = event.status
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const completedState = get()
      const completedThreadId = completedState.activeThreadId
      const completedTurnId = event.turnId ?? completedState.currentTurnId
      const completedUserBlockId = completedState.currentTurnUserId
      const completedKey = completedState.currentTurnId
        ? `turn:${completedState.currentTurnId}`
        : `active:${completedThreadId ?? 'unknown'}:${event.seq ?? completedState.lastSeq}`
      const pendingMirror = takePendingClawFeishuMirror(completedTurnId)
      const assistantMirrorText =
        pendingMirror
          ? collectAssistantTextForTurn(
              completedState.blocks,
              pendingMirror.userBlockId,
              completedState.liveAssistant
            )
          : ''
      set((state) => {
        const patch = reduce(state, {
          type: status === 'aborted' ? 'turn_aborted' : 'turn_completed',
          payload: {
            status,
            ...(event.threadId ? { threadId: event.threadId } : {}),
            ...(event.turnId ? { turnId: event.turnId } : {}),
            ...(typeof event.seq === 'number' ? { seq: event.seq } : {})
          }
        })
        if (!completedThreadId) return patch
        return {
          ...patch,
          awaitingUserInputThreadIds: withoutAwaitingUserInput(
            state.awaitingUserInputThreadIds,
            completedThreadId
          ),
          unreadThreadIds: status === 'aborted' || completionIsCurrentlyVisible(state, completedThreadId)
            ? clearUnreadCompletion(state.unreadThreadIds, completedThreadId)
            : markUnreadCompletion(state.unreadThreadIds, completedThreadId)
        }
      })
      if (completedThreadId) clearWatchedCompletionNotification(completedThreadId)
      runEffects(completionProjectionEffects({
        state: completedState,
        threadId: completedThreadId,
        turnId: completedTurnId,
        userBlockId: completedUserBlockId,
        dedupeKey: completedKey,
        mirrorText: pendingMirror && assistantMirrorText ? assistantMirrorText : undefined,
        mirrorThreadId: pendingMirror?.threadId,
        reconcile: true,
        releaseWorktree: !get().queuedMessages.some(isPendingQueuedMessage)
      }))
    },
    onError: (err, options) => {
      if (!isCurrentStream()) return
      // Stale-terminal guard mirroring onTurnComplete: a replayed or out-of-order
      // failure for another thread/turn must never clear the newer active turn.
      const active = get()
      if (options?.threadId && options.threadId !== (boundThreadId || active.activeThreadId)) return
      if (options?.turnId && active.currentTurnId && options.turnId !== active.currentTurnId) return
      if (options?.terminal === true && options?.turnId) recordCanvasTurnTerminal(options.turnId, 'failed', options.threadId)
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const state = get()
      const terminal = options?.terminal === true
      takePendingClawFeishuMirror(state.currentTurnId)
      const payload = {
        ...(options?.threadId ? { threadId: options.threadId } : {}),
        ...(options?.turnId ? { turnId: options.turnId } : {}),
        ...(typeof options?.seq === 'number' ? { seq: options.seq } : {}),
        error: err, options
      }
      set((current) => reduce(current, { type: 'turn_failed', payload }))
      if (replayLoadingIsPending(get(), boundThreadId, binding.awaitReplaySynchronization)) {
        // Do not leave the conversation permanently covered when replay must
        // recover. The cached projection and recovery error remain usable.
        set({ threadLoadingId: null })
      }
      if (terminal && state.activeThreadId) {
        set((current) => ({
          unreadThreadIds: completionIsCurrentlyVisible(current, state.activeThreadId!)
            ? clearUnreadCompletion(current.unreadThreadIds, state.activeThreadId!)
            : markUnreadCompletion(current.unreadThreadIds, state.activeThreadId!, 'failed')
        }))
        clearWatchedCompletionNotification(state.activeThreadId)
        void reconcileCompletedTurnFromThreadDetail({
          threadId: state.activeThreadId,
          turnId: state.currentTurnId,
          userBlockId: state.currentTurnUserId,
          loadThreadDetail,
          set,
          get
        })
      }
      if (terminal) {
        runEffects(terminalFailureProjectionEffects(
          state.activeThreadId,
          !get().queuedMessages.some(isPendingQueuedMessage)
        ))
        return
      }
      // Re-arm the watchdog so a stuck SSE stream doesn't leave the UI
      // permanently in the busy state.
      if (get().busy) runEffects([{ type: 'arm_stream_watchdog' }])
    },
    onUsage: (usage) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, { type: 'usage_received', payload: usage }))
    },
    onContextSnapshot: (snapshot) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, { type: 'context_snapshot_received', payload: snapshot }))
    },
    onDelegatedRuntimeState: (runtimeState) => {
      if (!isCurrentStream()) return
      set((state) => reduce(state, {
        type: 'delegated_runtime_received',
        payload: runtimeState
      }))
    },
    onChildRuntimeEvent: (event) => {
      if (!isCurrentStream()) return
      receiveGraphChildRuntimeEvent(event)
    },
    onGraphEvent: (event) => {
      if (!isCurrentStream()) return
      receiveGraphRuntimeEvent(event)
    },
    onGraphPlanningEvent: (event) => {
      if (!isCurrentStream()) return
      receiveGraphPlanningRuntimeEvent(event)
    }
  }
}
