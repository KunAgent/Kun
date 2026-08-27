import type { AgentProvider } from '../agent/types'
import type { ChatState } from './chat-store-types'

export type ThreadEventSinkBinding = {
  threadId?: string
  signal?: AbortSignal
  /** Cursor already projected; replayed deltas at or below it are duplicates. */
  sinceSeq?: number
  /** Keep a running projection covered until the SSE replay sync marker arrives. */
  awaitReplaySynchronization?: boolean
  getThreadDetail?: AgentProvider['getThreadDetail']
}

export function replayCursorPatch(
  state: ChatState,
  observedSeq: number
): Pick<ChatState, 'lastSeq'> {
  return { lastSeq: Math.max(state.lastSeq, observedSeq) }
}

export function replaySynchronizedPatch(
  state: ChatState,
  threadId: string,
  awaitReplaySynchronization: boolean | undefined,
  cursor: number
): Pick<ChatState, 'lastSeq' | 'liveDeltaSeqFloor'> &
  Partial<Pick<ChatState, 'threadLoadingId' | 'busyUnconfirmed'>> {
  const synchronized = awaitReplaySynchronization === true && Boolean(threadId)
  return {
    lastSeq: Math.max(state.lastSeq, cursor),
    liveDeltaSeqFloor: Math.max(state.liveDeltaSeqFloor, cursor),
    ...(synchronized && state.busyUnconfirmed ? { busyUnconfirmed: false } : {}),
    ...(synchronized && state.threadLoadingId === threadId ? { threadLoadingId: null } : {})
  }
}

export function replayLoadingIsPending(
  state: ChatState,
  threadId: string,
  awaitReplaySynchronization: boolean | undefined
): boolean {
  return awaitReplaySynchronization === true &&
    Boolean(threadId) &&
    state.threadLoadingId === threadId
}
