import type { ChatBlock } from '../agent/types'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import type { ChatProjectionReducerContext } from './chat-projection-reducer'
import {
  finalizeTurnTimingAt,
  flushLiveProjection,
  reconcileSnapshotBlocks,
  reconcileSnapshotTurn,
  settleProjectedThreadStatus,
  updateProjectedThreadStatus,
  upsertProjectedTimelineBlock
} from './chat-projection-reducer-support'

export function reduceLateChatProjection(
  state: ChatState,
  action: RuntimeProjectionAction,
  context: ChatProjectionReducerContext
): Partial<ChatState> | undefined {
  switch (action.type) {
    case 'runtime_status_received': {
      const event = action.payload
      const base: Partial<ChatState> = state.busy ? {} : { busy: true, busyUnconfirmed: false }
      const block: ChatBlock = {
        kind: 'system',
        id: event.itemId,
        turnId: event.turnId,
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        text: context.runtimeStatusText(event),
        ...(event.failureSummary ? { detail: event.failureSummary } : {}),
        ...(event.code ? { code: event.code } : {}),
        ...(event.kind === 'required_tool_gate' && event.phase === 'failed'
          ? { severity: 'error' as const }
          : {})
      }
      const index = state.blocks.findIndex(
        (candidate) => candidate.kind === 'system' && candidate.id === event.itemId
      )
      const blocks = index >= 0
        ? state.blocks.map((candidate, blockIndex) => blockIndex === index ? block : candidate)
        : upsertProjectedTimelineBlock(state, block)
      return {
        ...base,
        blocks,
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'runtime_error_received': {
      const event = action.payload
      const view = context.runtimeErrorView(event)
      const block: Extract<ChatBlock, { kind: 'system' }> = {
        kind: 'system',
        id: event.itemId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        text: view.message,
        ...(view.code ? { code: view.code } : {}),
        ...(view.detail ? { detail: view.detail } : {}),
        severity: event.severity ?? 'error',
        runtimeError: true
      }
      return {
        blocks: context.upsertRuntimeError(state.blocks, block),
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'compaction_updated': {
      const event = action.payload
      const base: Partial<ChatState> = {}
      if (!state.busy && event.status === 'running') base.busy = true
      if (state.busy && event.status !== 'running' && !state.currentTurnId) base.busy = false
      const index = state.blocks.findIndex(
        (block) => block.kind === 'compaction' && block.id === event.itemId
      )
      if (index >= 0) {
        const current = state.blocks[index]
        if (current.kind !== 'compaction') return base
        const blocks = [...state.blocks]
        blocks[index] = {
          ...current,
          turnId: event.turnId ?? current.turnId,
          summary: event.summary || current.summary,
          status: event.status,
          detail: event.detail ?? current.detail,
          auto: event.auto ?? current.auto,
          messagesBefore: event.messagesBefore ?? current.messagesBefore,
          messagesAfter: event.messagesAfter ?? current.messagesAfter,
          createdAt: current.createdAt ?? event.createdAt
        }
        return { ...base, blocks, error: context.clearRecoveringError(state.error) }
      }
      const block: Extract<ChatBlock, { kind: 'compaction' }> = {
        kind: 'compaction',
        id: event.itemId,
        turnId: event.turnId,
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        summary: event.summary,
        status: event.status,
        detail: event.detail,
        auto: event.auto,
        messagesBefore: event.messagesBefore,
        messagesAfter: event.messagesAfter
      }
      const blocks = upsertProjectedTimelineBlock(state, block)
      if (blocks === state.blocks) return base
      return {
        ...base,
        blocks,
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'review_updated': {
      const event = action.payload
      const base: Partial<ChatState> = !state.busy && event.status === 'running' ? { busy: true, busyUnconfirmed: false } : {}
      const index = state.blocks.findIndex(
        (block) => block.kind === 'review' && block.id === event.itemId
      )
      if (index >= 0) {
        const current = state.blocks[index]
        if (current.kind !== 'review') return base
        const blocks = [...state.blocks]
        blocks[index] = {
          ...current,
          turnId: event.turnId ?? current.turnId,
          title: event.title || current.title,
          status: event.status,
          target: event.target ?? current.target,
          reviewText: event.reviewText ?? current.reviewText,
          output: event.output ?? current.output,
          createdAt: current.createdAt ?? event.createdAt
        }
        return { ...base, blocks, error: context.clearRecoveringError(state.error) }
      }
      const block: Extract<ChatBlock, { kind: 'review' }> = {
        kind: 'review',
        id: event.itemId,
        turnId: event.turnId,
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        title: event.title,
        status: event.status,
        target: event.target,
        reviewText: event.reviewText,
        output: event.output
      }
      const blocks = upsertProjectedTimelineBlock(state, block)
      if (blocks === state.blocks) return base
      return {
        ...base,
        blocks,
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'goal_changed': {
      const event = action.payload
      if (!event.threadId) return {}
      const currentThread = state.activeThreadId === event.threadId
      const updatedAt = event.goal?.updatedAt ?? event.createdAt ?? new Date(context.now).toISOString()
      const threads = state.threads.map((thread) =>
        thread.id === event.threadId ? { ...thread, goal: event.goal, updatedAt } : thread
      )
      if (!currentThread) return { threads }
      const block: ChatBlock = {
        kind: 'system',
        id: `goal-${event.threadId}-${updatedAt}-${event.goal?.status ?? 'cleared'}`,
        createdAt: updatedAt,
        text: context.goalTimelineText(event.goal, event.cleared)
      }
      return {
        activeThreadGoal: event.goal,
        threads,
        blocks: [...state.blocks, block],
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'todos_changed': {
      const event = action.payload
      if (!event.threadId) return {}
      const todos = event.cleared ? null : event.todos
      const updatedAt = todos?.updatedAt ?? event.createdAt ?? new Date(context.now).toISOString()
      const threads = state.threads.map((thread) =>
        thread.id === event.threadId ? { ...thread, todos, updatedAt } : thread
      )
      return state.activeThreadId === event.threadId
        ? { activeThreadTodos: todos, threads, error: context.clearRecoveringError(state.error) }
        : { threads }
    }
    case 'thread_metadata_changed': {
      const event = action.payload
      const title = event.title?.trim()
      const status = event.status?.trim()
      if (
        !event.threadId ||
        (!title && !status && event.titleAuto === undefined && !event.agentSurface && !event.designProfile)
      ) return {}
      return {
        threads: state.threads.map((thread) =>
          thread.id === event.threadId
            ? {
                ...thread,
                ...(title ? { title } : {}),
                ...(status ? { status } : {}),
                ...(event.titleAuto !== undefined ? { titleAuto: event.titleAuto } : {}),
                ...(event.agentSurface ? { agentSurface: event.agentSurface } : {}),
                ...(event.designProfile ? { designProfile: event.designProfile } : {})
              }
            : thread
        )
      }
    }
    case 'context_snapshot_received':
      return state.activeThreadId === action.payload.threadId
        ? { lastContextSnapshot: action.payload }
        : {}
    case 'delegated_runtime_received':
      return state.activeThreadId === action.payload.threadId
        ? { lastDelegatedRuntimeState: action.payload }
        : {}
    case 'usage_received': {
      const threadId = state.activeThreadId ?? ''
      const turnId = action.payload.turnId
      const turnTimingMetrics = new Map(state.turnTimingMetrics)
      if (threadId !== (state.lastTurnUsage?.threadId ?? '')) turnTimingMetrics.clear()
      if (turnId) {
        const avgTtftMs = action.payload.turnAvgTtftMs
        const avgTokensPerSecond = action.payload.turnAvgTokensPerSecond
        if (avgTtftMs != null || avgTokensPerSecond != null) {
          turnTimingMetrics.set(turnId, { avgTtftMs, avgTokensPerSecond })
        } else {
          turnTimingMetrics.delete(turnId)
        }
      }
      return {
        usageRefreshKey: state.usageRefreshKey + 1,
        lastTurnUsage: { threadId, snapshot: action.payload },
        turnTimingMetrics
      }
    }
    case 'thread_snapshot_reconciled': {
      const snapshot = action.payload
      if (state.activeThreadId !== snapshot.threadId) return {}
      const busy = context.threadSnapshotLooksRunning(
        snapshot.blocks,
        snapshot.threadStatus,
        snapshot.latestTurnStatus
      )
      // The snapshot is authoritative for the turn it describes. A terminal
      // snapshot for an older turn must never settle the sidebar projection,
      // clear live text, or settle blocks of a newer turn that is still
      // running locally.
      const snapshotTurnIsCurrent = (
        !snapshot.turnId ||
        !state.currentTurnId ||
        state.currentTurnId === snapshot.turnId
      )
      const terminalIdle = !busy && snapshotTurnIsCurrent
      const reconciledStatus = snapshot.threadStatus
        ? (
            terminalIdle && snapshot.threadStatus.trim().toLowerCase() === 'running'
              ? 'idle'
              : snapshot.threadStatus
          )
        : undefined
      const threads = snapshotTurnIsCurrent && (
        reconciledStatus || snapshot.latestTurnId || snapshot.latestTurnStatus
      )
        ? updateProjectedThreadStatus(
            state.threads,
            snapshot.threadId,
            reconciledStatus ?? (busy ? 'running' : 'idle'),
            snapshot.latestTurnStatus,
            snapshot.latestTurnId
          )
        : state.threads
      const canonicalBlocks = busy || !snapshotTurnIsCurrent
        ? snapshot.blocks
        : context.settlePendingRuntimeWork(snapshot.blocks)
      const shouldClearLive = (
        !snapshot.turnId ||
        !state.currentTurnId ||
        state.currentTurnId === snapshot.turnId
      )
      return {
        blocks: snapshot.turnId
          ? reconcileSnapshotTurn(
              state.blocks,
              canonicalBlocks,
              snapshot.turnId,
              snapshot.userBlockId
            )
          : reconcileSnapshotBlocks(state.blocks, canonicalBlocks),
        lastSeq: Math.max(state.lastSeq, snapshot.latestSeq),
        ...(shouldClearLive
          ? {
              liveReasoning: '',
              liveAssistant: '',
              liveReasoningItemId: undefined,
              liveReasoningTurnId: undefined,
              liveReasoningCreatedAt: undefined,
              liveAssistantItemId: undefined,
              liveAssistantTurnId: undefined,
              liveAssistantCreatedAt: undefined
            }
          : {}),
        currentTurnStartedAtMs: snapshotTurnIsCurrent
          ? busy
            ? snapshot.latestTurnStartedAtMs ?? state.currentTurnStartedAtMs
            : null
          : state.currentTurnStartedAtMs,
        ...(state.lastTurnUsage && state.lastTurnUsage.threadId !== snapshot.threadId
          ? { turnTimingMetrics: new Map() }
          : {}),
        activeThreadGoal: snapshot.goal ?? state.activeThreadGoal,
        activeThreadTodos: snapshot.todos ?? state.activeThreadTodos,
        ...(threads !== state.threads ? { threads } : {}),
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'turn_completed':
    case 'turn_aborted': {
      const aborted = action.type === 'turn_aborted'
      const threadId = state.activeThreadId
      const threads = threadId
        ? settleProjectedThreadStatus(
            state.threads,
            threadId,
            aborted ? 'aborted' : 'completed',
            action.payload.turnId
          )
        : state.threads
      const patch = flushLiveProjection(state, context.now, {
        ...finalizeTurnTimingAt(state, context.now),
        error: null,
        currentTurnId: null,
        currentTurnStartedAtMs: null,
        currentTurnOrchestration: null,
        ...(aborted ? {
          currentTurnUserId: null,
          blocks: context.settlePendingRuntimeWork(state.blocks)
        } : {}),
        ...(state.busy ? { busy: false, busyUnconfirmed: false } : {}),
        ...(threads !== state.threads ? { threads } : {})
      })
      if (!threadId) return patch
      const watchTurnCompletion = { ...state.watchTurnCompletion }
      const unreadThreadIds = { ...state.unreadThreadIds }
      delete watchTurnCompletion[threadId]
      delete unreadThreadIds[threadId]
      return { ...patch, watchTurnCompletion, unreadThreadIds }
    }
    case 'turn_failed': {
      const { error, options, threadId, turnId } = action.payload
      // Replay paths can feed the reducer directly without the store's sink
      // guard. A failure carrying another turn's identity must never settle
      // the currently active turn.
      if (turnId && state.currentTurnId && turnId !== state.currentTurnId) return undefined
      const message = context.formatRuntimeError(error)
      const detail = context.runtimeErrorDetail(error)
      const terminal = options?.terminal === true
      const conversationScoped = options?.scope === 'conversation'
      const interrupted = context.isInterruptSettledError(error, message)
      const shouldSettle = terminal || !state.busy || interrupted
      const patch = flushLiveProjection(state, context.now, {
        ...finalizeTurnTimingAt(state, context.now),
        error: interrupted || conversationScoped ? null : message,
        runtimeErrorDetail: interrupted || conversationScoped ? null : detail || null
      })
      if (!shouldSettle) return patch
      patch.busy = false
      patch.busyUnconfirmed = false
      patch.currentTurnId = null
      patch.currentTurnOrchestration = null
      patch.currentTurnUserId = null
      patch.blocks = context.settlePendingRuntimeWork(patch.blocks ?? state.blocks)
      const settleThreadId = threadId ?? state.activeThreadId
      if (settleThreadId) {
        const threads = settleProjectedThreadStatus(
          state.threads,
          settleThreadId,
          interrupted ? 'aborted' : 'failed',
          turnId
        )
        if (threads !== state.threads) patch.threads = threads
      }
      if (terminal && settleThreadId) {
        const watchTurnCompletion = { ...state.watchTurnCompletion }
        const unreadThreadIds = { ...state.unreadThreadIds }
        delete watchTurnCompletion[settleThreadId]
        delete unreadThreadIds[settleThreadId]
        patch.watchTurnCompletion = watchTurnCompletion
        patch.unreadThreadIds = unreadThreadIds
      }
      return patch
    }
    default:
      return undefined
  }
}
