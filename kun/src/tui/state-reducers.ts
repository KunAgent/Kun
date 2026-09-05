import type { ContextSnapshotEvent, RuntimeEvent } from '../contracts/events.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type {
  ApprovalTurnItem,
  TurnItem,
  UserInputQuestionSchema,
  UserInputTurnItem
} from '../contracts/items.js'
import type { Turn } from '../contracts/turns.js'
import type { DelegationDiagnostics, ThreadDetail } from './client.js'
import type { z } from 'zod'
import type { ProjectedApprovalReview, ProjectedChildRun, ProjectedTurnActivity, ThreadProjection } from './state-types.js'

export function normalizedSelection(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

/**
 * Return only a request-local context snapshot that belongs to the active
 * thread/model/provider selection. This mirrors the GUI's isolation rule and
 * prevents a model switch from combining an old numerator with a new window.
 */
export function matchingRequestContextSnapshot(
  projection: ThreadProjection | undefined,
  selection: { model?: string; providerId?: string }
): ContextSnapshotEvent | undefined {
  const snapshot = projection?.contextSnapshot
  if (!projection || !snapshot || snapshot.threadId !== projection.thread.id) return undefined
  const selectedModel = normalizedSelection(selection.model)
  const snapshotModel = normalizedSelection(snapshot.model)
  if (selectedModel && selectedModel !== 'auto' && selectedModel !== snapshotModel) return undefined
  const selectedProvider = normalizedSelection(selection.providerId)
  const snapshotProvider = normalizedSelection(snapshot.providerId)
  if (selectedProvider) {
    return selectedProvider === snapshotProvider ? snapshot : undefined
  }
  return !snapshotProvider || snapshotProvider === 'default' ? snapshot : undefined
}

export function replaceGoal(thread: ThreadDetail, goal: ThreadDetail['goal'] | undefined): ThreadDetail {
  const { goal: _goal, ...withoutGoal } = thread
  return goal ? { ...withoutGoal, goal } : withoutGoal
}

export function replaceTodos(thread: ThreadDetail, todos: ThreadDetail['todos'] | undefined): ThreadDetail {
  const { todos: _todos, ...withoutTodos } = thread
  return todos ? { ...withoutTodos, todos } : withoutTodos
}

export function setProjectionRunningTurn(
  current: ThreadProjection,
  turnId: string,
  prompt = '',
  timestamp = new Date().toISOString(),
  metadata: Partial<Pick<Turn, 'model' | 'providerId' | 'accountId' | 'reasoningEffort' | 'mode' | 'orchestration' | 'attachmentIds'>> = {}
): ThreadProjection {
  return {
    ...current,
    runningTurnId: turnId,
    lastError: undefined,
    activity: {
      turnId,
      phase: 'starting',
      label: 'Sending message',
      startedAt: timestamp,
      turnStartedAt: timestamp,
      updatedAt: timestamp
    },
    thread: updateTurnStatus(current.thread, turnId, 'queued', 'running', timestamp, prompt, metadata)
  }
}

export function activityFromTurn(turn: Turn): ProjectedTurnActivity {
  const last = [...turn.items].reverse().find((item) =>
    item.kind === 'assistant_text' || item.kind === 'assistant_reasoning' || item.kind === 'tool_call'
  )
  const phase = last?.kind === 'assistant_text'
    ? 'responding'
    : last?.kind === 'assistant_reasoning'
      ? 'thinking'
      : last?.kind === 'tool_call'
        ? 'tool'
        : 'starting'
  return {
    turnId: turn.id,
    phase,
    ...(last?.kind === 'tool_call' ? { label: last.summary ?? last.toolName, toolName: last.toolName } : {}),
    startedAt: last?.createdAt ?? turn.startedAt ?? turn.createdAt,
    turnStartedAt: turn.startedAt ?? turn.createdAt,
    updatedAt: last?.createdAt ?? turn.startedAt ?? turn.createdAt
  }
}

export function activityFor(
  turnId: string,
  phase: ProjectedTurnActivity['phase'],
  label: string,
  timestamp: string,
  previous?: ProjectedTurnActivity
): ProjectedTurnActivity {
  const sameTurn = previous?.turnId === turnId
  const samePhase = sameTurn && previous.phase === phase && previous.label === label
  return {
    turnId,
    phase,
    label,
    startedAt: samePhase ? previous.startedAt : timestamp,
    turnStartedAt: sameTurn ? previous.turnStartedAt : timestamp,
    updatedAt: timestamp
  }
}

export function updateActivityForItem(
  state: ThreadProjection,
  item: TurnItem,
  eventKind: 'item_created' | 'item_updated' | 'item_completed' | 'tool_call_started' | 'tool_call_finished',
  timestamp: string
): ThreadProjection {
  if (state.runningTurnId !== item.turnId) return state
  if (eventKind === 'tool_call_started' || item.kind === 'tool_call' && item.status === 'running') {
    return {
      ...state,
      activity: {
        ...activityFor(item.turnId, 'tool', item.kind === 'tool_call' ? item.summary ?? item.toolName : 'Running tool', timestamp, state.activity),
        ...(item.kind === 'tool_call' ? { toolName: item.toolName } : {})
      }
    }
  }
  if (item.kind === 'assistant_reasoning' && item.status === 'running') {
    return { ...state, activity: activityFor(item.turnId, 'thinking', 'Thinking', timestamp, state.activity) }
  }
  if (item.kind === 'assistant_text' && item.status === 'running') {
    return { ...state, activity: activityFor(item.turnId, 'responding', 'Responding', timestamp, state.activity) }
  }
  if (eventKind === 'tool_call_finished' || item.kind === 'tool_result') {
    return { ...state, activity: activityFor(item.turnId, 'starting', 'Processing tool result', timestamp, state.activity) }
  }
  return state
}

export function projectChildLifecycle(
  state: ThreadProjection,
  event: Extract<RuntimeEvent, { kind: 'turn_started' | 'turn_queued' | 'turn_completed' | 'turn_failed' | 'turn_aborted' | 'turn_steered' }>
): ThreadProjection {
  const child = event.child!
  const index = state.childRuns.findIndex((run) => run.childId === child.childId)
  const existing = index >= 0 ? state.childRuns[index] : undefined
  const next: ProjectedChildRun = {
    childId: child.childId,
    parentTurnId: child.parentTurnId,
    ...(child.childLabel ? { label: child.childLabel } : {}),
    ...(child.childProfile ? { profile: child.childProfile } : {}),
    ...(child.childProfileName ? { profileName: child.childProfileName } : {}),
    ...(child.childModel ? { model: child.childModel } : {}),
    ...(child.childProviderId ? { providerId: child.childProviderId } : {}),
    ...(child.childToolPolicy ? { toolPolicy: child.childToolPolicy } : {}),
    status: child.childStatus,
    ...(event.text ? { text: event.text } : {}),
    ...(child.detached ? { detached: true } : {}),
    ...(child.prefixReused !== undefined ? { prefixReused: child.prefixReused } : {}),
    ...(child.inheritedHistoryItems !== undefined ? { inheritedHistoryItems: child.inheritedHistoryItems } : {}),
    ...(child.toolInvocations !== undefined ? { toolInvocations: child.toolInvocations } : {}),
    ...(child.activity ? { activity: child.activity } : {}),
    ...(child.durationMs !== undefined ? { durationMs: child.durationMs } : {}),
    ...(child.queuedMs !== undefined ? { queuedMs: child.queuedMs } : {}),
    ...(child.totalTokens !== undefined ? { totalTokens: child.totalTokens } : {}),
    ...(child.cacheHitRate !== undefined ? { cacheHitRate: child.cacheHitRate } : {}),
    ...(child.costUsd !== undefined ? { costUsd: child.costUsd } : {}),
    ...(child.costCny !== undefined ? { costCny: child.costCny } : {}),
    childSeq: child.childSeq,
    startedAt: existing?.startedAt ?? event.timestamp,
    updatedAt: event.timestamp
  }
  const childRuns = [...state.childRuns]
  if (index >= 0) childRuns[index] = { ...childRuns[index], ...next }
  else childRuns.push(next)
  return { ...state, childRuns }
}

export function upsertVisibleError(
  state: ThreadProjection,
  input: {
    turnId: string
    timestamp: string
    message: string
    code?: string
    details?: unknown
    severity: 'info' | 'warning' | 'error'
    status?: 'failed' | 'aborted' | 'completed'
  }
): ThreadProjection {
  const item: TurnItem = {
    id: `item_${input.turnId}_error`,
    turnId: input.turnId,
    threadId: state.thread.id,
    role: 'system',
    status: input.status ?? 'failed',
    createdAt: input.timestamp,
    finishedAt: input.timestamp,
    kind: 'error',
    message: input.message,
    ...(input.code ? { code: input.code } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
    severity: input.severity
  }
  return {
    ...state,
    items: upsertItem(state.items, item),
    thread: upsertTurnItem(state.thread, item)
  }
}

export function hasVisibleTurnOutcome(items: readonly TurnItem[], turnId: string): boolean {
  return items.some((item) => item.turnId === turnId && (
    item.kind === 'assistant_text' && item.text.trim().length > 0 ||
    item.kind === 'tool_result' || item.kind === 'error'
  ))
}

export function appendDeltaItem(items: readonly TurnItem[], fragment: TurnItem): TurnItem {
  const current = items.find((item) => item.id === fragment.id)
  if (
    !current ||
    current.kind !== fragment.kind ||
    (fragment.kind !== 'assistant_text' && fragment.kind !== 'assistant_reasoning') ||
    (current.kind !== 'assistant_text' && current.kind !== 'assistant_reasoning')
  ) return fragment
  return {
    ...fragment,
    createdAt: current.createdAt,
    text: `${current.text}${fragment.text}`
  }
}

export function upsertItem(items: readonly TurnItem[], item: TurnItem): TurnItem[] {
  const index = items.findIndex((entry) => entry.id === item.id)
  if (index < 0) return [...items, item]
  if (items[index] === item) return [...items]
  const next = [...items]
  next[index] = item
  return next
}

export function updateTurnStatus(
  thread: ThreadDetail,
  turnId: string | undefined,
  status: Turn['status'],
  threadStatus: ThreadDetail['status'],
  timestamp: string,
  prompt = '',
  metadata: Partial<Pick<Turn, 'model' | 'providerId' | 'accountId' | 'reasoningEffort' | 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer' | 'mode' | 'orchestration' | 'attachmentIds'>> = {}
): ThreadDetail {
  if (!turnId) return { ...thread, status: threadStatus }
  const withTurn = ensureTurn(thread, turnId, status, timestamp, prompt, metadata)
  const terminal = status === 'completed' || status === 'failed' || status === 'aborted'
  return {
    ...withTurn,
    status: threadStatus,
    turns: withTurn.turns.map((turn) => turn.id === turnId
      ? {
          ...turn,
          ...metadata,
          status,
          ...(status === 'running' && !turn.startedAt ? { startedAt: timestamp } : {}),
          ...(terminal ? { finishedAt: timestamp, steering: [] } : {})
        }
      : turn)
  }
}

export function ensureTurn(
  thread: ThreadDetail,
  turnId: string,
  status: Turn['status'],
  timestamp: string,
  prompt = '',
  metadata: Partial<Pick<Turn, 'model' | 'providerId' | 'accountId' | 'reasoningEffort' | 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer' | 'mode' | 'orchestration' | 'attachmentIds'>> = {}
): ThreadDetail {
  if (thread.turns.some((turn) => turn.id === turnId)) {
    if (Object.keys(metadata).length === 0) return thread
    return {
      ...thread,
      turns: thread.turns.map((turn) => turn.id === turnId ? { ...turn, ...metadata } : turn)
    }
  }
  const turn: Turn = {
    id: turnId,
    threadId: thread.id,
    status,
    prompt,
    orchestration: metadata.orchestration ?? 'direct',
    model: thread.model,
    ...(thread.providerId ? { providerId: thread.providerId } : {}),
    ...(thread.accountId ? { accountId: thread.accountId } : {}),
    steering: [],
    createdAt: timestamp,
    ...(status === 'running' ? { startedAt: timestamp } : {}),
    items: [],
    attachmentIds: [],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedInstructionSources: [],
    mode: thread.mode,
    ...metadata
  }
  return { ...thread, turns: [...thread.turns, turn] }
}

export function upsertTurnItem(thread: ThreadDetail, item: TurnItem): ThreadDetail {
  const prompt = item.kind === 'user_message' ? item.text : ''
  const withTurn = ensureTurn(thread, item.turnId, 'running', item.createdAt, prompt)
  return {
    ...withTurn,
    turns: withTurn.turns.map((turn) => turn.id === item.turnId
      ? {
          ...turn,
          ...(item.kind === 'user_message' ? { prompt: item.text } : {}),
          ...(item.kind === 'user_message' && item.attachmentIds
            ? { attachmentIds: item.attachmentIds }
            : {}),
          items: upsertItem(turn.items, item)
        }
      : turn)
  }
}

export function mapTurnItems(thread: ThreadDetail, map: (item: TurnItem) => TurnItem): ThreadDetail {
  return {
    ...thread,
    turns: thread.turns.map((turn) => ({ ...turn, items: turn.items.map(map) }))
  }
}

export function omitPendingApproval(state: ThreadProjection, approvalId: string): ThreadProjection {
  if (state.pendingApproval?.approvalId !== approvalId) return state
  const { pendingApproval: _pending, ...rest } = state
  return rest
}

export function upsertApprovalReview(
  reviews: readonly ProjectedApprovalReview[],
  review: ProjectedApprovalReview
): ProjectedApprovalReview[] {
  const index = reviews.findIndex((candidate) => candidate.reviewId === review.reviewId)
  if (index < 0) return [...reviews, review]
  return reviews.map((candidate, candidateIndex) =>
    candidateIndex === index ? review : candidate
  )
}

export function omitPendingUserInput(state: ThreadProjection, inputId: string): ThreadProjection {
  if (state.pendingUserInput?.inputId !== inputId) return state
  const { pendingUserInput: _pending, ...rest } = state
  return rest
}
