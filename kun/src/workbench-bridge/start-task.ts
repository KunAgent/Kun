import { agentStableId } from '../agents/agent-identity-service.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { TurnConflictError, ThreadClosingError } from '../services/turn-service.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import { WorkbenchBridge } from './bridge.js'
import { workbenchTurnSource } from './turn-source.js'
import { updateWorkbenchLink } from './link-store.js'
import { executionMode, planRelativePath, validateExecution } from './execution.js'
import { effectiveDispatchAuthority } from './dispatch-authority.js'
import { narrowWorkbenchCapabilities } from './dispatch-capabilities.js'

/** Deterministic identities: a retry after a crash reaches the same thread and the same turn. */
export const workbenchThreadId = (linkId: string, replacementCount = 0) => replacementCount
  ? agentStableId('workbench-thread', linkId, 'replacement', String(replacementCount)) : agentStableId('workbench-thread', linkId)
export const workbenchTurnKey = (linkId: string) => 'workbench-' + linkId

const fail = async (bridge: WorkbenchBridge, link: WorkbenchLink, error: string) => {
  const wakes = (link.origin.kind === 'tool' || link.origin.kind === 'series') &&
    (link.request.report === 'final' || link.request.report === 'failure')
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'failed', error: error.slice(0, 2000),
    ...(wakes ? { reported: false } : {}) }))
  if (wakes) bridge.reportPending.add(link.id)
}

/** First turn of a handed-over task, built by the host from the card the user accepted. */
export function taskPrompt(link: WorkbenchLink, agentName: string): string {
  const request = link.request
  return [
    request.goal || request.title,
    request.acceptance ? `Acceptance criteria:\n${request.acceptance}` : '',
    request.relativePath ? `Document in focus: ${request.relativePath}` : '',
    `This task was handed over by the user's assistant${agentName ? ` "${agentName}"` : ''} and authorized under the initiating conversation's permissions. ` +
      'Work on it as you normally would, keep the user informed through your normal replies, and finish with a clear summary of what changed and any caveats.'
  ].filter(Boolean).join('\n\n')
}

/**
 * Starts (or resumes starting) an accepted Code/Work task: create the target
 * thread, wait for an isolated worktree when asked, then admit the first turn.
 * Every step is idempotent, so a restart continues where the last tick stopped.
 */
export async function startTaskLink(bridge: WorkbenchBridge, row: RoomStoredDocument<WorkbenchLink>): Promise<void> {
  let link = row.value
  if (link.dispatchIntentId && bridge.agentDispatch) {
    const intent = await bridge.agentDispatch.get(link.dispatchIntentId)
    if (!intent || intent.cancellationRequested || intent.takenOver || intent.state === 'cancelled') {
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'cancelled', cancelRequested: true }))
      return
    }
    if (['pending_confirmation', 'reviewing', 'countdown', 'paused', 'failed'].includes(intent.state)) return
    const source = await bridge.deps.threadStore.getMetadata?.(intent.source.threadId) ?? await bridge.deps.threadStore.get(intent.source.threadId)
    const sourceTurn = source?.turns.find((turn) => turn.id === intent.source.turnId)
    if (!sourceTurn || sourceTurn.status === 'aborted') return void await fail(bridge, link, 'The initiating request was stopped before the task started.')
  }
  const root = link.request.workspaceRoot
  if (!root) return void await fail(bridge, link, 'The task has no project directory.')
  let scope
  try { scope = await bridge.agentScope(link.participantAgentId) } catch (error) {
    return void await fail(bridge, link, error instanceof Error ? error.message : String(error))
  }
  const code = link.surface === 'code'
  if ((code ? scope.policy.code === 'off' : scope.policy.work === 'off' || scope.policy.work === 'read')) {
    return void await fail(bridge, link, 'This Agent is no longer allowed to start tasks here.')
  }
  if (!link.threadId) {
    const occupied = (await bridge.store.list<WorkbenchLink>('workbench_link', {
      participantAgentId: link.participantAgentId, status: ['queued', 'running', 'needs_attention', 'recovery_required'], limit: 100
    })).filter((row) => row.id !== link.id && Boolean(row.value.threadId)).length
    if (occupied >= scope.policy.maxActiveTasks) return
  }
  const directory = await bridge.resolveDirectory(root)
  if (!directory) return void await fail(bridge, link, 'The project directory is no longer available.')
  if (!WorkbenchBridge.withinAgentLimits(scope, directory)) return void await fail(bridge, link, 'The project is outside this Agent’s allowed directories.')
  if (link.dispatchAuthority) {
    try {
      const authority = await effectiveDispatchAuthority(bridge, link.roomId, link.memberId, link.dispatchAuthority)
      if (JSON.stringify(authority) !== JSON.stringify(link.dispatchAuthority)) {
        await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ dispatchAuthority: authority }))
        link = { ...link, dispatchAuthority: authority }
      }
    } catch (error) { return void await fail(bridge, link, error instanceof Error ? error.message : String(error)) }
  }
  if (link.dispatchIntentId) {
    const capabilities = await narrowWorkbenchCapabilities(bridge, link.roomId, link.memberId, link.dispatchCapabilities)
    if (JSON.stringify(capabilities) !== JSON.stringify(link.dispatchCapabilities)) {
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ dispatchCapabilities: capabilities }))
      link = { ...link, dispatchCapabilities: capabilities }
    }
  }
  try {
    const request = await validateExecution(bridge, link.roomId, link.request, code)
    if (code) bridge.harnesses?.assertCapabilityCeiling(request, link.dispatchCapabilities)
    if (JSON.stringify(request) !== JSON.stringify(link.request)) {
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ request }))
      link = { ...link, request }
    }
  } catch (error) {
    return void await fail(bridge, link, error instanceof Error ? error.message : String(error))
  }
  const threadId = link.threadId ?? workbenchThreadId(link.id, link.dispatchReplacementCount)
  let thread = await bridge.deps.threads.getMetadata(threadId)
  if (!thread) {
    const model = link.request.execution?.model ?? bridge.deps.model()
    const permission = link.request.execution?.permission
    thread = await bridge.deps.threads.create({
      title: link.request.title, titleAuto: false, workspace: directory, model: model.model,
      ...(model.providerId ? { providerId: model.providerId } : {}), ...(model.accountId ? { accountId: model.accountId } : {}),
      ...(link.request.execution?.model?.harnessId ? { harnessId: link.request.execution.model.harnessId } : {}),
      ...(link.request.execution?.model?.credentialMode ? { credentialMode: link.request.execution.model.credentialMode } : {}),
      ...(code ? { collaboration: { enabled: false } } : {}),
      ...(link.dispatchAuthority ?? (permission ? kunToolPermissionModeSettings(permission) : {})),
      agentSurface: code ? 'code' : 'write', mode: executionMode(link.request) === 'plan' || executionMode(link.request) === 'auto' ? 'plan' : 'agent'
    }, { id: threadId, workbenchOrigin: { kind: 'bot', roomId: link.roomId, linkId: link.id,
      agentId: link.participantAgentId, agentName: scope.name, ...(link.messageId ? { messageId: link.messageId } : {}),
      ...(link.dispatchCapabilities ? { capabilityCeiling: link.dispatchCapabilities } : {}) } })
    const ceiling = await bridge.permissionCeiling(link.roomId, thread)
    if (ceiling) thread = await bridge.deps.threads.update(thread.id, ceiling)
  }
  if (link.threadId !== thread.id) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ threadId: thread!.id }))
    return
  }
  if (code && link.request.isolation === 'worktree' && !thread.taskWorkspaceId) {
    if (!await isolateInWorktree(bridge, link, thread, directory)) return
    thread = await bridge.deps.threads.getMetadata(thread.id) ?? thread
  }
  if (executionMode(link.request) === 'goal' && !thread.goal) {
    try { await bridge.deps.threads.setGoal(thread.id, { objective: link.request.goal,
      tokenBudget: link.request.execution?.goalTokenBudget ?? null }) } catch (error) {
      return void await fail(bridge, link, error instanceof Error ? error.message : String(error))
    }
  }
  const ceiling = await bridge.permissionCeiling(link.roomId, thread)
  if (link.dispatchCapabilities && JSON.stringify(thread.workbenchOrigin?.capabilityCeiling) !== JSON.stringify(link.dispatchCapabilities)) {
    thread = await bridge.deps.threads.update(thread.id, { workbenchOrigin: { ...thread.workbenchOrigin!, capabilityCeiling: link.dispatchCapabilities } })
  }
  if (link.dispatchAuthority) thread = await bridge.deps.threads.update(thread.id, link.dispatchAuthority)
  else if (ceiling) thread = await bridge.deps.threads.update(thread.id, ceiling)
  await admitFirstTurn(bridge, link, thread, scope.name)
}

/** Returns true once the thread is bound to a ready worktree; false while waiting or after failing the link. */
async function isolateInWorktree(bridge: WorkbenchBridge, link: WorkbenchLink, thread: ThreadRecord, directory: string): Promise<boolean> {
  const workspaces = bridge.taskWorkspaces
  if (!workspaces) { await fail(bridge, link, 'Isolated worktrees are unavailable in this runtime.'); return false }
  if (!link.taskWorkspaceId) {
    const record = workspaces.create({ ownerThreadId: thread.id, sourceRoot: directory, isolation: 'worktree', label: link.request.title.slice(0, 120),
      startFrom: { kind: 'default-branch' } })
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ taskWorkspaceId: record.workspaceId }))
    return false
  }
  const record = workspaces.get(link.taskWorkspaceId)
  if (!record) { await fail(bridge, link, 'The isolated worktree was removed before the task could start.'); return false }
  if (record.state === 'failed') { await fail(bridge, link, record.lastError ?? 'Creating the isolated worktree failed.'); return false }
  if (record.state !== 'ready') return false
  await bridge.deps.threads.update(thread.id, { taskWorkspaceId: record.workspaceId, workspace: record.path })
  return true
}

async function admitFirstTurn(bridge: WorkbenchBridge, link: WorkbenchLink, thread: ThreadRecord, agentName: string): Promise<void> {
  const clientRequestId = link.clientRequestId ?? workbenchTurnKey(link.id)
  const existing = thread.turns.find((turn) => turn.clientRequestId === clientRequestId)
  if (existing) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ turnId: existing.id, clientRequestId,
      status: existing.status === 'running' ? 'running' : 'queued' }))
    return
  }
  if (link.admissionAttempted) {
    // An earlier enqueue lost its receipt. Never allocate another turn for it.
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'recovery_required',
      error: 'The task may have started but its session was not found. Open Code to check before retrying.' }))
    return
  }
  const mode = executionMode(link.request)
  const planPath = mode === 'plan' || mode === 'auto' ? link.planPath ?? planRelativePath(link) : undefined
  if (planPath && !link.planPath) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ planPath, phase: 'plan' }))
  }
  let source: Awaited<ReturnType<typeof workbenchTurnSource>>
  try { source = await workbenchTurnSource(bridge, link) } catch (error) {
    await fail(bridge, link, error instanceof Error ? error.message : String(error))
    return
  }
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ admissionAttempted: true, clientRequestId }))
  const model = link.request.execution?.model ?? bridge.deps.model()
  try {
    const admitted = await bridge.deps.turns.enqueueTurn({ threadId: thread.id, request: {
      prompt: taskPrompt(link, agentName), displayText: link.request.title.slice(0, 8000), clientRequestId,
      model: model.model, ...(model.providerId ? { providerId: model.providerId } : {}), ...(model.accountId ? { accountId: model.accountId } : {}),
      ...(link.request.execution?.model?.harnessId ? { harnessId: link.request.execution.model.harnessId } : {}),
      ...(link.request.execution?.model?.credentialMode ? { credentialMode: link.request.execution.model.credentialMode } : {}),
      ...(link.request.execution?.model?.reasoningEffort ? { reasoningEffort: link.request.execution.model.reasoningEffort } : {}),
      ...(link.request.execution?.model?.serviceTier ? { serviceTier: link.request.execution.model.serviceTier } : {}),
      ...(link.request.execution?.persona ? { persona: link.request.execution.persona.text } : {}),
      ...source, agentSurface: link.surface === 'code' ? 'code' : 'write', mode: mode === 'plan' || mode === 'auto' ? 'plan' : 'agent',
      ...(link.dispatchAuthority ?? {}),
      ...(planPath ? { guiPlan: { operation: 'draft' as const, fixedPath: true, workspaceRoot: thread.workspace, relativePath: planPath,
        planId: `${thread.workspace}:${planPath}`, sourceRequest: link.request.goal, title: link.request.title } } : {}),
      orchestration: link.request.execution?.orchestration ?? 'direct', attachmentIds: [], composerContexts: [], fileReferences: [], enqueueIfBusy: true } })
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ turnId: admitted.turnId, status: 'queued' }))
  } catch (error) {
    const known = error instanceof TurnConflictError || error instanceof ThreadClosingError
    if (known) await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'failed', admissionAttempted: false,
      error: (error as Error).message.slice(0, 2000) }))
    // Otherwise leave admissionAttempted set: the next tick reconciles this exact admission.
  }
}
