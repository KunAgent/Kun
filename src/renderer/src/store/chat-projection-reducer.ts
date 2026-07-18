import type {
  ChatBlock,
  RuntimeErrorEventPayload,
  RuntimeStatusEventPayload,
  ToolBlock,
  ToolEventPayload
} from '../agent/types'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import { isBackgroundShellNoticeUserMessage } from '@shared/background-shell-notice'
import type { ChatState } from './chat-store-types'
import {
  isOptimisticUserBlockId,
  matchingOptimisticUserBlockId,
  reconcileOptimisticUserBlock,
  upsertUserBlock
} from './chat-store-runtime-helpers'

export type ChatProjectionReducerContext = {
  now: number
  clearRecoveringError: (error: string | null) => string | null
  goalTimelineText: (goal: ChatState['activeThreadGoal'], cleared?: boolean) => string
  runtimeStatusText: (event: RuntimeStatusEventPayload) => string
  runtimeErrorView: (event: RuntimeErrorEventPayload) => {
    summary: string
    code?: string
    detail?: string
  }
  upsertRuntimeError: (
    blocks: ChatBlock[],
    block: Extract<ChatBlock, { kind: 'system' }>
  ) => ChatBlock[]
  formatRuntimeError: (error: unknown) => string
  runtimeErrorDetail: (error: unknown) => string
  isInterruptSettledError: (error: unknown, message: string) => boolean
  settlePendingRuntimeWork: (blocks: ChatBlock[]) => ChatBlock[]
  threadSnapshotLooksRunning: (blocks: ChatBlock[], threadStatus?: string) => boolean
  hasAssistantTextForCompletedTurn: (
    state: Pick<ChatState, 'blocks' | 'liveAssistant'>,
    turnId?: string | null,
    userBlockId?: string | null
  ) => boolean
}

export function flushLiveProjection(
  state: ChatState,
  now: number,
  base: Partial<ChatState> = {}
): Partial<ChatState> {
  const nextBlocks = [...state.blocks]
  const createdAt = new Date(now).toISOString()
  if (state.liveReasoning.trim()) {
    nextBlocks.push({ kind: 'reasoning', id: `r-${now}`, createdAt, text: state.liveReasoning })
  }
  if (state.liveAssistant.trim()) {
    nextBlocks.push({ kind: 'assistant', id: `a-${now}`, createdAt, text: state.liveAssistant })
  }
  if (nextBlocks.length === state.blocks.length) return base
  return { ...base, blocks: nextBlocks, liveReasoning: '', liveAssistant: '' }
}

/** Pure state projection for normalized actions; browser work is emitted elsewhere. */
export function reduceChatProjection(
  state: ChatState,
  action: RuntimeProjectionAction,
  context: ChatProjectionReducerContext
): Partial<ChatState> {
  switch (action.type) {
    case 'user_message_received': {
      const event = action.payload
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      const optimisticUserId = state.currentTurnUserId
      const backgroundNotice = isBackgroundShellNoticeUserMessage({ text: event.text, meta: event.meta })
      const currentOptimisticUserId =
        !backgroundNotice &&
        optimisticUserId &&
        optimisticUserId !== event.itemId &&
        isOptimisticUserBlockId(optimisticUserId) &&
        baseBlocks.some((block) => block.kind === 'user' && block.id === optimisticUserId)
          ? optimisticUserId
          : null
      const optimisticMatchId = currentOptimisticUserId ?? (
        backgroundNotice ? null : matchingOptimisticUserBlockId(baseBlocks, event)
      )
      const reconcileOptimistic = Boolean(optimisticMatchId && optimisticMatchId !== event.itemId)
      const reconciledBlocks = reconcileOptimistic && optimisticMatchId
        ? reconcileOptimisticUserBlock(
            baseBlocks,
            optimisticMatchId,
            event.itemId,
            event.text,
            event.modelLabel
          )
        : baseBlocks
      const currentTurnUserId = backgroundNotice
        ? optimisticUserId
        : reconcileOptimistic || !optimisticUserId
          ? event.itemId
          : optimisticUserId
      const startedAt = runtimeEventStartedAt(event.createdAt, context.now)
      return {
        ...flushed,
        blocks: upsertUserBlock(reconciledBlocks, event),
        busy: true,
        currentTurnId: event.turnId ?? state.currentTurnId,
        currentTurnUserId,
        turnStartedAtByUserId: backgroundNotice
          ? state.turnStartedAtByUserId
          : {
              ...state.turnStartedAtByUserId,
              [event.itemId]: state.turnStartedAtByUserId[event.itemId] ?? startedAt
            },
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'deltas_received': {
      const deltas = action.deltas
      if (deltas.length === 0) return {}
      const seqs = deltas
        .map((delta) => delta.seq)
        .filter((value): value is number => typeof value === 'number')
      const patch: Partial<ChatState> = {
        error: context.clearRecoveringError(state.error),
        ...(seqs.length > 0 ? { lastSeq: Math.max(state.lastSeq, ...seqs) } : {}),
        ...(!state.busy ? { busy: true } : {})
      }
      let liveReasoning = state.liveReasoning
      let liveAssistant = state.liveAssistant
      let liveDeltaSeqFloor = state.liveDeltaSeqFloor
      let reasoningFirst = state.turnReasoningFirstAtByUserId
      let reasoningLast = state.turnReasoningLastAtByUserId
      let sawReasoning = false
      for (const delta of deltas) {
        if (typeof delta.seq === 'number') {
          if (delta.seq <= liveDeltaSeqFloor) continue
          liveDeltaSeqFloor = delta.seq
        }
        if (delta.kind === 'agent_reasoning') {
          liveReasoning += delta.text
          sawReasoning = true
        } else {
          liveAssistant += delta.text
        }
      }
      const userId = state.currentTurnUserId
      if (sawReasoning && userId) {
        if (typeof reasoningFirst[userId] !== 'number') {
          reasoningFirst = { ...reasoningFirst, [userId]: context.now }
        }
        reasoningLast = { ...reasoningLast, [userId]: context.now }
      }
      return {
        ...patch,
        ...(liveReasoning !== state.liveReasoning ? { liveReasoning } : {}),
        ...(liveAssistant !== state.liveAssistant ? { liveAssistant } : {}),
        ...(liveDeltaSeqFloor !== state.liveDeltaSeqFloor ? { liveDeltaSeqFloor } : {}),
        ...(reasoningFirst !== state.turnReasoningFirstAtByUserId
          ? { turnReasoningFirstAtByUserId: reasoningFirst }
          : {}),
        ...(reasoningLast !== state.turnReasoningLastAtByUserId
          ? { turnReasoningLastAtByUserId: reasoningLast }
          : {})
      }
    }
    case 'tool_updated': {
      const event = action.payload
      const base: Partial<ChatState> =
        !state.busy && !event.updateOnly && !isDetachedSubagentToolEvent(event)
          ? { busy: true }
          : {}
      const childId = toolEventChildId(event)
      const index = state.blocks.findIndex((block) =>
        block.kind === 'tool' && (
          block.id === event.itemId || Boolean(childId && toolBlockChildId(block) === childId)
        )
      )
      if (index >= 0) {
        const current = state.blocks[index]
        if (current.kind !== 'tool') return base
        const blocks = [...state.blocks]
        blocks[index] = {
          ...current,
          summary: event.summary || current.summary,
          status: event.status,
          toolKind: event.toolKind ?? current.toolKind,
          detail: event.detail ?? current.detail,
          filePath: event.filePath ?? current.filePath,
          meta: mergeToolProjectionMeta(current.meta, event.meta)
        }
        return { ...base, blocks, error: context.clearRecoveringError(state.error) }
      }
      if (event.updateOnly) return base
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      const block: ToolBlock = {
        kind: 'tool',
        id: event.itemId,
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        summary: event.summary,
        status: event.status,
        toolKind: event.toolKind,
        detail: event.detail,
        filePath: event.filePath,
        meta: event.meta
      }
      return {
        ...base,
        ...flushed,
        blocks: [...baseBlocks, block],
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'approval_received': {
      const request = action.payload
      if (state.blocks.some(
        (block) => block.kind === 'approval' && block.approvalId === request.approvalId
      )) return {}
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      return {
        ...flushed,
        blocks: [...baseBlocks, {
          kind: 'approval',
          id: `approval-${request.approvalId}`,
          createdAt: new Date(context.now).toISOString(),
          approvalId: request.approvalId,
          summary: request.summary,
          toolName: request.toolName,
          status: 'pending',
          ...(request.meta ? { meta: request.meta } : {})
        }],
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'approval_status_changed': {
      const event = action.payload
      return {
        blocks: state.blocks.map((block) => {
          if (block.kind !== 'approval' || block.approvalId !== event.approvalId) return block
          const next = { ...block, status: event.status }
          delete next.errorMessage
          if (event.status === 'expired' && event.errorMessage) {
            next.errorMessage = event.errorMessage
          }
          return next
        })
      }
    }
    case 'user_input_requested': {
      const req = action.payload
      const existing = state.blocks.find(
        (block) => block.kind === 'user_input' && block.requestId === req.requestId
      )
      if (existing) {
        if (existing.kind === 'user_input' && existing.live === true) return {}
        return {
          blocks: state.blocks.map((block) =>
            block.kind === 'user_input' && block.requestId === req.requestId
              ? { ...block, live: true, status: 'pending' as const }
              : block
          )
        }
      }
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      return {
        ...flushed,
        blocks: [...baseBlocks, {
          kind: 'user_input',
          id: req.itemId,
          createdAt: new Date(context.now).toISOString(),
          requestId: req.requestId,
          questions: req.questions,
          status: 'pending',
          live: true
        }],
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'user_input_status_changed': {
      const event = action.payload
      return {
        error: context.clearRecoveringError(state.error),
        blocks: state.blocks.map((block) =>
          block.kind === 'user_input' && block.id === event.itemId
            ? block.status === 'submitted' && event.status === 'error' &&
                isUserInputInterruptError(event.errorMessage)
              ? block
              : {
                  ...block,
                  status: event.status,
                  answers: event.answers ?? block.answers,
                  errorMessage: event.errorMessage ?? block.errorMessage
                }
            : block
        )
      }
    }
    case 'runtime_status_received': {
      const event = action.payload
      const base: Partial<ChatState> = state.busy ? {} : { busy: true }
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      const block: ChatBlock = {
        kind: 'system',
        id: event.itemId,
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        text: context.runtimeStatusText(event)
      }
      const index = baseBlocks.findIndex(
        (candidate) => candidate.kind === 'system' && candidate.id === event.itemId
      )
      const blocks = [...baseBlocks]
      if (index >= 0) blocks[index] = block
      else blocks.push(block)
      return {
        ...base,
        ...flushed,
        blocks,
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'runtime_error_received': {
      const event = action.payload
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      const view = context.runtimeErrorView(event)
      const block: Extract<ChatBlock, { kind: 'system' }> = {
        kind: 'system',
        id: event.itemId,
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        text: view.summary,
        ...(view.code ? { code: view.code } : {}),
        ...(view.detail ? { detail: view.detail } : {}),
        severity: event.severity ?? 'error'
      }
      return {
        ...flushed,
        blocks: context.upsertRuntimeError(baseBlocks, block),
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
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      const visibleBlocks = event.auto !== false && event.turnId
        ? baseBlocks.filter((block) => !(
            block.kind === 'compaction' &&
            block.id !== event.itemId &&
            block.auto !== false &&
            block.turnId === event.turnId
          ))
        : baseBlocks
      return {
        ...base,
        ...flushed,
        blocks: [...visibleBlocks, {
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
        }],
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'review_updated': {
      const event = action.payload
      const base: Partial<ChatState> = !state.busy && event.status === 'running' ? { busy: true } : {}
      const index = state.blocks.findIndex(
        (block) => block.kind === 'review' && block.id === event.itemId
      )
      if (index >= 0) {
        const current = state.blocks[index]
        if (current.kind !== 'review') return base
        const blocks = [...state.blocks]
        blocks[index] = {
          ...current,
          title: event.title || current.title,
          status: event.status,
          target: event.target ?? current.target,
          reviewText: event.reviewText ?? current.reviewText,
          output: event.output ?? current.output,
          createdAt: current.createdAt ?? event.createdAt
        }
        return { ...base, blocks, error: context.clearRecoveringError(state.error) }
      }
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      return {
        ...base,
        ...flushed,
        blocks: [...baseBlocks, {
          kind: 'review',
          id: event.itemId,
          createdAt: event.createdAt ?? new Date(context.now).toISOString(),
          title: event.title,
          status: event.status,
          target: event.target,
          reviewText: event.reviewText,
          output: event.output
        }],
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
      const flushed = flushLiveProjection(state, context.now)
      const baseBlocks = flushed.blocks ?? state.blocks
      const block: ChatBlock = {
        kind: 'system',
        id: `goal-${event.threadId}-${updatedAt}-${event.goal?.status ?? 'cleared'}`,
        createdAt: updatedAt,
        text: context.goalTimelineText(event.goal, event.cleared)
      }
      return {
        ...flushed,
        activeThreadGoal: event.goal,
        threads,
        blocks: [...baseBlocks, block],
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
      if (!event.threadId || !title) return {}
      return {
        threads: state.threads.map((thread) =>
          thread.id === event.threadId
            ? { ...thread, title, ...(event.titleAuto !== undefined ? { titleAuto: event.titleAuto } : {}) }
            : thread
        )
      }
    }
    case 'usage_received':
      return {
        usageRefreshKey: state.usageRefreshKey + 1,
        lastTurnUsage: { threadId: state.activeThreadId ?? '', snapshot: action.payload }
      }
    case 'thread_snapshot_reconciled': {
      const snapshot = action.payload
      if (state.activeThreadId !== snapshot.threadId || state.busy) return {}
      if (state.currentTurnId && state.currentTurnId !== snapshot.turnId) return {}
      if (context.hasAssistantTextForCompletedTurn(state, snapshot.turnId, snapshot.userBlockId)) {
        return {}
      }
      const busy = context.threadSnapshotLooksRunning(snapshot.blocks, snapshot.threadStatus)
      return {
        blocks: busy ? snapshot.blocks : context.settlePendingRuntimeWork(snapshot.blocks),
        lastSeq: Math.max(state.lastSeq, snapshot.latestSeq),
        liveReasoning: '',
        liveAssistant: '',
        activeThreadGoal: snapshot.goal ?? state.activeThreadGoal,
        activeThreadTodos: snapshot.todos ?? state.activeThreadTodos,
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'turn_completed': {
      if (!state.busy && !state.currentTurnId) return {}
      const patch = flushLiveProjection(state, context.now, {
        ...finalizeTurnTimingAt(state, context.now),
        error: null,
        currentTurnId: null,
        ...(state.busy ? { busy: false } : {})
      })
      const threadId = state.activeThreadId
      if (!threadId) return patch
      const watchTurnCompletion = { ...state.watchTurnCompletion }
      const unreadThreadIds = { ...state.unreadThreadIds }
      delete watchTurnCompletion[threadId]
      delete unreadThreadIds[threadId]
      return { ...patch, watchTurnCompletion, unreadThreadIds }
    }
    case 'turn_failed': {
      const message = context.formatRuntimeError(action.error)
      const detail = context.runtimeErrorDetail(action.error)
      const terminal = action.options?.terminal === true
      const interrupted = context.isInterruptSettledError(action.error, message)
      const shouldSettle = terminal || !state.busy || interrupted
      const patch = flushLiveProjection(state, context.now, {
        ...finalizeTurnTimingAt(state, context.now),
        error: interrupted ? null : message,
        runtimeErrorDetail: interrupted ? null : detail || null
      })
      if (!shouldSettle) return patch
      patch.busy = false
      patch.currentTurnId = null
      patch.currentTurnUserId = null
      patch.blocks = context.settlePendingRuntimeWork(patch.blocks ?? state.blocks)
      if (terminal && state.activeThreadId) {
        const watchTurnCompletion = { ...state.watchTurnCompletion }
        const unreadThreadIds = { ...state.unreadThreadIds }
        delete watchTurnCompletion[state.activeThreadId]
        delete unreadThreadIds[state.activeThreadId]
        patch.watchTurnCompletion = watchTurnCompletion
        patch.unreadThreadIds = unreadThreadIds
      }
      return patch
    }
    default:
      return {}
  }
}

function runtimeEventStartedAt(createdAt: string | undefined, now: number): number {
  if (!createdAt) return now
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return now
  const maxPastAgeMs = 30 * 60_000
  const maxFutureSkewMs = 5_000
  return parsed < now - maxPastAgeMs || parsed > now + maxFutureSkewMs ? now : parsed
}

function finalizeTurnTimingAt(state: ChatState, now: number): Partial<ChatState> {
  const userId = state.currentTurnUserId
  if (!userId) return {}
  const startedAt = state.turnStartedAtByUserId[userId]
  if (typeof startedAt !== 'number') return { currentTurnUserId: null }
  return {
    currentTurnUserId: null,
    turnDurationByUserId: {
      ...state.turnDurationByUserId,
      [userId]: Math.max(0, now - startedAt)
    }
  }
}

export function toolBlockChildId(block: ToolBlock): string | undefined {
  const child = block.meta?.child
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    const nested = (child as Record<string, unknown>).childId
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  return childIdFromDetail(block.detail)
}

export function toolEventChildId(event: ToolEventPayload): string | undefined {
  const child = event.meta?.child
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    const nested = (child as Record<string, unknown>).childId
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  return childIdFromDetail(event.detail)
}

export function mergeToolProjectionEvents(
  base: ToolEventPayload,
  update: ToolEventPayload
): ToolEventPayload {
  return {
    ...base,
    summary: update.summary || base.summary,
    status: update.status,
    toolKind: update.toolKind ?? base.toolKind,
    detail: update.detail ?? base.detail,
    filePath: update.filePath ?? base.filePath,
    meta: mergeToolProjectionMeta(base.meta, update.meta)
  }
}

function mergeToolProjectionMeta(
  current: ToolBlock['meta'],
  incoming: ToolEventPayload['meta']
): ToolBlock['meta'] {
  if (!current) return incoming
  if (!incoming) return current
  const merged = { ...current, ...incoming }
  const currentChild = current.child
  const incomingChild = incoming.child
  if (
    currentChild && typeof currentChild === 'object' && !Array.isArray(currentChild) &&
    incomingChild && typeof incomingChild === 'object' && !Array.isArray(incomingChild)
  ) {
    merged.child = { ...currentChild, ...incomingChild }
  }
  return merged
}

function isDetachedSubagentToolEvent(event: ToolEventPayload): boolean {
  const child = event.meta?.child
  if (child && typeof child === 'object' && !Array.isArray(child) &&
    (child as Record<string, unknown>).detached === true) return true
  return detailRecord(event.detail)?.detached === true
}

function childIdFromDetail(detail: string | undefined): string | undefined {
  const id = detailRecord(detail)?.childId
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

function detailRecord(detail: string | undefined): Record<string, unknown> | undefined {
  if (!detail?.trim()) return undefined
  try {
    const parsed = JSON.parse(detail) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function isUserInputInterruptError(message: string | undefined): boolean {
  if (!message) return false
  const normalized = message.trim().toLowerCase()
  return normalized.includes('interrupt') || normalized.includes('cancelled') || normalized.includes('canceled')
}
