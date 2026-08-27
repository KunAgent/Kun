import type {
  ChatBlock,
  NormalizedThread,
  ThreadDetail,
  ThreadGoal,
  ThreadTodoList
} from '../agent/types'
import type { ChatState, QueuedUserMessage } from './chat-store-types'
import {
  copyLiveProjection,
  emptyLiveProjection,
  liveProjectionIsCoherent,
  type LiveProjectionState
} from './chat-store-live-projection'
import { hydrateBlockModelLabels } from './chat-store-helpers'
import {
  settlePendingRuntimeWorkAfterInterrupt,
  threadLooksRunning,
  threadSnapshotLooksRunning
} from './chat-store-runtime-helpers'
import {
  queuedMessagesForThread,
  reconcileQueuedMessages
} from './queued-message-persistence'

export const THREAD_SNAPSHOT_CACHE_MAX_ENTRIES = 6
export const THREAD_SNAPSHOT_CACHE_MAX_BYTES = 32 * 1024 * 1024
// A snapshot normally gets the actual HTTP payload size on hydration. The
// conservative fallback still makes a locally-created thread bounded if it is
// switched away before a durable detail response has been observed.
const UNKNOWN_SNAPSHOT_BYTES = 4 * 1024 * 1024
const SNAPSHOT_ESTIMATE_OVERFLOW = THREAD_SNAPSHOT_CACHE_MAX_BYTES + 1

export type ThreadSnapshot = {
  threadId: string
  fingerprint: string
  blocks: ChatBlock[]
  lastSeq: number
  threadHistoryCursor: string | null
  threadHasMoreHistory: boolean
  busy: boolean
  busyUnconfirmed: boolean
  currentTurnId: string | null
  currentTurnOrchestration: 'direct' | 'graph' | null
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  activeThreadRelation: 'primary' | 'fork' | 'side' | null
  activeThreadParentId: string | null
  activeThreadGoal: ThreadGoal | null
  activeThreadTodos: ThreadTodoList | null
  queuedMessages: QueuedUserMessage[]
  payloadBytes: number
} & LiveProjectionState

const snapshots = new Map<string, ThreadSnapshot>()
let totalBytes = 0
let cacheGeneration = 0
const threadGenerations = new Map<string, number>()

export type ThreadSnapshotCacheToken = {
  cacheGeneration: number
  threadGeneration: number
}

type ThreadFingerprintSource = Pick<
  NormalizedThread,
  | 'id'
  | 'updatedAt'
  | 'status'
  | 'latestSeq'
  | 'latestTurnId'
  | 'latestTurnStatus'
  | 'relation'
  | 'archived'
>

export function threadSnapshotFingerprint(thread: ThreadFingerprintSource): string {
  return [
    thread.id,
    thread.updatedAt,
    thread.status?.trim().toLowerCase() ?? '',
    String(thread.latestSeq ?? ''),
    thread.latestTurnId ?? '',
    thread.latestTurnStatus?.trim().toLowerCase() ?? '',
    thread.relation ?? '',
    thread.archived === true ? 'archived' : ''
  ].join('\u0000')
}

export function captureThreadSnapshotCacheToken(threadId: string): ThreadSnapshotCacheToken {
  return {
    cacheGeneration,
    threadGeneration: threadGenerations.get(threadId) ?? 0
  }
}

export function threadSnapshotCacheTokenIsCurrent(
  threadId: string,
  token: ThreadSnapshotCacheToken
): boolean {
  return token.cacheGeneration === cacheGeneration &&
    token.threadGeneration === (threadGenerations.get(threadId) ?? 0)
}

function normalizedPayloadBytes(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : UNKNOWN_SNAPSHOT_BYTES
}

/** Estimate retained bytes without allocating a full serialized projection. */
function estimateSnapshotBytes(value: unknown): number {
  let bytes = 0
  const ancestors = new WeakSet<object>()
  const add = (amount: number): boolean => {
    bytes += amount
    return bytes <= THREAD_SNAPSHOT_CACHE_MAX_BYTES
  }
  const addString = (text: string): boolean => {
    if (!add(2)) return false
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      let amount = 1
      if (code === 0x22 || code === 0x5c || code < 0x20) amount = code < 0x20 ? 6 : 2
      else if (code < 0x80) amount = 1
      else if (code < 0x800) amount = 2
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        const next = text.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          amount = 4
          index += 1
        } else amount = 3
      } else amount = 3
      if (!add(amount)) return false
    }
    return true
  }
  const visit = (candidate: unknown): boolean => {
    if (candidate === null) return add(4)
    switch (typeof candidate) {
      case 'string': return addString(candidate)
      case 'boolean': return add(candidate ? 4 : 5)
      case 'number': return add(Number.isFinite(candidate) ? 24 : 4)
      case 'undefined': return add(4)
      case 'object': {
        if (ancestors.has(candidate)) return false
        if (!Array.isArray(candidate)) {
          const prototype = Object.getPrototypeOf(candidate)
          if (prototype !== Object.prototype && prototype !== null) return false
        }
        ancestors.add(candidate)
        if (!add(2)) return false
        if (Array.isArray(candidate)) {
          for (let index = 0; index < candidate.length; index += 1) {
            if (index > 0 && !add(1)) return false
            if (!visit(candidate[index])) return false
          }
        } else {
          const record = candidate as Record<string, unknown>
          let index = 0
          for (const key in record) {
            if (!Object.prototype.hasOwnProperty.call(record, key)) continue
            if (index > 0 && !add(1)) return false
            if (!addString(key) || !add(1) || !visit(record[key])) return false
            index += 1
          }
        }
        ancestors.delete(candidate)
        return true
      }
      default:
        return false
    }
  }
  return visit(value) ? bytes : SNAPSHOT_ESTIMATE_OVERFLOW
}

function evictUntilBounded(): void {
  while (
    snapshots.size > THREAD_SNAPSHOT_CACHE_MAX_ENTRIES ||
    totalBytes > THREAD_SNAPSHOT_CACHE_MAX_BYTES
  ) {
    const oldestId = snapshots.keys().next().value as string | undefined
    if (!oldestId) return
    const oldest = snapshots.get(oldestId)
    snapshots.delete(oldestId)
    totalBytes -= oldest?.payloadBytes ?? 0
  }
}

function removeSnapshot(threadId: string): void {
  const existing = snapshots.get(threadId)
  if (!existing) return
  snapshots.delete(threadId)
  totalBytes -= existing.payloadBytes
}

export function cacheThreadSnapshot(
  snapshot: ThreadSnapshot,
  token?: ThreadSnapshotCacheToken
): boolean {
  if (token && !threadSnapshotCacheTokenIsCurrent(snapshot.threadId, token)) return false
  if (!liveProjectionIsCoherent(snapshot)) {
    invalidateThreadSnapshot(snapshot.threadId)
    return false
  }
  const payloadBytes = normalizedPayloadBytes(snapshot.payloadBytes)
  const bytes = Math.max(payloadBytes, estimateSnapshotBytes(snapshot))
  if (bytes > THREAD_SNAPSHOT_CACHE_MAX_BYTES) {
    invalidateThreadSnapshot(snapshot.threadId)
    return false
  }
  removeSnapshot(snapshot.threadId)
  snapshots.set(snapshot.threadId, { ...snapshot, payloadBytes: bytes })
  totalBytes += bytes
  evictUntilBounded()
  return snapshots.has(snapshot.threadId)
}

export function snapshotThreadProjection(state: ChatState, payloadBytes?: number): void {
  const threadId = state.activeThreadId
  if (!threadId || state.threadLoadingId === threadId) return
  const existing = snapshots.get(threadId)
  const bytes = normalizedPayloadBytes(payloadBytes ?? existing?.payloadBytes)
  if (bytes > THREAD_SNAPSHOT_CACHE_MAX_BYTES) {
    invalidateThreadSnapshot(threadId)
    return
  }
  const thread = state.threads?.find((candidate) => candidate.id === threadId)
  cacheThreadSnapshot({
    threadId,
    fingerprint: thread
      ? threadSnapshotFingerprint(thread)
      : [threadId, '', '', '', '', '', '', ''].join('\u0000'),
    blocks: state.blocks,
    lastSeq: state.lastSeq,
    threadHistoryCursor: state.threadHistoryCursor,
    threadHasMoreHistory: state.threadHasMoreHistory,
    ...copyLiveProjection(state),
    busy: state.busy,
    busyUnconfirmed: state.busyUnconfirmed,
    currentTurnId: state.currentTurnId,
    currentTurnOrchestration: state.currentTurnOrchestration,
    currentTurnUserId: state.currentTurnUserId,
    turnStartedAtByUserId: state.turnStartedAtByUserId,
    turnDurationByUserId: state.turnDurationByUserId,
    turnReasoningFirstAtByUserId: state.turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId: state.turnReasoningLastAtByUserId,
    activeThreadRelation: state.activeThreadRelation,
    activeThreadParentId: state.activeThreadParentId,
    activeThreadGoal: state.activeThreadGoal,
    activeThreadTodos: state.activeThreadTodos,
    queuedMessages: state.queuedMessages,
    payloadBytes: bytes
  })
}

export function getThreadSnapshot(
  threadId: string,
  expectedFingerprint?: string
): ThreadSnapshot | null {
  const snapshot = snapshots.get(threadId)
  if (!snapshot) return null
  if (expectedFingerprint && snapshot.fingerprint !== expectedFingerprint) {
    invalidateThreadSnapshot(threadId)
    return null
  }
  // Map insertion order is our LRU ordering.
  snapshots.delete(threadId)
  snapshots.set(threadId, snapshot)
  return snapshot
}

/**
 * Resolve the snapshot used by cross-thread selection. Settled projections
 * remain fingerprint-strict. A projection that this renderer already observed
 * running may tolerate the sidebar advancing its sequence for that same turn:
 * SSE resumes from the parked cursor and durably replays the gap.
 */
export function getThreadSnapshotForSelection(thread: NormalizedThread): ThreadSnapshot | null {
  const snapshot = snapshots.get(thread.id)
  if (!snapshot) return null
  if (!liveProjectionIsCoherent(snapshot)) {
    invalidateThreadSnapshot(thread.id)
    return null
  }
  const fingerprint = threadSnapshotFingerprint(thread)
  if (snapshot.fingerprint === fingerprint) {
    snapshots.delete(thread.id)
    snapshots.set(thread.id, snapshot)
    return snapshot
  }
  const sameRunningTurn = snapshot.busy &&
    !snapshot.busyUnconfirmed &&
    thread.archived !== true &&
    threadLooksRunning(thread) &&
    Boolean(snapshot.currentTurnId) &&
    thread.latestTurnId === snapshot.currentTurnId &&
    typeof thread.latestSeq === 'number' &&
    thread.latestSeq >= snapshot.lastSeq &&
    (thread.relation ?? 'primary') === (snapshot.activeThreadRelation ?? 'primary') &&
    (thread.parentThreadId ?? null) === (snapshot.activeThreadParentId ?? null)
  if (!sameRunningTurn) {
    invalidateThreadSnapshot(thread.id)
    return null
  }
  const refreshed = { ...snapshot, fingerprint }
  snapshots.delete(thread.id)
  snapshots.set(thread.id, refreshed)
  return refreshed
}

export function buildPrefetchedThreadSnapshot(
  thread: NormalizedThread,
  detail: ThreadDetail
): ThreadSnapshot | null {
  const labeledBlocks =
    detail.relation === 'side' && detail.model
      ? detail.blocks.map((block) =>
          block.kind === 'user' && !block.modelLabel
            ? { ...block, modelLabel: detail.model }
            : block
        )
      : detail.blocks
  const loaded = hydrateBlockModelLabels(thread.id, labeledBlocks)
  const busy = threadSnapshotLooksRunning(
    loaded,
    detail.threadStatus,
    detail.latestTurnStatus
  )
  if (busy) return null
  const blocks = settlePendingRuntimeWorkAfterInterrupt(loaded)
  const queuedMessages = reconcileQueuedMessages(queuedMessagesForThread(thread.id), {
    busy: false,
    turnId: detail.latestTurnId,
    blocks
  })
  return {
    threadId: thread.id,
    fingerprint: threadSnapshotFingerprint(thread),
    blocks,
    lastSeq: detail.latestSeq,
    threadHistoryCursor: detail.historyCursor ?? null,
    threadHasMoreHistory: detail.hasMoreHistory === true,
    ...emptyLiveProjection(detail.latestSeq),
    busy: false,
    busyUnconfirmed: false,
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: detail.turnDurationByUserId ?? {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    activeThreadRelation: detail.relation ?? thread.relation ?? 'primary',
    activeThreadParentId: detail.parentThreadId ?? thread.parentThreadId ?? null,
    activeThreadGoal: detail.goal ?? thread.goal ?? null,
    activeThreadTodos: detail.todos ?? thread.todos ?? null,
    queuedMessages,
    payloadBytes: normalizedPayloadBytes(detail.payloadBytes)
  }
}

export function invalidateThreadSnapshot(threadId: string): void {
  threadGenerations.set(threadId, (threadGenerations.get(threadId) ?? 0) + 1)
  removeSnapshot(threadId)
}

export function clearThreadSnapshotCache(): void {
  snapshots.clear()
  totalBytes = 0
  cacheGeneration += 1
  threadGenerations.clear()
}

/** Test-only, kept narrow so product code never depends on cache internals. */
export function threadSnapshotCacheStats(): { entries: number; bytes: number } {
  return { entries: snapshots.size, bytes: totalBytes }
}
