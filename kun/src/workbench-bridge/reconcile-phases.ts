import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { ThreadRecord } from '../contracts/threads.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import type { WorkbenchBridge } from './bridge.js'
import { buildTaskPlanPrompt, executionMode, validateExecution } from './execution.js'
import { workbenchTurnSource } from './turn-source.js'
import { updateWorkbenchLink } from './link-store.js'

export const buildTurnKey = (linkId: string) => `workbench-build-${linkId}`

async function failBuild(bridge: WorkbenchBridge, link: WorkbenchLink, error: string): Promise<void> {
  const wakes = (link.origin.kind === 'tool' || link.origin.kind === 'series') &&
    (link.request.report === 'final' || link.request.report === 'failure')
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'failed', error,
    ...(wakes ? { reported: false } : {}) }))
  if (wakes) bridge.reportPending.add(link.id)
}

export async function finishPlanPhase(bridge: WorkbenchBridge, link: WorkbenchLink, thread: ThreadRecord): Promise<boolean> {
  if (link.phase !== 'plan' || !link.planPath) return false
  try { await access(join(thread.workspace, link.planPath)) } catch {
    await failBuild(bridge, link, 'The planning turn did not save a plan.')
    return true
  }
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => executionMode(link.request) === 'auto'
    ? { status: 'queued', phase: 'build', turnId: undefined, clientRequestId: buildTurnKey(link.id), admissionAttempted: false }
    : { status: 'plan_ready' })
  return true
}

export async function admitBuildPhase(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<void> {
  try {
    const scope = await bridge.agentScope(link.participantAgentId)
    if (scope.policy.code === 'off') throw new Error('This Agent is no longer allowed to start Code tasks.')
    await validateExecution(bridge, link.roomId, link.request)
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
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ turnId: existing.id, status: existing.status === 'running' ? 'running' : 'queued' }))
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
  const model = link.request.execution?.model ?? bridge.deps.model()
  let source: Awaited<ReturnType<typeof workbenchTurnSource>>
  try { source = await workbenchTurnSource(bridge, link) } catch (error) {
    await failBuild(bridge, link, error instanceof Error ? error.message : String(error))
    return
  }
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ admissionAttempted: true, clientRequestId: key }))
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
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ turnId: admitted.turnId, status: 'queued' }))
}
