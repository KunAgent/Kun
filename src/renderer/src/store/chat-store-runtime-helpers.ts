import type {
  ChatBlock,
  NormalizedThread,
  RuntimeDisclosureMetadata,
  UserMessageEventPayload
} from '../agent/types'
import {
  applyClientUserMessageSourceMeta,
  isBackgroundShellNoticeUserMessage
} from '@shared/background-shell-notice'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { shouldAutoTitleThread } from '../lib/thread-title'
import type { ChatState } from './chat-store-types'
import { emptyLiveProjection } from './chat-store-live-projection'

type ThreadDetailProviderLike = {
  getThreadDetail: (threadId: string) => Promise<{ blocks: ChatBlock[] }>
}

export function threadBelongsToWorkspace(
  thread: { workspace?: string },
  workspaceRoot: string
): boolean {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return false
  return normalizeWorkspaceRoot(thread.workspace) === normalizedWorkspace
}

export function hasPendingRuntimeWork(block: ChatBlock): boolean {
  if (block.kind === 'tool') return block.status === 'running' && !isDetachedSubagentToolBlock(block)
  if (block.kind === 'compaction') return block.status === 'running'
  if (block.kind === 'review') return block.status === 'running'
  if (block.kind === 'approval') return block.status === 'pending'
  if (block.kind === 'approval_review') return block.status === 'in-progress'
  if (block.kind === 'user_input') return block.status === 'pending'
  return false
}

/**
 * True when the live runtime is actively awaiting a user_input answer for one
 * of these blocks (not a stale pending record rehydrated from a finished
 * thread). Shared by the timeline progress row and the top-bar badge so both
 * switch from "running" to "awaiting your input" semantics together.
 */
export function hasLivePendingUserInput(blocks: ChatBlock[]): boolean {
  return blocks.some(
    (block) => block.kind === 'user_input' && block.status === 'pending' && block.live === true
  )
}

export function isDetachedSubagentToolBlock(block: ChatBlock): boolean {
  if (block.kind !== 'tool') return false
  const child = block.meta?.child
  if (child && typeof child === 'object' && (child as Record<string, unknown>).detached === true) {
    return true
  }
  if (!block.detail?.trim()) return false
  try {
    const parsed = JSON.parse(block.detail) as unknown
    return Boolean(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).detached === true)
  } catch {
    return false
  }
}

function assistantBlockHasVisibleContent(block: Extract<ChatBlock, { kind: 'assistant' }>): boolean {
  const withoutThink = block.text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim()
  return withoutThink.length > 0
}

export function threadHasPendingRuntimeWork(blocks: ChatBlock[]): boolean {
  let pendingInCurrentTurn = false

  for (const block of blocks) {
    if (block.kind === 'user') {
      if (isBackgroundShellNoticeUserMessage(block)) continue
      pendingInCurrentTurn = false
      continue
    }
    if (hasPendingRuntimeWork(block)) {
      pendingInCurrentTurn = true
      continue
    }
    if (pendingInCurrentTurn && block.kind === 'assistant' && assistantBlockHasVisibleContent(block)) {
      pendingInCurrentTurn = false
    }
  }

  return pendingInCurrentTurn
}

export function settlePendingRuntimeWorkAfterInterrupt(blocks: ChatBlock[]): ChatBlock[] {
  let changed = false
  const next = blocks.map((block): ChatBlock => {
    if (block.kind === 'tool' && block.status === 'running' && !isDetachedSubagentToolBlock(block)) {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'compaction' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'review' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'approval' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'approval_review' && block.status === 'in-progress') {
      changed = true
      return { ...block, status: 'aborted' as const }
    }
    if (block.kind === 'user_input' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'cancelled' as const }
    }
    return block
  })
  return changed ? next : blocks
}

export function threadSnapshotLooksRunning(
  blocks: ChatBlock[],
  threadStatus?: string,
  latestTurnStatus?: string
): boolean {
  const normalizedThreadStatus = normalizedRuntimeStatus(threadStatus)
  if (normalizedThreadStatus === 'archived' || normalizedThreadStatus === 'deleted') return false

  if (latestTurnStatus != null && latestTurnStatus.trim()) {
    return runtimeStatusLooksRunning(latestTurnStatus)
  }
  if (normalizedThreadStatus) {
    return runtimeStatusLooksRunning(normalizedThreadStatus)
  }
  return threadHasPendingRuntimeWork(blocks)
}

export function threadLooksRunning(thread: {
  status?: string
  latestTurnStatus?: string
}): boolean {
  return threadSnapshotLooksRunning([], thread.status, thread.latestTurnStatus)
}

export function findLatestUserBlockId(blocks: ChatBlock[]): string | null {
  for (let idx = blocks.length - 1; idx >= 0; idx -= 1) {
    const block = blocks[idx]
    if (block?.kind === 'user') return block.id
  }
  return null
}

export function upsertUserBlock(blocks: ChatBlock[], ev: UserMessageEventPayload): ChatBlock[] {
  const clientMeta: RuntimeDisclosureMetadata = { ...(ev.meta ?? {}) }
  applyClientUserMessageSourceMeta(clientMeta as Record<string, unknown>, ev.text)
  const nextBlock: ChatBlock = {
    kind: 'user',
    id: ev.itemId,
    turnId: ev.turnId,
    createdAt: ev.createdAt,
    text: ev.text,
    ...(ev.modelLabel ? { modelLabel: ev.modelLabel } : {}),
    ...(ev.managedBy ? { managedBy: ev.managedBy } : {}),
    ...(Object.keys(clientMeta).length > 0 ? { meta: clientMeta } : {})
  }
  const existingIndex = blocks.findIndex((block) => block.kind === 'user' && block.id === ev.itemId)
  if (existingIndex < 0) return [...blocks, nextBlock]
  const current = blocks[existingIndex]
  const mergedMeta = mergeRuntimeDisclosureMeta(
    current.kind === 'user' ? current.meta : undefined,
    nextBlock.kind === 'user' ? nextBlock.meta : undefined
  )
  const merged: ChatBlock = {
    ...current,
    ...nextBlock,
    createdAt: current.createdAt ?? nextBlock.createdAt,
    ...(mergedMeta ? { meta: mergedMeta } : {})
  }
  if (merged.kind === 'user') {
    const metaRecord = { ...(merged.meta ?? {}) } as Record<string, unknown>
    applyClientUserMessageSourceMeta(metaRecord, merged.text)
    merged.meta = Object.keys(metaRecord).length > 0 ? (metaRecord as RuntimeDisclosureMetadata) : undefined
  }
  const next = [...blocks]
  next[existingIndex] = merged
  return next
}

function mergeRuntimeDisclosureMeta(
  current: RuntimeDisclosureMetadata | undefined,
  next: RuntimeDisclosureMetadata | undefined
): RuntimeDisclosureMetadata | undefined {
  if (!current && !next) return undefined
  return {
    ...(current ?? {}),
    ...(next ?? {})
  }
}

export function isOptimisticUserBlockId(id: string): boolean {
  return id.startsWith('u-') ||
    id.startsWith('q-') ||
    id.startsWith('graph-steering-')
}

/**
 * Match a late/replayed stable user item to the client bubble created when the
 * request was sent. Stable SSE events may arrive after turn settlement, when
 * `currentTurnUserId` has already been cleared, so identity alone is not
 * available. Display text plus near-identical creation time keeps the fallback
 * scoped to the same submission and still allows intentionally repeated text.
 */
export function matchingOptimisticUserBlockId(
  blocks: ChatBlock[],
  event: UserMessageEventPayload
): string | null {
  const expectedTexts = new Set(
    [event.text, event.meta?.displayText]
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text))
  )
  const eventTime = timestampMs(event.createdAt)
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind !== 'user' || !isOptimisticUserBlockId(block.id)) continue
    if (!expectedTexts.has(block.text.trim())) continue
    const blockTurnId = block.turnId?.trim() || block.meta?.turnId?.trim()
    if (event.turnId && blockTurnId) {
      if (event.turnId !== blockTurnId) continue
      return block.id
    }
    const blockTime = timestampMs(block.createdAt)
    if (eventTime !== null && blockTime !== null && Math.abs(eventTime - blockTime) <= 60_000) {
      return block.id
    }
  }
  return null
}

function timestampMs(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function reconcileOptimisticUserBlock(
  blocks: ChatBlock[],
  optimisticId: string,
  runtimeId: string,
  fallbackText?: string,
  modelLabel?: string
): ChatBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'user' || block.id !== optimisticId) return block
    return {
      ...block,
      id: runtimeId,
      ...(fallbackText && !block.text.trim() ? { text: fallbackText } : {}),
      ...(modelLabel && !block.modelLabel ? { modelLabel } : {})
    }
  })
}

export function collectAssistantTextForTurn(
  blocks: ChatBlock[],
  userBlockId: string,
  liveAssistant: string
): string {
  const userIndex = blocks.findIndex((block) => block.kind === 'user' && block.id === userBlockId)
  if (userIndex < 0) return liveAssistant.trim()
  const parts: string[] = []
  for (let index = userIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.kind === 'user') break
    if (block.kind === 'assistant' && block.text.trim()) {
      parts.push(block.text.trim())
    }
  }
  if (liveAssistant.trim()) parts.push(liveAssistant.trim())
  return parts.join('\n\n').trim()
}

export function clearedThreadSelection(): Pick<
  ChatState,
  | 'activeThreadId'
  | 'threadLoadingId'
  | 'threadRefreshingId'
  | 'threadHistoryCursor'
  | 'threadHasMoreHistory'
  | 'threadHistoryLoading'
  | 'activeThreadRelation'
  | 'activeThreadParentId'
  | 'activeThreadGoal'
  | 'activeThreadTodos'
  | 'blocks'
  | 'lastSeq'
  | 'liveDeltaSeqFloor'
  | 'liveReasoning'
  | 'liveReasoningItemId'
  | 'liveReasoningTurnId'
  | 'liveReasoningCreatedAt'
  | 'liveAssistant'
  | 'liveAssistantItemId'
  | 'liveAssistantTurnId'
  | 'liveAssistantCreatedAt'
  | 'busy'
  | 'busyUnconfirmed'
  | 'currentTurnId'
  | 'currentTurnOrchestration'
  | 'currentTurnUserId'
  | 'turnStartedAtByUserId'
  | 'turnDurationByUserId'
  | 'turnReasoningFirstAtByUserId'
  | 'turnReasoningLastAtByUserId'
  | 'inspectorSelectedId'
  | 'queuedMessages'
> {
  return {
    activeThreadId: null,
    threadLoadingId: null,
    threadRefreshingId: null,
    threadHistoryCursor: null,
    threadHasMoreHistory: false,
    threadHistoryLoading: false,
    activeThreadRelation: null,
    activeThreadParentId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    blocks: [],
    lastSeq: 0,
    ...emptyLiveProjection(),
    busy: false,
    busyUnconfirmed: false,
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    queuedMessages: []
  }
}

export async function findReusableEmptyThreadId(
  state: ChatState,
  provider: ThreadDetailProviderLike,
  workspaceRoot: string,
  isReusableThread: (thread: NormalizedThread) => boolean = () => true
): Promise<string | null> {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return null

  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)
    : null
  if (
    activeThread &&
    isReusableThread(activeThread) &&
    shouldAutoTitleThread(activeThread) &&
    normalizeWorkspaceRoot(activeThread.workspace) === normalizedWorkspace &&
    !threadHasUserMessage(state.blocks)
  ) {
    return activeThread.id
  }

  const candidates = state.threads
    .filter(
      (thread) =>
        thread.id !== activeThread?.id &&
        isReusableThread(thread) &&
        shouldAutoTitleThread(thread) &&
        normalizeWorkspaceRoot(thread.workspace) === normalizedWorkspace
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  for (const thread of candidates) {
    try {
      const { blocks } = await provider.getThreadDetail(thread.id)
      if (!threadHasUserMessage(blocks)) return thread.id
    } catch {
      /* ignore and keep checking other candidates */
    }
  }

  return null
}

function normalizedRuntimeStatus(status?: string): string {
  return status?.trim().toLowerCase() ?? ''
}

function runtimeStatusLooksRunning(status?: string): boolean {
  const normalized = normalizedRuntimeStatus(status)
  return normalized === 'running'
    || normalized === 'in_progress'
    || normalized === 'queued'
    || normalized === 'started'
}

function threadHasUserMessage(blocks: ChatBlock[]): boolean {
  return blocks.some((block) => block.kind === 'user')
}
