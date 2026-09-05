import type { ThreadRecord } from '../../contracts/threads.js'
import type { Turn } from '../../contracts/turns.js'
import {
  isPublicTurnItem,
  type ApprovalTurnItem,
  type TurnItem,
  type ToolResultTurnItem
} from '../../contracts/items.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import type { ChildRunRecord } from '../../delegation/delegation-runtime-contracts.js'
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
  const publicTurn = projectPublicTurn(turn)
  return {
    ...publicTurn,
    prompt: '',
    steering: [],
    items: items.filter(isPublicTurnItem),
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

export function projectPublicTurn(turn: Turn): Turn {
  const {
    terminalCode: _terminalCode,
    managerLeaseSettlement: _managerLeaseSettlement,
    ...publicTurn
  } = turn
  return {
    ...publicTurn,
    items: turn.items.filter(isPublicTurnItem)
  } as Turn
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
  const turns = thread.turns.map(projectPublicTurn)
  return { ...publicThread, turns }
}

const CHILD_BACKED_TOOL_NAMES = new Set(['delegate_task', 'fast_context'])

/** True when the page contains a child-backed tool result linked to a child run. */
export function hasChildBackedToolResult(items: readonly TurnItem[]): boolean {
  return items.some(
    (item) => item.kind === 'tool_result' &&
      CHILD_BACKED_TOOL_NAMES.has(item.toolName) &&
      childBackedProgressNeedsOverlay(item)
  )
}

/**
 * Overlay authoritative child-run records onto persisted child-backed tool
 * progress. The first queued update is durable while later running updates can
 * be transient, so a timeline snapshot must reconcile every lifecycle state.
 * This projection is read-only: canonical model history remains unchanged.
 */
export function overlayChildRunsOnToolResults(
  items: TurnItem[],
  childRuns: readonly ChildRunRecord[]
): { items: TurnItem[]; unresolved: boolean } {
  const runsById = new Map(childRuns.map((run) => [run.id, run]))
  let changed = false
  let unresolved = false
  const next = items.map((item): TurnItem => {
    if (item.kind !== 'tool_result' || !CHILD_BACKED_TOOL_NAMES.has(item.toolName)) return item
    const attempt = childBackedAttempt(item)
    if (!attempt) {
      if (childBackedProgressNeedsOverlay(item)) unresolved = true
      return item
    }
    const run = runsById.get(attempt.childId)
    if (
      !run ||
      run.parentTurnId !== item.turnId ||
      (run.resumeCount ?? 0) !== attempt.resumeCount
    ) {
      unresolved = true
      return item
    }
    changed = true
    return overlayChildRunOnToolResult(item, run)
  })
  return { items: changed ? next : items, unresolved }
}

function childBackedProgressNeedsOverlay(item: ToolResultTurnItem): boolean {
  if (childBackedAttempt(item)) return true
  const output = item.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false
  const status = (output as Record<string, unknown>).status
  return status === 'queued' || status === 'running'
}

function childBackedAttempt(
  item: ToolResultTurnItem
): { childId: string; resumeCount: number } | undefined {
  const output = item.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const record = output as Record<string, unknown>
  const childId = record.childId
  if (typeof childId !== 'string' || !childId.trim()) return undefined
  const resumeCount = typeof record.resumeCount === 'number' &&
    Number.isSafeInteger(record.resumeCount) && record.resumeCount >= 0
    ? record.resumeCount
    : 0
  return { childId: childId.trim(), resumeCount }
}

function overlayChildRunOnToolResult(
  item: ToolResultTurnItem,
  run: ChildRunRecord
): ToolResultTurnItem {
  const persistedOutput = (item.output && typeof item.output === 'object' && !Array.isArray(item.output))
    ? item.output as Record<string, unknown>
    : {}
  const persistedChild = persistedOutput.child &&
    typeof persistedOutput.child === 'object' &&
    !Array.isArray(persistedOutput.child)
    ? persistedOutput.child as Record<string, unknown>
    : undefined
  const launcher = run.launcher ?? persistedOutput.launcher
  const attemptDurationMs = run.startedAt
    ? Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.startedAt))
    : undefined
  const output: Record<string, unknown> = {
    ...persistedOutput,
    childId: run.id,
    parentThreadId: run.parentThreadId,
    parentTurnId: run.parentTurnId,
    status: run.status,
    detached: run.detached === true,
    ...(launcher ? { launcher } : {}),
    ...(run.model ? { model: run.model } : {}),
    terminationReason: run.terminationReason,
    resumable: run.resumable === true,
    resumeCount: run.resumeCount ?? 0,
    failure: run.failure,
    summary: run.summary,
    evidence: run.evidence,
    evidencePack: run.evidencePack ?? persistedOutput.evidencePack,
    usage: run.usage,
    summaryTruncated: run.summaryTruncated,
    resultRef: run.resultRef,
    resultUnavailableReason: run.resultUnavailableReason,
    error: run.error,
    toolInvocations: run.toolInvocations,
    attemptStartedAt: run.startedAt,
    attemptDurationMs: Number.isFinite(attemptDurationMs) ? attemptDurationMs : undefined,
    durationMs: run.durationMs,
    queuedMs: run.queuedMs
  }
  if (item.toolName === 'fast_context' || persistedChild) {
    output.child = {
      ...(persistedChild ?? {}),
      childId: run.id,
      parentThreadId: run.parentThreadId,
      parentTurnId: run.parentTurnId,
      status: run.status,
      detached: run.detached === true,
      ...(launcher ? { launcher } : {}),
      ...(run.model ? { model: run.model } : {}),
      terminationReason: run.terminationReason,
      resumable: run.resumable === true,
      resumeCount: run.resumeCount ?? 0,
      failure: run.failure,
      attemptStartedAt: run.startedAt,
      attemptDurationMs: Number.isFinite(attemptDurationMs) ? attemptDurationMs : undefined
    }
  }
  return {
    ...item,
    output,
    isError: run.status === 'failed' || run.status === 'aborted'
  }
}
