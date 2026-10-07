import { rebuildWorkerDispatchContext } from './worker-dispatch-security.js'
import { authorityFromTurn } from './permission-clamp.js'
import { resolveManagerWorkerRoute } from './worker-route.js'
import { countRecentWorkerFailures } from './worker-selector.js'
import type { AgentDispatchIntent, AgentDispatchRecommendation } from '../contracts/agent-dispatch-intents.js'
import type { DispatchRecord } from '../contracts/ade.js'
import type { ManagerRuntimeDeps } from './manager-runtime-deps.js'
import type { WorkerCreateInput } from './manager-worker-inputs.js'

/** One alternative after a failed automatically selected worker has actually settled. */
export async function replaceFailedWorkerDispatch(
  deps: ManagerRuntimeDeps, intent: AgentDispatchIntent, failed: DispatchRecord,
  input: WorkerCreateInput
): Promise<boolean> {
  const service = deps.agentDispatchService
  if (!service || intent.replacementCount > 0 || intent.cancellationRequested || intent.takenOver ||
      intent.recommendation.agentSelection !== 'auto') return false
  const worker = await deps.teams.worker(intent.source.threadId, failed.workerId)
  if (!worker || worker.control !== 'manager' || !worker.taskWorkspaceId ||
      !deps.taskWorkspaces) return false
  await deps.deliverer.stopWorker(worker.workerId)
  if (await deps.deliverer.workerBusy(worker.workerId)) return false
  const run = await deps.childRuns.get(worker.workerId).catch(() => null)
  if (run && (run.status === 'running' || run.status === 'queued')) return false
  // A stopped Agent may have made useful changes; inspect and reuse the exact checkout.
  await deps.taskWorkspaces.captureForDispatch(worker.taskWorkspaceId)
  const workspace = deps.taskWorkspaces.get(worker.taskWorkspaceId)
  if (!workspace || !['ready', 'captured', 'conflict'].includes(workspace.state)) return false
  let alternatives = worker.selection?.alternatives ?? []
  if (!alternatives.length && deps.selector) {
    const context = await rebuildWorkerDispatchContext(deps, intent, new AbortController().signal)
    const resolved = await resolveManagerWorkerRoute(deps, {
      threadId: intent.source.threadId, turnId: intent.source.turnId, workspace: context.workspace,
      authority: authorityFromTurn({ approvalPolicy: context.approvalPolicy,
        sandboxMode: context.sandboxMode ?? 'workspace-write', approvalReviewer: context.approvalReviewer ?? 'user' }, undefined),
      signal: context.abortSignal, awaitApproval: context.awaitApproval
    }, { ...input, agent: undefined }, workspace.isolation === 'worktree',
    (teamId, harnessId) => countRecentWorkerFailures(deps, teamId, harnessId))
    if (!('error' in resolved)) alternatives = [
      { route: resolved.route, profileId: resolved.profileId, label: resolved.route.harnessId, score: 0 },
      ...(resolved.selection?.alternatives ?? [])
    ]
  }
  for (const alternative of alternatives) {
    if (JSON.stringify(alternative.route) === JSON.stringify(worker.route) ||
        deps.catalog.isDisabled(alternative.route.harnessId) || !deps.catalog.isProfileEnabled(alternative.route)) continue
    const definition = deps.catalog.get(alternative.route.harnessId)
    if (!definition) continue
    const recommendation: AgentDispatchRecommendation = {
      ...intent.recommendation, agentId: alternative.route.harnessId,
      agentName: definition.displayName, model: alternative.route.model,
      agentSelection: 'auto'
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
