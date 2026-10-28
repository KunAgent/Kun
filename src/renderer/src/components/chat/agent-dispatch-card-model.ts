import type { AdeDispatchRecord } from '@shared/ade-teams'
import type { ActivityRow } from '@shared/activity-row'
import type {
  AgentDispatchAssignmentRoute,
  AgentDispatchAssignmentView,
  AgentDispatchIntentView
} from '@shared/agent-dispatch'
import type { WorkbenchModel } from '../rooms/workbench-agent-selection'

/** Card-level phase: which header badge, controls and worker rows apply. */
export type DispatchPhase =
  | 'waiting' | 'paused' | 'reviewing' | 'active' | 'review' | 'completed' | 'failed' | 'cancelled'

export function dispatchPhase(state: AgentDispatchIntentView['state']): DispatchPhase {
  switch (state) {
    case 'pending_confirmation': case 'countdown': return 'waiting'
    case 'paused': return 'paused'
    case 'reviewing': return 'reviewing'
    case 'awaiting_parent': return 'review'
    case 'completed': case 'failed': case 'cancelled': return state
    default: return 'active'
  }
}

/** Route choices stay open until the card is admitted; a review in flight must settle first. */
export function dispatchRoutesEditable(intent: AgentDispatchIntentView): boolean {
  return ['pending_confirmation', 'countdown', 'paused'].includes(intent.state)
}

/**
 * One row per worker. Cards written before per-worker routes existed carry
 * only the joined batch title; split it when it lines up with the workers.
 */
export function dispatchAssignments(intent: AgentDispatchIntentView): AgentDispatchAssignmentView[] {
  const recommendation = intent.recommendation
  if (recommendation.assignments?.length) return recommendation.assignments
  const route = { agentId: recommendation.agentId,
    ...(recommendation.agentName ? { agentName: recommendation.agentName } : {}),
    ...(recommendation.model ? { model: recommendation.model } : {}) }
  const workers = intent.target?.workerIds?.length ?? 0
  const labels = recommendation.title.split(' / ').map((label) => label.trim())
  if (workers > 1 && labels.length === workers && labels.every(Boolean)) {
    return labels.map((label) => ({ ...route, label: label.slice(0, 64) }))
  }
  return [{ ...route, label: recommendation.title.slice(0, 64) }]
}

export function assignmentRoute(assignment: AgentDispatchAssignmentRoute): AgentDispatchAssignmentRoute {
  return { agentId: assignment.agentId, ...(assignment.profileId ? { profileId: assignment.profileId } : {}),
    ...(assignment.model ? { model: assignment.model } : {}),
    ...(assignment.providerId ? { providerId: assignment.providerId } : {}),
    ...(assignment.credentialMode ? { credentialMode: assignment.credentialMode } : {}) }
}

/** The `update` body names every worker's route in card order. */
export function replaceAssignmentRoute(assignments: readonly AgentDispatchAssignmentRoute[], index: number,
  next: AgentDispatchAssignmentRoute): AgentDispatchAssignmentRoute[] {
  return assignments.map((assignment, position) => assignmentRoute(position === index ? next : assignment))
}

export function sameAssignmentRoute(left: AgentDispatchAssignmentRoute, right: AgentDispatchAssignmentRoute): boolean {
  return left.agentId === right.agentId && (left.profileId ?? '') === (right.profileId ?? '') &&
    (left.model ?? '') === (right.model ?? '') &&
    (left.providerId ?? '') === (right.providerId ?? '') && (left.credentialMode ?? '') === (right.credentialMode ?? '')
}

/** The room task picker helpers speak WorkbenchModel; dispatch routes map onto it 1:1. */
export function workbenchModelFromRoute(route: AgentDispatchAssignmentRoute): WorkbenchModel {
  return { harnessId: route.agentId as WorkbenchModel['harnessId'], model: route.model ?? '',
    ...(route.providerId ? { providerId: route.providerId } : {}),
    ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}) }
}

/** A route switch keeps the role the user (or the Agent) picked for this worker. */
export function withRouteRole(next: AgentDispatchAssignmentRoute, current: AgentDispatchAssignmentRoute): AgentDispatchAssignmentRoute {
  return current.profileId ? { ...next, profileId: current.profileId } : next
}

/** Pick a roster role: a role bound to an engine also moves the route onto that engine. */
export function routeForRole(current: AgentDispatchAssignmentRoute, role: {
  id: string
  engine: { kind: 'lane-default' } | { kind: 'bound'; harnessId: string; credentialMode: AgentDispatchAssignmentRoute['credentialMode']; model?: string; providerId?: string }
} | undefined): AgentDispatchAssignmentRoute {
  const { profileId: _previous, ...base } = current
  if (!role) return base
  if (role.engine.kind !== 'bound') return { ...base, profileId: role.id }
  return { agentId: role.engine.harnessId, profileId: role.id,
    ...(role.engine.model ? { model: role.engine.model } : {}),
    ...(role.engine.providerId ? { providerId: role.engine.providerId } : {}),
    ...(role.engine.credentialMode ? { credentialMode: role.engine.credentialMode } : {}) }
}

export function routeFromWorkbenchModel(model: WorkbenchModel): AgentDispatchAssignmentRoute {
  return { agentId: model.harnessId || 'kun', ...(model.model ? { model: model.model } : {}),
    ...(model.providerId ? { providerId: model.providerId } : {}),
    ...(model.credentialMode ? { credentialMode: model.credentialMode } : {}) }
}

/**
 * Remaining share of the no-response window. The host stamps `updatedAt` in the
 * same write that sets the deadline, so their gap is the full window.
 */
export function dispatchCountdown(intent: AgentDispatchIntentView, now: number):
  { remainingMs: number; fraction: number } | null {
  if (intent.state !== 'countdown' || !intent.deadline) return null
  const deadline = Date.parse(intent.deadline)
  const total = Math.max(1_000, deadline - Date.parse(intent.updatedAt))
  const remainingMs = Math.max(0, deadline - now)
  return { remainingMs, fraction: Math.min(1, remainingMs / total) }
}

export function formatDispatchClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export type DispatchReviewState = 'awaiting_review' | 'needs_changes' | 'rejected' | 'passed' | 'waived'

function completedReview(dispatch: AdeDispatchRecord): DispatchReviewState {
  const status = dispatch.verdict?.status
  return !status || status === 'pending' ? 'awaiting_review' : status
}

export function originalDispatch(intent: AgentDispatchIntentView, index: number,
  dispatches: readonly AdeDispatchRecord[]): AdeDispatchRecord | undefined {
  return dispatches.find((entry) => entry.dispatchId === intent.target?.dispatchIds?.[index] &&
    entry.workerId === intent.target?.workerIds?.[index])
}

export function dispatchReviewState(intent: AgentDispatchIntentView,
  dispatches: readonly AdeDispatchRecord[]): DispatchReviewState | undefined {
  if (!['completed', 'awaiting_parent'].includes(intent.state)) return undefined
  const originals = dispatchAssignments(intent).map((_, index) => originalDispatch(intent, index, dispatches))
  const reviews = originals.map((entry) => entry?.state === 'completed' ? completedReview(entry) : undefined)
  if (reviews.includes('rejected')) return 'rejected'
  if (reviews.includes('needs_changes')) return 'needs_changes'
  if (reviews.some((entry) => !entry)) return undefined
  if (reviews.includes('awaiting_review')) return 'awaiting_review'
  return reviews.includes('waived') ? 'waived' : 'passed'
}

export type WorkerProgressState = 'pending' | 'working' | 'waiting' | 'done' | 'failed' | 'cancelled' | DispatchReviewState
export type WorkerProgress = {
  workerId?: string
  state: WorkerProgressState
  detail?: string
  waitingReason?: ActivityRow['waitingReason']
}

function fallbackProgress(intent: AgentDispatchIntentView, hasWorker: boolean): WorkerProgressState {
  switch (dispatchPhase(intent.state)) {
    case 'completed': case 'review': return hasWorker ? 'done' : 'cancelled'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'active': return hasWorker && intent.state === 'running' ? 'working' : 'pending'
    default: return 'pending'
  }
}

/** Live state of the worker at `index`, from the activity feed when it has a row. */
export function workerProgress(intent: AgentDispatchIntentView, index: number,
  rows: Readonly<Record<string, ActivityRow>>, dispatches: readonly AdeDispatchRecord[] = []): WorkerProgress {
  const workerId = intent.target?.workerIds?.[index]
  if (!workerId) return { state: fallbackProgress(intent, false) }
  const original = originalDispatch(intent, index, dispatches)
  if (original?.state === 'completed') return { workerId, state: completedReview(original), detail: original.verdict?.notes }
  if (original?.state === 'failed' || original?.state === 'cancelled') return { workerId, state: original.state }
  // Worker-wide activity may now belong to a later worker_send, not this card.
  if (['completed', 'awaiting_parent'].includes(intent.state)) return { workerId, state: 'done' }
  const row = rows[workerId] ?? Object.values(rows).find((entry) => entry.unitId === workerId || entry.threadId === workerId)
  if (!row) return { workerId, state: fallbackProgress(intent, true) }
  const detail = row.currentTool || row.progressNote || undefined
  switch (row.state) {
    case 'working': case 'initializing': return { workerId, state: 'working', detail }
    case 'waiting': return { workerId, state: 'waiting', waitingReason: row.waitingReason, detail }
    case 'failed': return { workerId, state: 'failed', detail: row.lastMessagePreview }
    default:
      if (row.lastOutcome === 'failed') return { workerId, state: 'failed', detail: row.lastMessagePreview }
      if (row.lastOutcome === 'cancelled') return { workerId, state: 'cancelled' }
      if (row.lastOutcome === 'completed' || row.state === 'done') return { workerId, state: 'done' }
      return { workerId, state: fallbackProgress(intent, true) }
  }
}
