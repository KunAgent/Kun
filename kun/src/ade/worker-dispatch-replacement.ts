import { rebuildWorkerDispatchContext } from './worker-dispatch-security.js'
import { authorityFromTurn } from './permission-clamp.js'
import { resolveManagerWorkerRoute } from './worker-route.js'
import { sameWorkerRoute, workerRouteHealth } from './worker-route-health.js'
import { assignmentFallbacks } from './worker-dispatch-ids.js'
import type {
  AgentDispatchAssignment,
  AgentDispatchIntent,
  AgentDispatchRecommendation
} from '../contracts/agent-dispatch-intents.js'
import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import type { HarnessRoute } from '../contracts/harness.js'
import type { ManagerRuntimeDeps } from './manager-runtime-deps.js'
import type { WorkerCreateInput } from './manager-worker-inputs.js'

type Alternative = NonNullable<WorkerRecord['selection']>['alternatives'][number]

/** One saved card assignment, as the worker dispatch payload stores it. */
export type SavedWorkerAssignment = {
  input: WorkerCreateInput
  selection?: Record<string, unknown>
  profileId?: string
  fallbackCount?: number
}

/**
 * Stop and inspect a failed automatically routed worker, then list the routes
 * that may take over its exact checkout. A route that already failed here in a
 * way no retry fixes (model refused for this account, credentials rejected)
 * is never offered.
 */
async function replacementCandidates(
  deps: ManagerRuntimeDeps, intent: AgentDispatchIntent, failed: DispatchRecord, input: WorkerCreateInput
) {
  const worker = await deps.teams.worker(intent.source.threadId, failed.workerId)
  if (!worker || worker.control !== 'manager' || !worker.taskWorkspaceId ||
      !deps.taskWorkspaces) return null
  // Nothing to switch to: leave the failed worker and its checkout untouched.
  if (!worker.selection?.alternatives?.length && !deps.selector) return null
  await deps.deliverer.stopWorker(worker.workerId)
  if (await deps.deliverer.workerBusy(worker.workerId)) return null
  const run = await deps.childRuns.get(worker.workerId).catch(() => null)
  if (run && (run.status === 'running' || run.status === 'queued')) return null
  // A stopped Agent may have made useful changes; inspect and reuse the exact checkout.
  await deps.taskWorkspaces.captureForDispatch(worker.taskWorkspaceId)
  const workspace = deps.taskWorkspaces.get(worker.taskWorkspaceId)
  if (!workspace || !['ready', 'captured', 'conflict'].includes(workspace.state)) return null
  let alternatives: Alternative[] = worker.selection?.alternatives ?? []
  if (!alternatives.length && deps.selector) {
    const context = await rebuildWorkerDispatchContext(deps, intent, new AbortController().signal)
    const resolved = await resolveManagerWorkerRoute(deps, {
      threadId: intent.source.threadId, turnId: intent.source.turnId, workspace: context.workspace,
      authority: authorityFromTurn({ approvalPolicy: context.approvalPolicy,
        sandboxMode: context.sandboxMode ?? 'workspace-write', approvalReviewer: context.approvalReviewer ?? 'user' }, undefined),
      signal: context.abortSignal, awaitApproval: context.awaitApproval
    }, { ...input, agent: undefined }, workspace.isolation === 'worktree',
    (teamId, route) => workerRouteHealth(deps, teamId, route))
    if (!('error' in resolved)) alternatives = [
      { route: resolved.route, profileId: resolved.profileId, label: resolved.route.harnessId, score: 0 },
      ...(resolved.selection?.alternatives ?? [])
    ]
  }
  const usable: Alternative[] = []
  for (const alternative of alternatives) {
    if (sameRoute(alternative.route, worker.route) || deps.catalog.isDisabled(alternative.route.harnessId) ||
        !deps.catalog.isProfileEnabled(alternative.route)) continue
    if ((await workerRouteHealth(deps, intent.source.threadId, alternative.route)).unusable) continue
    usable.push(alternative)
  }
  return { worker, workspace, alternatives: usable }
}

/** One alternative after a failed automatically selected worker has actually settled. */
export async function replaceFailedWorkerDispatch(
  deps: ManagerRuntimeDeps, intent: AgentDispatchIntent, failed: DispatchRecord,
  input: WorkerCreateInput
): Promise<boolean> {
  const service = deps.agentDispatchService
  if (!service || intent.replacementCount > 0 || intent.cancellationRequested || intent.takenOver ||
      intent.recommendation.agentSelection !== 'auto') return false
  const candidates = await replacementCandidates(deps, intent, failed, input)
  if (!candidates) return false
  const { worker, workspace } = candidates
  for (const alternative of candidates.alternatives) {
    const definition = deps.catalog.get(alternative.route.harnessId)
    if (!definition) continue
    const recommendation: AgentDispatchRecommendation = {
      ...intent.recommendation, agentId: alternative.route.harnessId,
      agentName: definition.displayName, model: alternative.route.model,
      agentSelection: 'auto',
      // The card's route must name the replacement, or the start would rebuild the failed one.
      ...(intent.recommendation.assignments ? { assignments: [{
        label: intent.recommendation.assignments[0]?.label ?? input.label,
        agentId: alternative.route.harnessId, agentName: definition.displayName, model: alternative.route.model,
        ...(alternative.route.providerId ? { providerId: alternative.route.providerId } : {}),
        credentialMode: alternative.route.credentialMode
      }] } : {})
    }
    const replacementInput = { ...input, agent: alternative.route,
      workspace: { ...input.workspace, reuseTaskWorkspaceId: workspace.workspaceId } }
    const payload = { ...intent.payload,
      items: [{ input: replacementInput, ...(alternative.profileId ? { profileId: alternative.profileId } : {}) }],
      originalAgentId: alternative.route.harnessId, originalModel: alternative.route.model }
    try {
      const current = await service.updateTarget(intent.intentId, { state: 'failed', target: {
        threadId: intent.source.threadId, workerIds: [worker.workerId], dispatchIds: [failed.dispatchId]
      }, error: failed.failureReason ?? 'Automatically selected worker failed.' })
      await service.replace(intent.intentId, { recommendation, payload,
        reason: `${definition.displayName} replaces the failed ${worker.route.harnessId} after its workspace was inspected.`,
        expectedRevision: current?.revision })
      await deps.teams.upsertWorker(intent.source.threadId, { ...worker, state: 'released', releasedAt: deps.nowIso() })
      return true
    } catch {
      // Disabled/logged-out alternatives are rejected by the ordinary live admission check.
      const current = await service.get(intent.intentId)
      if (current?.replacementCount || current?.cancellationRequested || current?.takenOver) return false
    }
  }
  return false
}

/**
 * Reroute one failed assignment of an automatic batch to its next usable
 * route. Siblings keep their workers; the replacement reuses the failed
 * worker's checkout and gets fresh ids, once per assignment.
 */
export async function replaceFailedBatchAssignment(
  deps: ManagerRuntimeDeps, intent: AgentDispatchIntent, index: number, failed: DispatchRecord,
  item: SavedWorkerAssignment
): Promise<boolean> {
  const service = deps.agentDispatchService
  const assignment = intent.recommendation.assignments?.[index]
  if (!service || !assignment || item.fallbackCount || intent.cancellationRequested || intent.takenOver ||
      intent.recommendation.agentSelection !== 'auto') return false
  const candidates = await replacementCandidates(deps, intent, failed, item.input)
  if (!candidates) return false
  const { worker, workspace } = candidates
  const failedEngine = engineLabel(deps, worker.route)
  for (const alternative of candidates.alternatives) {
    const definition = deps.catalog.get(alternative.route.harnessId)
    if (!definition) continue
    const reason = `${assignment.label}: ${engineLabel(deps, alternative.route)} took over after ` +
      `${failedEngine} failed (${compact(failed.failureReason ?? 'worker failed')}).`
    const next: AgentDispatchAssignment = {
      label: assignment.label, agentId: alternative.route.harnessId, agentName: definition.displayName,
      model: alternative.route.model,
      ...(alternative.route.providerId ? { providerId: alternative.route.providerId } : {}),
      credentialMode: alternative.route.credentialMode
    }
    const replacement: SavedWorkerAssignment = {
      input: { ...item.input, agent: alternative.route,
        workspace: { ...item.input.workspace, reuseTaskWorkspaceId: workspace.workspaceId } },
      selection: { reason: reason.slice(0, 2_000), score: alternative.score, alternatives: [] },
      ...(alternative.profileId ? { profileId: alternative.profileId } : {}),
      fallbackCount: 1
    }
    try {
      const current = await service.get(intent.intentId)
      await service.replaceAssignment(intent.intentId, { index, item: replacement, assignment: next, reason,
        expectedRevision: current?.revision ?? intent.revision })
      await deps.teams.upsertWorker(intent.source.threadId, { ...worker, state: 'released', releasedAt: deps.nowIso() })
      return true
    } catch {
      // A route the live admission check rejects (logged out, disabled) falls through to the next one.
      const current = await service.get(intent.intentId)
      if (!current || current.cancellationRequested || current.takenOver || assignmentFallbacks(current)[index]) return false
    }
  }
  return false
}

function sameRoute(left: HarnessRoute, right: HarnessRoute): boolean {
  return sameWorkerRoute(left, right) && left.credentialMode === right.credentialMode
}

function engineLabel(deps: ManagerRuntimeDeps, route: HarnessRoute): string {
  return `${deps.catalog.get(route.harnessId)?.displayName ?? route.harnessId} · ${route.model}`
}

function compact(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= 160 ? flat : `${flat.slice(0, 157)}...`
}
