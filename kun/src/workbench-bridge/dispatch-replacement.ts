import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { WorkbenchRequestSchema, type WorkbenchLink } from '../contracts/workbench-links.js'
import type { AgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'
import type { WorkbenchBridge } from './bridge.js'
import { updateWorkbenchLink } from './link-store.js'
import { pathWithin } from './directory.js'

const run = promisify(execFile)

/** The committed intent is the recovery record; never consume the previous generation's target. */
export async function projectWorkbenchReplacement(bridge: WorkbenchBridge, intent: AgentDispatchIntent,
  link: WorkbenchLink): Promise<WorkbenchLink> {
  if (intent.replacementCount <= (link.dispatchReplacementCount ?? 0)) return link
  const request = WorkbenchRequestSchema.parse(intent.payload.request)
  const projected = await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => {
    if (intent.replacementCount <= (current.dispatchReplacementCount ?? 0) || current.cancelRequested || current.userTookOver) return null
    if (current.dispatchIntentId !== intent.intentId || current.origin.kind !== 'tool' ||
      current.origin.turnId !== intent.source.turnId || current.origin.toolCallId !== intent.source.toolCallId) {
      throw new Error('Dispatch replacement source binding changed')
    }
    return { status: 'awaiting_confirmation', request,
      threadId: undefined, turnId: undefined, taskWorkspaceId: undefined, clientRequestId: undefined,
      admissionAttempted: false, reported: undefined, outcomeRequestId: undefined, result: undefined, error: undefined,
      finishedAt: undefined, confirmedAt: undefined, attention: undefined, activity: undefined,
      dispatchReplacementCount: intent.replacementCount, dispatchReplacementReason: intent.replacementReason?.slice(0, 2000) }
  })
  bridge.reportPending.delete(link.id)
  return projected
}

/** One host-selected retry, after the old execution is proved stopped and its changes are inspected. */
export async function replaceFailedWorkbenchDispatch(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<boolean> {
  const service = bridge.agentDispatch
  const intent = link.dispatchIntentId && await service?.get(link.dispatchIntentId)
  if (!service || !intent || intent.recommendation.agentSelection !== 'auto' || intent.replacementCount !== 0 ||
    intent.cancellationRequested || intent.takenOver || link.cancelRequested || link.userTookOver ||
    link.dispatchReplacementCount || link.request.schedule || link.request.execution?.mode !== 'direct' || !bridge.harnesses) return false
  const thread = link.threadId ? await bridge.deps.threads.getMetadata(link.threadId) : null
  if (link.threadId) {
    if (!thread || !bridge.deps.proveStopped || !await bridge.deps.proveStopped(link.threadId, link.turnId)) return false
    if (thread.turns.some((turn) => turn.status === 'running' || turn.status === 'queued')) return false
  } else if (link.admissionAttempted) return false
  const workspace = thread?.workspace ?? link.request.workspaceRoot
  if (!workspace) return false
  // Keep every existing edit. A failed inspection cannot authorize a retry.
  let changes: string
  try {
    const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: workspace, timeout: 5000, maxBuffer: 128_000 })
    const diff = await run('git', ['diff', '--stat'], { cwd: workspace, timeout: 5000, maxBuffer: 128_000 })
    for (const path of link.result?.changedFiles ?? []) {
      const file = resolve(workspace, path)
      if (!pathWithin(workspace, file)) return false
      await stat(file)
    }
    changes = [status.stdout.trim(), diff.stdout.trim()].filter(Boolean).join('\n').slice(0, 4000) || 'No working-tree changes.'
  } catch { return false }
  // Creating a fresh isolated checkout would omit the first Agent's edits.
  // Preserve that worktree for inspection instead of retrying from a stale base.
  if (link.taskWorkspaceId && changes !== 'No working-tree changes.') return false
  const candidates = await bridge.harnesses.list(undefined, link.dispatchCapabilities).catch(() => null)
  const alternative = candidates?.agents.find((agent) => agent.available && agent.harnessId !== intent.recommendation.agentId && agent.models.length)
  const model = alternative?.models[0]
  if (!alternative || !model) return false
  const request = { ...link.request, goal: link.request.goal.slice(0, 3500) + '\n\n' +
    'The prior Agent failed after its execution stopped. Inspect and preserve its existing changes before continuing:\n' + changes,
    execution: { ...link.request.execution!, model } }
  const reason = `Replaced ${intent.recommendation.agentId} with ${alternative.displayName} after verified stop and working-tree inspection. ` +
    (link.error ?? 'The prior task failed.')
  try {
    // The old result is settled before the shared decision is reset. Retrying
    // keeps the card identity but gives the scheduler a distinct admission key.
    await service.updateTarget(intent.intentId, { state: 'failed', error: link.error })
    const replacement = await service.replace(intent.intentId, { expectedRevision: (await service.get(intent.intentId))!.revision,
      recommendation: { ...intent.recommendation, agentId: alternative.harnessId, agentName: alternative.displayName,
        model: model.model, task: request.goal }, payload: { ...intent.payload, request }, reason })
    bridge.reportPending.delete(link.id)
    // Admission and restart reconciliation use the same idempotent projection.
    // A slower caller must not reset a replacement already admitted by the reviewer.
    await projectWorkbenchReplacement(bridge, replacement, link).catch((error) => {
      console.warn('[kun] workbench replacement projection:', error instanceof Error ? error.message : String(error))
    })
    bridge.wake()
    return true
  } catch { return false }
}
