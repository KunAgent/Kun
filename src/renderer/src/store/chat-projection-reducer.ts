import type {
  ChatBlock,
  RuntimeErrorEventPayload,
  RuntimeStatusEventPayload,
  ThreadDeltaEvent,
  ToolBlock,
  ToolEventPayload
} from '../agent/types'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import { parseRendererChartSpec } from '../agent/chart-spec-adapter'
import { isBackgroundShellNoticeUserMessage } from '@shared/background-shell-notice'
import type { ChatState } from './chat-store-types'
import {
  isOptimisticUserBlockId,
  matchingOptimisticUserBlockId,
  reconcileOptimisticUserBlock,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import {
  consumeQueuedMessagesStartedByRuntime,
  userMessageItemIdsFromBlocks
} from './queued-message-persistence'

export type ChatProjectionReducerContext = {
  now: number
  clearRecoveringError: (error: string | null) => string | null
  goalTimelineText: (goal: ChatState['activeThreadGoal'], cleared?: boolean) => string
  runtimeStatusText: (event: RuntimeStatusEventPayload) => string
  runtimeErrorView: (event: RuntimeErrorEventPayload) => {
    summary: string
    message: string
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
  threadSnapshotLooksRunning: (
    blocks: ChatBlock[],
    threadStatus?: string,
    latestTurnStatus?: string
  ) => boolean
}
import { reduceLateChatProjection } from './chat-projection-reducer-late'
import { reduceEarlyChatProjection } from './chat-projection-reducer-early'
import {
  flushLiveProjection,
  findMatchingToolBlockIndex,
  isDetachedSubagentToolEvent,
  isUserInputInterruptError,
  mergeToolProjectionEvents,
  runtimeEventStartedAt,
  unseenDeltaText,
  updateProjectedThreadStatus,
  upsertProjectedTimelineBlock,
  upsertTimelineBlock
} from './chat-projection-reducer-support'

export {
  flushLiveProjection,
  findMatchingToolBlockIndex,
  mergeToolProjectionEvents,
  monotonicToolStatus,
  toolBlockChildId,
  toolBlockMatchesToolEvent,
  toolEventChildProjectionKey,
  toolEventChildId
} from './chat-projection-reducer-support'

function liveBufferMatchesTurn(input: {
  text?: string
  itemId?: string
  turnId?: string
  targetTurnId?: string
}): boolean {
  const text = input.text ?? ''
  const hasState = Boolean(text.trim() || input.itemId || input.turnId)
  if (!hasState) return true
  return Boolean(
    text.trim() &&
    input.itemId &&
    input.turnId &&
    input.targetTurnId &&
    input.turnId === input.targetTurnId
  )
}

/** Pure state projection for normalized actions; browser work is emitted elsewhere. */
export function reduceChatProjection(
  state: ChatState,
  action: RuntimeProjectionAction,
  context: ChatProjectionReducerContext
): Partial<ChatState> {
  const rejected = reduceEarlyChatProjection(state, action)
  if (rejected) return rejected
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
        : currentOptimisticUserId
          ? event.itemId
          : optimisticUserId ?? event.itemId
      const startedAt = runtimeEventStartedAt(event.createdAt, context.now)
      const statusThreads = !backgroundNotice && event.turnId && state.activeThreadId
        ? updateProjectedThreadStatus(
            state.threads,
            state.activeThreadId,
            'running',
            'running',
            event.turnId
          )
        : state.threads
      const observedSeq = action.seq
      const threads = typeof observedSeq === 'number' && state.activeThreadId
        ? statusThreads.map((thread) =>
            thread.id === state.activeThreadId &&
            (thread.latestSeq === undefined || thread.latestSeq < observedSeq)
              ? { ...thread, latestSeq: observedSeq }
              : thread
          )
        : statusThreads
      const blocks = upsertUserBlock(reconciledBlocks, event)
      const queuedMessages = consumeQueuedMessagesStartedByRuntime(state.queuedMessages, {
        turnId: event.turnId ?? state.currentTurnId,
        userMessageItemIds: userMessageItemIdsFromBlocks(blocks)
      })
      return {
        ...flushed,
        blocks,
        busy: true,
        // A live user_message event is direct runtime evidence; any pending
        // unconfirmed flag from hydration is now resolved.
        busyUnconfirmed: false,
        currentTurnId: event.turnId ?? state.currentTurnId,
        currentTurnUserId,
        currentTurnStartedAtMs:
          backgroundNotice || (event.turnId != null && event.turnId === state.currentTurnId)
            ? state.currentTurnStartedAtMs
            : startedAt,
        turnStartedAtByUserId: backgroundNotice
          ? state.turnStartedAtByUserId
          : {
              ...state.turnStartedAtByUserId,
              [event.itemId]: state.turnStartedAtByUserId[event.itemId] ?? startedAt
            },
        ...(threads !== state.threads ? { threads } : {}),
        ...(queuedMessages !== state.queuedMessages && queuedMessages !== undefined
          ? { queuedMessages }
          : {}),
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'deltas_received': {
      const deltas = action.deltas.filter(
        (delta) => !delta.threadId || !state.activeThreadId || delta.threadId === state.activeThreadId
      )
      if (deltas.length === 0) return {}
      const seqs = deltas
        .map((delta) => delta.seq)
        .filter((value): value is number => typeof value === 'number')
      const patch: Partial<ChatState> = {
        error: context.clearRecoveringError(state.error),
        ...(seqs.length > 0 ? { lastSeq: Math.max(state.lastSeq, ...seqs) } : {})
      }
      let blocks = state.blocks
      let liveReasoning = state.liveReasoning
      let liveReasoningItemId = state.liveReasoningItemId
      let liveReasoningTurnId = state.liveReasoningTurnId
      let liveReasoningCreatedAt = state.liveReasoningCreatedAt
      let liveAssistant = state.liveAssistant
      let liveAssistantItemId = state.liveAssistantItemId
      let liveAssistantTurnId = state.liveAssistantTurnId
      let liveAssistantCreatedAt = state.liveAssistantCreatedAt
      let liveDeltaSeqFloor = state.liveDeltaSeqFloor
      let reasoningFirst = state.turnReasoningFirstAtByUserId
      let reasoningLast = state.turnReasoningLastAtByUserId
      let sawReasoning = false
      let sawUnseenDelta = false
      for (const delta of deltas) {
        if (typeof delta.seq === 'number') {
          if (delta.seq <= liveDeltaSeqFloor) continue
          liveDeltaSeqFloor = delta.seq
        }
        if (delta.kind === 'agent_reasoning') {
          const targetTurnId = delta.turnId ?? state.currentTurnId ?? undefined
          if (!liveBufferMatchesTurn({
            text: liveReasoning,
            itemId: liveReasoningItemId,
            turnId: liveReasoningTurnId,
            targetTurnId
          })) {
            liveReasoning = ''
            liveReasoningItemId = undefined
            liveReasoningTurnId = undefined
            liveReasoningCreatedAt = undefined
          }
          const text = unseenDeltaText(
            delta,
            blocks,
            liveReasoning,
            liveReasoningItemId
          )
          if (!text) continue
          if (delta.itemId && liveReasoningItemId && delta.itemId !== liveReasoningItemId) {
            if (liveReasoning.trim()) {
              blocks = upsertTimelineBlock(blocks, {
                kind: 'reasoning',
                id: liveReasoningItemId,
                turnId: liveReasoningTurnId,
                createdAt: liveReasoningCreatedAt,
                text: liveReasoning
              })
            }
            liveReasoning = ''
            liveReasoningItemId = undefined
            liveReasoningTurnId = undefined
            liveReasoningCreatedAt = undefined
          }
          liveReasoningItemId = delta.itemId ?? liveReasoningItemId
          liveReasoningTurnId = delta.turnId ?? liveReasoningTurnId ?? state.currentTurnId ?? undefined
          liveReasoningCreatedAt = delta.createdAt ?? liveReasoningCreatedAt
          liveReasoning += text
          sawReasoning = true
          sawUnseenDelta = true
        } else {
          const targetTurnId = delta.turnId ?? state.currentTurnId ?? undefined
          if (!liveBufferMatchesTurn({
            text: liveAssistant,
            itemId: liveAssistantItemId,
            turnId: liveAssistantTurnId,
            targetTurnId
          })) {
            liveAssistant = ''
            liveAssistantItemId = undefined
            liveAssistantTurnId = undefined
            liveAssistantCreatedAt = undefined
          }
          const text = unseenDeltaText(
            delta,
            blocks,
            liveAssistant,
            liveAssistantItemId
          )
          if (!text) continue
          if (delta.itemId && liveAssistantItemId && delta.itemId !== liveAssistantItemId) {
            if (liveAssistant.trim()) {
              blocks = upsertTimelineBlock(blocks, {
                kind: 'assistant',
                id: liveAssistantItemId,
                turnId: liveAssistantTurnId,
                createdAt: liveAssistantCreatedAt,
                text: liveAssistant
              })
            }
            liveAssistant = ''
            liveAssistantItemId = undefined
            liveAssistantTurnId = undefined
            liveAssistantCreatedAt = undefined
          }
          liveAssistantItemId = delta.itemId ?? liveAssistantItemId
          liveAssistantTurnId = delta.turnId ?? liveAssistantTurnId ?? state.currentTurnId ?? undefined
          liveAssistantCreatedAt = delta.createdAt ?? liveAssistantCreatedAt
          liveAssistant += text
          sawUnseenDelta = true
        }
      }
      if (sawUnseenDelta && !state.busy) patch.busy = true
      const userId = state.currentTurnUserId
      if (sawReasoning && userId) {
        if (typeof reasoningFirst[userId] !== 'number') {
          reasoningFirst = { ...reasoningFirst, [userId]: context.now }
        }
        reasoningLast = { ...reasoningLast, [userId]: context.now }
      }
      return {
        ...patch,
        ...(blocks !== state.blocks ? { blocks } : {}),
        ...(liveReasoning !== state.liveReasoning ? { liveReasoning } : {}),
        ...(liveReasoningItemId !== state.liveReasoningItemId ? { liveReasoningItemId } : {}),
        ...(liveReasoningTurnId !== state.liveReasoningTurnId ? { liveReasoningTurnId } : {}),
        ...(liveReasoningCreatedAt !== state.liveReasoningCreatedAt ? { liveReasoningCreatedAt } : {}),
        ...(liveAssistant !== state.liveAssistant ? { liveAssistant } : {}),
        ...(liveAssistantItemId !== state.liveAssistantItemId ? { liveAssistantItemId } : {}),
        ...(liveAssistantTurnId !== state.liveAssistantTurnId ? { liveAssistantTurnId } : {}),
        ...(liveAssistantCreatedAt !== state.liveAssistantCreatedAt ? { liveAssistantCreatedAt } : {}),
        ...(liveDeltaSeqFloor !== state.liveDeltaSeqFloor ? { liveDeltaSeqFloor } : {}),
        ...(reasoningFirst !== state.turnReasoningFirstAtByUserId
          ? { turnReasoningFirstAtByUserId: reasoningFirst }
          : {}),
        ...(reasoningLast !== state.turnReasoningLastAtByUserId
          ? { turnReasoningLastAtByUserId: reasoningLast }
          : {})
      }
    }
    case 'assistant_item_upserted': {
      const item = action.payload
      if (state.activeThreadId && item.threadId !== state.activeThreadId) return {}
      const block: ChatBlock = item.kind === 'agent_message'
        ? {
            kind: 'assistant',
            id: item.itemId,
            turnId: item.turnId,
            createdAt: item.createdAt,
            text: item.text
          }
        : {
            kind: 'reasoning',
            id: item.itemId,
            turnId: item.turnId,
            createdAt: item.createdAt,
            text: item.text
          }
      const patch: Partial<ChatState> = {
        blocks: upsertProjectedTimelineBlock(state, block),
        error: context.clearRecoveringError(state.error)
      }
      if (
        item.kind === 'agent_message' &&
        (
          state.liveAssistantItemId === item.itemId ||
          (!state.liveAssistantItemId && state.liveAssistantTurnId === item.turnId)
        )
      ) {
        patch.liveAssistant = ''
        patch.liveAssistantItemId = undefined
        patch.liveAssistantTurnId = undefined
        patch.liveAssistantCreatedAt = undefined
      }
      if (
        item.kind === 'agent_reasoning' &&
        (
          state.liveReasoningItemId === item.itemId ||
          (!state.liveReasoningItemId && state.liveReasoningTurnId === item.turnId)
        )
      ) {
        patch.liveReasoning = ''
        patch.liveReasoningItemId = undefined
        patch.liveReasoningTurnId = undefined
        patch.liveReasoningCreatedAt = undefined
      }
      return patch
    }
    case 'tool_updated': {
      const event = action.payload
      const base: Partial<ChatState> =
        !state.busy && !event.updateOnly && !isDetachedSubagentToolEvent(event)
          ? { busy: true, busyUnconfirmed: false }
          : {}
      const chartSpec = parseRendererChartSpec(event.meta?.chartSpec)
      const chartIndex = state.blocks.findIndex((block) => block.id === event.itemId)
      if (chartSpec) {
        const chartBlock: ChatBlock = {
          kind: 'chart', id: event.itemId, turnId: event.turnId,
          createdAt: event.createdAt ?? new Date(context.now).toISOString(), spec: chartSpec
        }
        if (chartIndex >= 0) {
          const blocks = [...state.blocks]
          blocks[chartIndex] = chartBlock
          return { ...base, blocks, error: context.clearRecoveringError(state.error) }
        }
        return { ...base, blocks: upsertProjectedTimelineBlock(state, chartBlock), error: context.clearRecoveringError(state.error) }
      }
      const index = findMatchingToolBlockIndex(state.blocks, event)
      if (index >= 0) {
        const current = state.blocks[index]
        if (current.kind !== 'tool') return base
        const merged = mergeToolProjectionEvents({
          itemId: current.id,
          turnId: current.turnId,
          createdAt: current.createdAt,
          summary: current.summary,
          status: current.status,
          toolKind: current.toolKind,
          detail: current.detail,
          filePath: current.filePath,
          meta: current.meta
        }, event)
        const blocks = [...state.blocks]
        blocks[index] = {
          ...current,
          turnId: merged.turnId,
          createdAt: merged.createdAt,
          summary: merged.summary,
          status: merged.status,
          toolKind: merged.toolKind,
          detail: merged.detail,
          filePath: merged.filePath,
          meta: merged.meta
        }
        return { ...base, blocks, error: context.clearRecoveringError(state.error) }
      }
      if (event.updateOnly) return base
      const block: ToolBlock = {
        kind: 'tool',
        id: event.itemId,
        turnId: event.turnId,
        createdAt: event.createdAt ?? new Date(context.now).toISOString(),
        summary: event.summary,
        status: event.status,
        toolKind: event.toolKind,
        detail: event.detail,
        filePath: event.filePath,
        meta: event.meta
      }
      const blocks = upsertProjectedTimelineBlock(state, block)
      if (blocks === state.blocks) return base
      return {
        ...base,
        blocks,
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'approval_received': {
      const request = action.payload
      if (state.blocks.some(
        (block) => block.kind === 'approval' && block.approvalId === request.approvalId
      )) return {}
      const block: Extract<ChatBlock, { kind: 'approval' }> = {
        kind: 'approval',
        id: `approval-${request.approvalId}`,
        turnId: request.turnId,
        createdAt: request.createdAt ?? new Date(context.now).toISOString(),
        approvalId: request.approvalId,
        summary: request.summary,
        toolName: request.toolName,
        status: 'pending',
        ...(request.meta ? { meta: request.meta } : {})
      }
      const blocks = upsertProjectedTimelineBlock(state, block)
      if (blocks === state.blocks) return {}
      return {
        blocks,
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
    case 'approval_review_updated': {
      const event = action.payload
      const id = `approval-review-${event.reviewId}`
      const current = state.blocks.find(
        (block): block is Extract<ChatBlock, { kind: 'approval_review' }> =>
          block.kind === 'approval_review' && block.reviewId === event.reviewId
      )
      const block: Extract<ChatBlock, { kind: 'approval_review' }> = {
        kind: 'approval_review',
        id,
        reviewId: event.reviewId,
        approvalId: event.approvalId,
        turnId: event.turnId ?? current?.turnId,
        createdAt:
          current?.createdAt ??
          event.createdAt ??
          new Date(context.now).toISOString(),
        summary: event.summary || current?.summary || 'Tool action',
        toolName: event.toolName ?? current?.toolName,
        status: event.status,
        decision: event.decision ?? current?.decision,
        riskLevel: event.riskLevel ?? current?.riskLevel,
        rationale: event.rationale ?? current?.rationale
      }
      return {
        blocks: upsertProjectedTimelineBlock(state, block),
        error: context.clearRecoveringError(state.error)
      }
    }
    case 'user_input_requested': {
      const req = action.payload
      if (req.questions.length === 0) return {}
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
      const block: Extract<ChatBlock, { kind: 'user_input' }> = {
        kind: 'user_input',
        id: req.itemId,
        turnId: req.turnId,
        createdAt: req.createdAt ?? new Date(context.now).toISOString(),
        requestId: req.requestId,
        questions: req.questions,
        ...(req.timeoutSeconds !== undefined ? { timeoutSeconds: req.timeoutSeconds } : {}),
        status: 'pending',
        live: true
      }
      const blocks = upsertProjectedTimelineBlock(state, block)
      if (blocks === state.blocks) return {}
      return {
        blocks,
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
    default:
      return reduceLateChatProjection(state, action, context) ?? {}
  }
}
