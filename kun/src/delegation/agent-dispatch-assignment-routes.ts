import type {
  AgentDispatchAction,
  AgentDispatchAssignment,
  AgentDispatchIntent,
  AgentDispatchRecommendation,
  AgentDispatchState
} from '../contracts/agent-dispatch-intents.js'

type AssignmentRouteEdits = NonNullable<NonNullable<AgentDispatchAction['recommendation']>['assignments']>

/**
 * Apply per-worker route edits by index. A legacy single-route edit (top-level
 * agentId/model) still works for one-worker cards; batches must name every worker.
 */
export function mergeAssignmentRoutes(
  current: AgentDispatchRecommendation,
  edits: { agentId?: string; model?: string; title?: string },
  routeEdits?: AssignmentRouteEdits
): { assignments: AgentDispatchAssignment[]; changed: boolean } | undefined {
  const base = current.assignments ?? (routeEdits?.length === 1 || edits.agentId || edits.model !== undefined
    ? [{ label: current.title.slice(0, 64), agentId: current.agentId,
        ...(current.agentName ? { agentName: current.agentName } : {}),
        ...(current.model ? { model: current.model } : {}) }]
    : undefined)
  if (!base) {
    if (routeEdits) throw new Error('This dispatch card predates per-worker routes; ask the Agent to propose it again.')
    return undefined
  }
  let edited: AssignmentRouteEdits | undefined = routeEdits
  if (!edited && (edits.agentId || edits.model !== undefined)) {
    if (base.length !== 1) throw new Error('Change a batch with one route per worker.')
    const agentId = edits.agentId ?? base[0].agentId
    edited = [agentId === base[0].agentId
      ? { ...routeOf(base[0]), model: edits.model ?? base[0].model }
      : { agentId, ...(edits.model ? { model: edits.model } : {}) }]
  }
  if (edited && edited.length !== base.length) throw new Error('Route edits must cover every worker on the card.')
  let changed = false
  const assignments = base.map((assignment, index) => {
    const label = base.length === 1 && edits.title ? edits.title.slice(0, 64) : assignment.label
    const next = edited?.[index]
    if (!next || sameRoute(assignment, next)) return { ...assignment, label }
    changed = true
    return { label, ...routeOf(next),
      ...(next.agentId === assignment.agentId && assignment.agentName ? { agentName: assignment.agentName } : {}) }
  })
  return { assignments, changed }
}

function routeOf(route: AssignmentRouteEdits[number]): AssignmentRouteEdits[number] {
  return { agentId: route.agentId, ...(route.profileId ? { profileId: route.profileId } : {}),
    ...(route.model ? { model: route.model } : {}),
    ...(route.providerId ? { providerId: route.providerId } : {}),
    ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}) }
}

function sameRoute(left: AssignmentRouteEdits[number], right: AssignmentRouteEdits[number]): boolean {
  return left.agentId === right.agentId && (left.profileId ?? '') === (right.profileId ?? '') &&
    (left.model ?? '') === (right.model ?? '') &&
    (left.providerId ?? '') === (right.providerId ?? '') && (left.credentialMode ?? '') === (right.credentialMode ?? '')
}

/** Host-only reroute of one failed card assignment, decided by the kind's handler. */
export type AssignmentReplacement = {
  index: number
  /** The rerouted payload item; the handler owns its shape. */
  item: Record<string, unknown>
  assignment: AgentDispatchAssignment
  reason: string
  expectedRevision: number
}

/** Cards whose failed assignment may be rerouted without touching admitted siblings. */
const REROUTABLE = new Set<AgentDispatchState>(['queued', 'running', 'failed'])

/**
 * Swap one assignment's route and payload item in place, once per
 * assignment. The card returns to `uncertain`, so the ordinary
 * reconcile -> start path creates only the missing worker while siblings
 * are matched by their unchanged ids.
 */
export function rerouteAssignment(intent: AgentDispatchIntent, input: AssignmentReplacement): void {
  const items = (intent.payload as { items?: unknown }).items
  const assignments = intent.recommendation.assignments
  const previous = Array.isArray(items) ? items[input.index] as { fallbackCount?: unknown } | undefined : undefined
  if (!REROUTABLE.has(intent.state) || intent.recommendation.agentSelection !== 'auto' ||
      intent.cancellationRequested || intent.takenOver || !Array.isArray(items) || !previous ||
      previous.fallbackCount === 1 || !assignments?.[input.index] || assignments.length !== items.length) {
    throw new Error('Dispatch does not permit rerouting this assignment')
  }
  intent.payload = { ...intent.payload, items: items.map((item, index) => index === input.index ? input.item : item) }
  intent.recommendation.assignments = assignments.map((assignment, index) =>
    index === input.index ? input.assignment : assignment)
  if (input.index === 0) {
    intent.recommendation.agentId = input.assignment.agentId
    intent.recommendation.agentName = input.assignment.agentName
    intent.recommendation.model = input.assignment.model
  }
  intent.state = 'uncertain'
  delete intent.error; delete intent.resultSummary
  intent.replacementReason = [intent.replacementReason, input.reason].filter(Boolean).join('\n').slice(-8_192)
}
