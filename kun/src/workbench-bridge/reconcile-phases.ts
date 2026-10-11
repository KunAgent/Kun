import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { ThreadRecord } from '../contracts/threads.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import type { WorkbenchBridge } from './bridge.js'
import { buildTaskPlanPrompt, executionMode, validateExecution } from './execution.js'
import { workbenchTurnSource } from './turn-source.js'
import { updateWorkbenchLink } from './link-store.js'
import { claimWorkbenchAdmission, reconcileWorkbenchCancellation, recordWorkbenchAdmission } from './task-admission.js'

export const buildTurnKey = (linkId: string) => `workbench-build-${linkId}`

async function failBuild(bridge: WorkbenchBridge, link: WorkbenchLink, error: string): Promise<void> {
  const wakes = (link.origin.kind === 'tool' || link.origin.kind === 'series') &&
    (link.request.report === 'final' || link.request.report === 'failure')
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => current.cancelRequested ? null :
    ({ status: 'failed', error, ...(wakes ? { reported: false } : {}) }))
  if (wakes) bridge.reportPending.add(link.id)
}

export async function finishPlanPhase(bridge: WorkbenchBridge, link: WorkbenchLink, thread: ThreadRecord): Promise<boolean> {
  if (link.phase !== 'plan' || !link.planPath) return false
  try { await access(join(thread.workspace, link.planPath)) } catch {
    await failBuild(bridge, link, 'The planning turn did not save a plan.')
    return true
  }
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => current.cancelRequested ? null : executionMode(link.request) === 'auto'
    ? { status: 'queued', phase: 'build', turnId: undefined, clientRequestId: buildTurnKey(link.id), admissionAttempted: false }
    : { status: 'plan_ready' })
  return true
}

export async function admitBuildPhase(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<void> {
  if (await reconcileWorkbenchCancellation(bridge, link)) return
  try {
    const scope = await bridge.agentScope(link.participantAgentId)
    if (scope.policy.code === 'off') throw new Error('This Agent is no longer allowed to start Code tasks.')
    await validateExecution(bridge, link.roomId, link.request, true)
  } catch (error) {
    await failBuild(bridge, link, error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000))
    return
  }
  const thread = link.threadId ? await bridge.deps.threads.getMetadata(link.threadId) : null
  if (!thread || !link.planPath) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'failed', error: 'The plan session is unavailable.' }))
    return
  }
  const key = buildTurnKey(link.id)
  const existing = thread.turns.find((turn) => turn.clientRequestId === key)
  if (existing) {
    await recordWorkbenchAdmission(bridge, link, key, existing.id)
    return
  }
  if (link.admissionAttempted) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'recovery_required',
      error: 'The build may have started. Check the Code session before retrying.' }))
    return
  }
  let prompt: string
  try { prompt = await buildTaskPlanPrompt(thread.workspace, link.planPath,
    link.request.execution?.orchestration ?? 'direct') } catch {
    await failBuild(bridge, link, 'The saved plan is unavailable.')
    return
  }
  const ceiling = await bridge.permissionCeiling(link.roomId, thread)
  if (ceiling) await bridge.deps.threads.update(thread.id, ceiling)
  const model = link.request.execution?.model ?? bridge.deps.model()
  let source: Awaited<ReturnType<typeof workbenchTurnSource>>
  try { source = await workbenchTurnSource(bridge, link) } catch (error) {
    await failBuild(bridge, link, error instanceof Error ? error.message : String(error))
    return
  }
  if (!await claimWorkbenchAdmission(bridge, link, key)) return
  const admitted = await bridge.deps.turns.enqueueTurn({ threadId: thread.id, request: {
    prompt, displayText: `Build plan: ${link.planPath}`, clientRequestId: key,
    model: model.model, ...(model.providerId ? { providerId: model.providerId } : {}), ...(model.accountId ? { accountId: model.accountId } : {}),
    ...(link.request.execution?.model?.harnessId ? { harnessId: link.request.execution.model.harnessId } : {}),
    ...(link.request.execution?.model?.credentialMode ? { credentialMode: link.request.execution.model.credentialMode } : {}),
    ...(link.request.execution?.model?.reasoningEffort ? { reasoningEffort: link.request.execution.model.reasoningEffort } : {}),
    ...(link.request.execution?.model?.serviceTier ? { serviceTier: link.request.execution.model.serviceTier } : {}),
    ...(link.request.execution?.persona ? { persona: link.request.execution.persona.text } : {}),
    ...source, agentSurface: 'code', mode: 'agent', orchestration: link.request.execution?.orchestration ?? 'direct',
    attachmentIds: [], composerContexts: [], fileReferences: [], enqueueIfBusy: true
  } })
  await recordWorkbenchAdmission(bridge, link, key, admitted.turnId)
}
