import type { ChatState } from './chat-store-types'
import type { ThreadLiveProjection } from '../agent/provider-types'

export type LiveProjectionState = Pick<
  ChatState,
  | 'liveDeltaSeqFloor'
  | 'liveReasoning'
  | 'liveReasoningItemId'
  | 'liveReasoningTurnId'
  | 'liveReasoningCreatedAt'
  | 'liveAssistant'
  | 'liveAssistantItemId'
  | 'liveAssistantTurnId'
  | 'liveAssistantCreatedAt'
>

type LiveProjectionSource = LiveProjectionState & {
  busy: boolean
  currentTurnId: string | null
}

export function emptyLiveProjection(liveDeltaSeqFloor = 0): LiveProjectionState {
  return {
    liveDeltaSeqFloor,
    liveReasoning: '',
    liveReasoningItemId: undefined,
    liveReasoningTurnId: undefined,
    liveReasoningCreatedAt: undefined,
    liveAssistant: '',
    liveAssistantItemId: undefined,
    liveAssistantTurnId: undefined,
    liveAssistantCreatedAt: undefined
  }
}

export function restoredLiveProjection(
  liveDeltaSeqFloor: number,
  projection: ThreadLiveProjection | undefined
): LiveProjectionState {
  return {
    liveDeltaSeqFloor,
    liveReasoning: projection?.reasoning?.text ?? '',
    liveReasoningItemId: projection?.reasoning?.itemId,
    liveReasoningTurnId: projection?.reasoning?.turnId,
    liveReasoningCreatedAt: projection?.reasoning?.createdAt,
    liveAssistant: projection?.assistant?.text ?? '',
    liveAssistantItemId: projection?.assistant?.itemId,
    liveAssistantTurnId: projection?.assistant?.turnId,
    liveAssistantCreatedAt: projection?.assistant?.createdAt
  }
}

export function copyLiveProjection(source: LiveProjectionState): LiveProjectionState {
  return {
    liveDeltaSeqFloor: Number.isFinite(source.liveDeltaSeqFloor)
      ? source.liveDeltaSeqFloor
      : 0,
    liveReasoning: source.liveReasoning ?? '',
    liveReasoningItemId: source.liveReasoningItemId,
    liveReasoningTurnId: source.liveReasoningTurnId,
    liveReasoningCreatedAt: source.liveReasoningCreatedAt,
    liveAssistant: source.liveAssistant ?? '',
    liveAssistantItemId: source.liveAssistantItemId,
    liveAssistantTurnId: source.liveAssistantTurnId,
    liveAssistantCreatedAt: source.liveAssistantCreatedAt
  }
}

function liveBufferIsCoherent(input: {
  text: string
  itemId?: string
  turnId?: string
  createdAt?: string
  currentTurnId: string | null
}): boolean {
  if (!input.text.trim()) {
    return !input.itemId && !input.turnId && !input.createdAt
  }
  return Boolean(
    input.itemId &&
    input.turnId &&
    input.currentTurnId &&
    input.turnId === input.currentTurnId
  )
}

/** A parked projection is safe to paint only when live text and identity agree. */
export function liveProjectionIsCoherent(source: LiveProjectionSource): boolean {
  if (!Number.isFinite(source.liveDeltaSeqFloor) || source.liveDeltaSeqFloor < 0) return false
  const liveReasoning = source.liveReasoning ?? ''
  const liveAssistant = source.liveAssistant ?? ''
  const hasLiveState = Boolean(
    liveReasoning.trim() ||
    source.liveReasoningItemId ||
    source.liveReasoningTurnId ||
    source.liveReasoningCreatedAt ||
    liveAssistant.trim() ||
    source.liveAssistantItemId ||
    source.liveAssistantTurnId ||
    source.liveAssistantCreatedAt
  )
  if (!source.busy && hasLiveState) return false
  return liveBufferIsCoherent({
    text: liveReasoning,
    itemId: source.liveReasoningItemId,
    turnId: source.liveReasoningTurnId,
    createdAt: source.liveReasoningCreatedAt,
    currentTurnId: source.currentTurnId
  }) && liveBufferIsCoherent({
    text: liveAssistant,
    itemId: source.liveAssistantItemId,
    turnId: source.liveAssistantTurnId,
    createdAt: source.liveAssistantCreatedAt,
    currentTurnId: source.currentTurnId
  })
}
