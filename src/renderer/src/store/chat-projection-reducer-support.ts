import type { ChatBlock, ThreadDeltaEvent, ToolBlock, ToolEventPayload } from '../agent/types'
import {
  dedupeTimelineTextBlocks,
  isSyntheticTimelineTextBlock
} from '../agent/timeline-text-blocks'
import type { ChatState } from './chat-store-types'

export function monotonicToolStatus(
  current: ToolBlock['status'],
  incoming: ToolBlock['status']
): ToolBlock['status'] {
  // A persisted replay may contain the historical tool_call_started record
  // after the snapshot already contains its terminal result.  Terminal state
  // is durable; only a running -> terminal transition is actionable.
  return current !== 'running' && incoming === 'running' ? current : incoming
}

export function isNewChildAttempt(
  current: Pick<ToolBlock, 'meta' | 'detail'>,
  incoming: Pick<ToolEventPayload, 'meta' | 'detail'>
): boolean {
  const currentCount = toolProjectionResumeCount(current)
  const incomingCount = toolProjectionResumeCount(incoming)
  return incomingCount !== undefined && incomingCount > (currentCount ?? 0)
}

export function isStaleChildAttempt(
  current: Pick<ToolBlock, 'meta' | 'detail'>,
  incoming: Pick<ToolEventPayload, 'meta' | 'detail'>
): boolean {
  const currentCount = toolProjectionResumeCount(current) ?? 0
  const incomingCount = toolProjectionResumeCount(incoming) ?? 0
  return currentCount > incomingCount
}

/**
 * Returns only text that is not already present in the projected assistant /
 * reasoning buffer. Content-aware rules catch cumulative snapshots and full
 * final-text redelivery (new seq, same body) that seq floors alone cannot.
 */
export function unseenDeltaText(
  delta: ThreadDeltaEvent,
  blocks: ChatBlock[],
  liveText: string,
  liveItemId: string | undefined
): string {
  if (!delta.text) return ''

  const blockKind = delta.kind === 'agent_message' ? 'assistant' : 'reasoning'
  const hydrated = delta.itemId
    ? blocks.find((block) => block.kind === blockKind && block.id === delta.itemId)
    : undefined
  const hydratedText = hydrated && (
    hydrated.kind === 'assistant' || hydrated.kind === 'reasoning'
  ) ? hydrated.text : ''
  const projectedText = hydratedText + (
    delta.itemId && liveItemId === delta.itemId ? liveText : ''
  )

  const contentAware = unseenAssistantFragment(projectedText, delta.text)
  if (contentAware !== null) return contentAware

  const offset = delta.deltaOffset
  if (
    !delta.itemId ||
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    // Legacy events have no stable item-relative position and retain the
    // original append-only projection semantics for genuinely new text.
    return delta.text
  }

  if (offset > projectedText.length) return delta.text

  const overlapLength = Math.min(
    delta.text.length,
    Math.max(0, projectedText.length - offset)
  )
  if (
    overlapLength > 0 &&
    projectedText.slice(offset, offset + overlapLength) !== delta.text.slice(0, overlapLength)
  ) {
    // Offset is only a dedup hint. Prefer dropping a mismatched fragment over
    // fail-open appending the full body (Answer×N in one bubble).
    if (projectedText.includes(delta.text)) return ''
    return offset === projectedText.length ? delta.text : ''
  }
  return delta.text.slice(overlapLength)
}

/** Shared content-idempotent merge for assistant/reasoning stream fragments. */
export function unseenAssistantFragment(
  projectedText: string,
  fragment: string
): string | null {
  if (!fragment) return ''
  if (projectedText === fragment || projectedText.startsWith(fragment)) return ''
  if (fragment.startsWith(projectedText)) return fragment.slice(projectedText.length)
  return null
}

export function flushLiveProjection(
  state: ChatState,
  now: number,
  base: Partial<ChatState> = {}
): Partial<ChatState> {
  let nextBlocks = state.blocks
  const createdAt = new Date(now).toISOString()
  if (state.liveReasoning.trim()) {
    nextBlocks = upsertTimelineBlock(nextBlocks, {
      kind: 'reasoning',
      id: state.liveReasoningItemId ?? `r-${now}`,
      turnId: state.liveReasoningTurnId ?? state.currentTurnId ?? undefined,
      createdAt: state.liveReasoningCreatedAt ?? createdAt,
      text: state.liveReasoning
    })
  }
  if (state.liveAssistant.trim()) {
    nextBlocks = upsertTimelineBlock(nextBlocks, {
      kind: 'assistant',
      id: state.liveAssistantItemId ?? `a-${now}`,
      turnId: state.liveAssistantTurnId ?? state.currentTurnId ?? undefined,
      createdAt: state.liveAssistantCreatedAt ?? createdAt,
      text: state.liveAssistant
    })
  }
  if (
    nextBlocks === state.blocks &&
    !state.liveReasoningItemId &&
    !state.liveReasoningTurnId &&
    !state.liveReasoningCreatedAt &&
    !state.liveAssistantItemId &&
    !state.liveAssistantTurnId &&
    !state.liveAssistantCreatedAt
  ) return base
  return {
    ...base,
    ...(nextBlocks !== state.blocks ? { blocks: nextBlocks } : {}),
    liveReasoning: '',
    liveAssistant: '',
    liveReasoningItemId: undefined,
    liveReasoningTurnId: undefined,
    liveReasoningCreatedAt: undefined,
    liveAssistantItemId: undefined,
    liveAssistantTurnId: undefined,
    liveAssistantCreatedAt: undefined
  }
}

export function updateProjectedThreadStatus(
  threads: ChatState['threads'],
  threadId: string,
  status: string,
  latestTurnStatus?: string,
  latestTurnId?: string
): ChatState['threads'] {
  let changed = false
  const next = threads.map((thread) => {
    if (thread.id !== threadId) return thread
    if (thread.status === status && (
      latestTurnStatus === undefined || thread.latestTurnStatus === latestTurnStatus
    ) && (
      latestTurnId === undefined || thread.latestTurnId === latestTurnId
    )) {
      return thread
    }
    changed = true
    return {
      ...thread,
      status,
      ...(latestTurnStatus ? { latestTurnStatus } : {}),
      ...(latestTurnId ? { latestTurnId } : {})
    }
  })
  return changed ? next : threads
}

export function settleProjectedThreadStatus(
  threads: ChatState['threads'],
  threadId: string,
  latestTurnStatus: 'completed' | 'failed' | 'aborted'
): ChatState['threads'] {
  const thread = threads.find((candidate) => candidate.id === threadId)
  if (!thread || thread.status?.trim().toLowerCase() !== 'running') return threads
  return updateProjectedThreadStatus(threads, threadId, 'idle', latestTurnStatus)
}

export function runtimeEventStartedAt(createdAt: string | undefined, now: number): number {
  if (!createdAt) return now
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return now
  const maxPastAgeMs = 30 * 60_000
  const maxFutureSkewMs = 5_000
  return parsed < now - maxPastAgeMs || parsed > now + maxFutureSkewMs ? now : parsed
}

export function finalizeTurnTimingAt(state: ChatState, now: number): Partial<ChatState> {
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
  const newAttempt = isNewChildAttempt(base, update)
  const staleAttempt = isStaleChildAttempt(base, update)
  const status = mergedToolProjectionStatus(base, update, newAttempt, staleAttempt)
  // The pending update may be an older queued/running lifecycle snapshot that
  // raced ahead of the settled tool result. Keep terminal summary/detail intact
  // instead of replacing them with the minimal lifecycle payload.
  const staleRunning = staleAttempt || (!newAttempt && status !== update.status)
  const preserveTerminalResult = shouldPreserveTerminalResult(base, update, newAttempt)
  return {
    ...base,
    turnId: staleAttempt ? base.turnId : (update.turnId ?? base.turnId),
    createdAt: base.createdAt ?? update.createdAt,
    summary: staleRunning || preserveTerminalResult ? base.summary : (update.summary || base.summary),
    status,
    toolKind: update.toolKind ?? base.toolKind,
    detail: staleRunning || preserveTerminalResult ? base.detail : (update.detail ?? base.detail),
    filePath: update.filePath ?? base.filePath,
    meta: mergeToolProjectionMeta(base.meta, update.meta)
  }
}

function shouldPreserveTerminalResult(
  base: ToolEventPayload,
  update: ToolEventPayload,
  newAttempt: boolean
): boolean {
  if (newAttempt || update.updateOnly !== true || !base.detail) return false
  const current = childProjectionStatus(base)
  const incoming = childProjectionStatus(update)
  return Boolean(current && incoming && isTerminalChildStatus(current) && isTerminalChildStatus(incoming))
}

function mergedToolProjectionStatus(
  base: ToolEventPayload,
  update: ToolEventPayload,
  newAttempt: boolean,
  staleAttempt: boolean
): ToolEventPayload['status'] {
  if (staleAttempt) return base.status
  const childStatus = authoritativeChildStatus(base, update, newAttempt)
  const detached = newAttempt
    ? isDetachedSubagentToolEvent(update)
    : isDetachedSubagentToolEvent(base) || isDetachedSubagentToolEvent(update)
  if (detached && (childStatus === 'queued' || childStatus === 'running')) return 'running'
  if (childStatus === 'completed') return 'success'
  if (childStatus === 'failed' || childStatus === 'aborted') return 'error'
  return newAttempt ? update.status : monotonicToolStatus(base.status, update.status)
}

function authoritativeChildStatus(
  base: Pick<ToolEventPayload, 'meta' | 'detail'>,
  update: Pick<ToolEventPayload, 'meta' | 'detail'>,
  newAttempt: boolean
): string | undefined {
  const current = childProjectionStatus(base)
  const incoming = childProjectionStatus(update)
  if (newAttempt) return incoming
  if (current && isTerminalChildStatus(current) && (incoming === 'queued' || incoming === 'running')) {
    return current
  }
  return incoming ?? current
}

function childProjectionStatus(
  value: Pick<ToolEventPayload, 'meta' | 'detail'>
): string | undefined {
  const child = value.meta?.child
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    const status = (child as Record<string, unknown>).childStatus
    if (typeof status === 'string') return status
  }
  const status = detailRecord(value.detail)?.status
  return typeof status === 'string' ? status : undefined
}

export function mergeToolProjectionMeta(
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
    merged.child = mergeChildMetadata(
      currentChild as Record<string, unknown>,
      incomingChild as Record<string, unknown>
    )
  }
  return merged
}

/**
 * Child lifecycle metadata is monotonic: a terminal `childStatus` recorded by
 * the settled result must survive an older queued/running snapshot, while a
 * genuine running -> terminal transition still wins.
 */
function mergeChildMetadata(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const currentResumeCount = childResumeCount(current) ?? 0
  const incomingResumeCount = childResumeCount(incoming) ?? 0
  if (currentResumeCount > incomingResumeCount) return { ...incoming, ...current }
  const currentStatus = current.childStatus
  const incomingStatus = incoming.childStatus
  const newAttempt = incomingResumeCount > currentResumeCount
  if (newAttempt) return mergeNewChildAttemptMetadata(current, incoming)
  const merged = { ...current, ...incoming }
  if (
    !newAttempt &&
    typeof currentStatus === 'string' &&
    typeof incomingStatus === 'string' &&
    isTerminalChildStatus(currentStatus) &&
    (incomingStatus === 'queued' || incomingStatus === 'running')
  ) {
    merged.childStatus = currentStatus
  }
  return merged
}

const CHILD_ATTEMPT_SCOPED_KEYS = [
  'detached', 'childTerminationReason', 'resumable', 'failure', 'proactiveRetry',
  'activity', 'toolInvocations', 'durationMs', 'queuedMs', 'totalTokens',
  'summaryTruncated', 'resultRef', 'resultUnavailableReason'
] as const

function mergeNewChildAttemptMetadata(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...current, ...incoming }
  for (const key of CHILD_ATTEMPT_SCOPED_KEYS) {
    if (!(key in incoming)) delete merged[key]
  }
  return merged
}

function childResumeCount(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const count = (value as Record<string, unknown>).resumeCount
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : undefined
}

function toolProjectionResumeCount(
  value: Pick<ToolBlock, 'meta' | 'detail'> | Pick<ToolEventPayload, 'meta' | 'detail'>
): number | undefined {
  return childResumeCount(value.meta?.child) ?? childResumeCount(detailRecord(value.detail))
}

function isTerminalChildStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}

export function isDetachedSubagentToolEvent(event: ToolEventPayload): boolean {
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

export function isUserInputInterruptError(message: string | undefined): boolean {
  if (!message) return false
  const normalized = message.trim().toLowerCase()
  return normalized.includes('interrupt') || normalized.includes('cancelled') || normalized.includes('canceled')
}

export function upsertTimelineBlock(blocks: ChatBlock[], incoming: ChatBlock): ChatBlock[] {
  const canonicalBlocks = dedupeTimelineTextBlocks(blocks)
  const incomingKind = incoming.kind
  const incomingTurnId = incoming.turnId
  const incomingText = incoming.kind === 'assistant' || incoming.kind === 'reasoning'
    ? incoming.text
    : ''
  const incomingIsTextBlock = incoming.kind === 'assistant' || incoming.kind === 'reasoning'
  const incomingIsSynthetic = isSyntheticTimelineTextBlock(incoming)
  const index = canonicalBlocks.findIndex(
    (block) => block.kind === incomingKind && block.id === incoming.id
  )
  if (index < 0) {
    const syntheticIndex = !incomingIsTextBlock || incomingIsSynthetic
      ? -1
      : canonicalBlocks.findIndex((block) => (
          isSyntheticTimelineTextBlock(block) &&
          block.kind === incomingKind &&
          block.turnId === incomingTurnId &&
          block.text === incomingText
        ))
    if (syntheticIndex < 0) return [...canonicalBlocks, incoming]
    const next = [...canonicalBlocks]
    next[syntheticIndex] = incoming
    return next
  }
  const current = canonicalBlocks[index]
  if (sameStableTimelineBlock(current, incoming)) return canonicalBlocks
  const next = [...canonicalBlocks]
  next[index] = incoming
  return next
}

function sameStableTimelineBlock(left: ChatBlock, right: ChatBlock): boolean {
  if (left.kind !== right.kind || left.id !== right.id) return false
  if (
    (left.kind === 'assistant' && right.kind === 'assistant') ||
    (left.kind === 'reasoning' && right.kind === 'reasoning')
  ) {
    return (
      left.turnId === right.turnId &&
      left.createdAt === right.createdAt &&
      left.text === right.text
    )
  }
  return left === right
}

export function reconcileSnapshotBlocks(current: ChatBlock[], persisted: ChatBlock[]): ChatBlock[] {
  const canonicalPersisted = dedupeTimelineTextBlocks(persisted)
  const currentByIdentity = new Map(
    current.map((block) => [`${block.kind}:${block.id}`, block] as const)
  )
  return canonicalPersisted.map((block) => {
    const existing = currentByIdentity.get(`${block.kind}:${block.id}`)
    return existing && sameStableTimelineBlock(existing, block) ? existing : block
  })
}

export function reconcileSnapshotTurn(
  current: ChatBlock[],
  persisted: ChatBlock[],
  turnId: string,
  userBlockId?: string | null
): ChatBlock[] {
  const persistedTurn = dedupeTimelineTextBlocks(persisted).filter(
    (block) => block.turnId === turnId || Boolean(userBlockId && block.id === userBlockId)
  )
  if (persistedTurn.length === 0) return current

  const currentByIdentity = new Map(
    current.map((block) => [`${block.kind}:${block.id}`, block] as const)
  )
  const stablePersistedTurn = persistedTurn.map((block) => {
    const existing = currentByIdentity.get(`${block.kind}:${block.id}`)
    return existing && sameStableTimelineBlock(existing, block) ? existing : block
  })
  const explicitTargetIndexes = current.flatMap((block, index) =>
    block.turnId === turnId || Boolean(userBlockId && block.id === userBlockId) ? [index] : []
  )
  const userIndex = userBlockId
    ? current.findIndex((block) => block.kind === 'user' && block.id === userBlockId)
    : -1
  let nextUserIndex = current.length
  if (userIndex >= 0) {
    for (let index = userIndex + 1; index < current.length; index += 1) {
      if (current[index]?.kind === 'user') {
        nextUserIndex = index
        break
      }
    }
  }
  const belongsToTarget = (block: ChatBlock, index: number): boolean => {
    if (block.turnId === turnId || Boolean(userBlockId && block.id === userBlockId)) return true
    return (
      userIndex >= 0 &&
      index > userIndex &&
      index < nextUserIndex &&
      !block.turnId &&
      (block.kind === 'assistant' || block.kind === 'reasoning')
    )
  }
  const insertionIndex = explicitTargetIndexes.length > 0
    ? Math.min(...explicitTargetIndexes)
    : current.length
  const before = current.slice(0, insertionIndex).filter((block, index) => !belongsToTarget(block, index))
  const after = current.slice(insertionIndex).filter(
    (block, offset) => !belongsToTarget(block, insertionIndex + offset)
  )
  return [...before, ...stablePersistedTurn, ...after]
}
