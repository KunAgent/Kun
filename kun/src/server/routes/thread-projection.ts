import type { ThreadRecord } from '../../contracts/threads.js'
import type { Turn } from '../../contracts/turns.js'
import {
  isPublicTurnItem,
  type ApprovalTurnItem,
  type TurnItem
} from '../../contracts/items.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import {
  type FinishedTurnStatus,
  finalizeOpenTurnItem
} from '../../domain/turn-item-finalization.js'
import { placeCompactionsChronologically } from '../../loop/compaction-history.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadService } from '../../services/thread-service.js'

export function projectTimelineThread(thread: ThreadRecord): ThreadRecord {
  return {
    ...thread,
    ...(thread.summary ? { summary: truncateTimelineText(thread.summary, 64 * 1024) } : {}),
    additionalWorkspaces: thread.additionalWorkspaces?.slice(0, 32),
    knowledgeBases: thread.knowledgeBases?.slice(0, 8),
    // These snapshots are model/runtime inputs, not renderer timeline data.
    extensionProfile: undefined,
    toolCatalogEpoch: undefined,
    systemPrompt: undefined,
    turns: thread.turns.map((turn) => projectTimelineTurn(turn, turn.items))
  }
}

export function projectTimelineTurn(turn: Turn, items: TurnItem[]): Turn {
  return {
    ...turn,
    prompt: '',
    steering: [],
    items,
    attachmentIds: turn.attachmentIds.slice(0, 32),
    composerContexts: undefined,
    activeSkillIds: turn.activeSkillIds.slice(0, 32),
    injectedMemoryIds: turn.injectedMemoryIds.slice(0, 32),
    injectedMemorySummaries: [],
    injectedInstructionSources: [],
    graphLeadLifecycle: undefined,
    graphPlanningLifecycle: undefined,
    guiPlan: undefined,
    guiDesignArtifact: undefined,
    ...(turn.error ? { error: truncateTimelineText(turn.error, 16 * 1024) } : {})
  }
}

function truncateTimelineText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 24)}... [truncated]`
}

export function omitTurnItems(turn: Turn): Omit<Turn, 'items'> {
  const { items: _items, ...metadata } = turn
  return metadata
}

export function loadThreadMetadata(
  service: ThreadService,
  threadId: string
): Promise<ThreadRecord | null> {
  // Keep direct route-unit fakes and third-party ThreadService facades from
  // needing a coordinated upgrade; production ThreadService always exposes
  // getMetadata and takes the lightweight path.
  return typeof service.getMetadata === 'function'
    ? service.getMetadata(threadId)
    : service.get(threadId)
}

export function mergePendingApprovalItems(
  sessionItems: TurnItem[],
  pendingApprovals: readonly ApprovalRequest[]
): TurnItem[] {
  if (pendingApprovals.length === 0) return sessionItems
  const byApprovalId = new Map(pendingApprovals.map((approval) => [approval.id, approval]))
  const foundApprovalIds = new Set<string>()
  const merged = sessionItems.map((item) => {
    if (item.kind !== 'approval') return item
    const approval = byApprovalId.get(item.approvalId)
    if (!approval) return item
    foundApprovalIds.add(approval.id)
    return approvalItemFromRequest(approval, item)
  })
  const additions = pendingApprovals
    .filter((approval) => !foundApprovalIds.has(approval.id))
    .map((approval) => approvalItemFromRequest(approval))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))

  for (const item of additions) {
    const firstLaterItem = merged.findIndex(
      (candidate) => candidate.turnId === item.turnId && candidate.createdAt > item.createdAt
    )
    if (firstLaterItem >= 0) {
      merged.splice(firstLaterItem, 0, item)
      continue
    }
    const lastTurnItem = merged.reduce(
      (index, candidate, candidateIndex) => candidate.turnId === item.turnId ? candidateIndex : index,
      -1
    )
    if (lastTurnItem >= 0) merged.splice(lastTurnItem + 1, 0, item)
    else merged.push(item)
  }
  return merged
}

function approvalItemFromRequest(
  approval: ApprovalRequest,
  existing?: ApprovalTurnItem
): ApprovalTurnItem {
  return {
    id: existing?.id ?? `item_${approval.id}`,
    turnId: approval.turnId,
    threadId: approval.threadId,
    role: 'tool',
    createdAt: existing?.createdAt ?? approval.createdAt,
    kind: 'approval',
    approvalId: approval.id,
    toolName: approval.toolName,
    summary: approval.summary,
    status: 'pending',
    approvalReviewer: 'user'
  }
}

export async function healSessionItemsForFinishedTurns(
  thread: ThreadRecord,
  items: TurnItem[],
  sessionStore: SessionStore
): Promise<TurnItem[]> {
  if (items.length === 0 || thread.turns.length === 0) return items
  const finishedByTurnId = new Map<string, { status: FinishedTurnStatus; finishedAt?: string }>()
  for (const turn of thread.turns) {
    const status = finishedTurnStatus(turn.status)
    if (!status) continue
    finishedByTurnId.set(turn.id, { status, finishedAt: turn.finishedAt })
  }
  if (finishedByTurnId.size === 0) return items

  const healedAt = new Date().toISOString()
  const healedItems: TurnItem[] = []
  const nextItems = items.map((item) => {
    const finished = finishedByTurnId.get(item.turnId)
    if (!finished) return item
    const next = finalizeOpenTurnItem(item, finished.status, finished.finishedAt ?? healedAt)
    if (next !== item) healedItems.push(next)
    return next
  })
  if (healedItems.length === 0) return items

  for (const item of healedItems) {
    try {
      await sessionStore.updateItem(thread.id, item.id, {
        status: item.status,
        ...(item.finishedAt ? { finishedAt: item.finishedAt } : {})
      })
    } catch {
      // Healing is best-effort; the response still uses the repaired view.
    }
  }
  return nextItems
}

function finishedTurnStatus(status: Turn['status']): FinishedTurnStatus | null {
  return status === 'completed' || status === 'failed' || status === 'aborted' ? status : null
}

export function hydrateThreadItemsFromSession(
  thread: ThreadRecord,
  items: TurnItem[]
): ThreadRecord {
  if (thread.turns.length === 0) return thread
  const itemsByTurn = new Map<string, TurnItem[]>()
  for (const item of items) {
    if (!isPublicTurnItem(item)) continue
    const turnItems = itemsByTurn.get(item.turnId) ?? []
    turnItems.push(item)
    itemsByTurn.set(item.turnId, turnItems)
  }
  let changed = false
  const turns = thread.turns.map((turn): Turn => {
    const sessionTurnItems = itemsByTurn.get(turn.id)
    if (sessionTurnItems) {
      changed = true
      return { ...turn, items: placeCompactionsChronologically(sessionTurnItems) }
    }
    const publicItems = turn.items.filter(isPublicTurnItem)
    if (publicItems.length === turn.items.length) return turn
    changed = true
    return { ...turn, items: publicItems }
  })
  return changed ? { ...thread, turns } : thread
}

/** Defense in depth for every HTTP endpoint that returns a ThreadRecord. */
export function projectPublicThreadRecord(thread: ThreadRecord): ThreadRecord {
  const { revision: _revision, ...publicThread } = thread
  const turns = thread.turns.map((turn): Turn => ({
    ...turn,
    items: turn.items.filter(isPublicTurnItem)
  }))
  return { ...publicThread, turns }
}
