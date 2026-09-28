import { agentStableId } from '../agents/agent-identity-service.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { TurnConflictError, ThreadClosingError } from '../services/turn-service.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import type { WorkbenchBridge } from './bridge.js'
import { updateWorkbenchLink } from './link-store.js'

/** Deterministic identities: a retry after a crash reaches the same thread and the same turn. */
export const workbenchThreadId = (linkId: string) => agentStableId('workbench-thread', linkId)
export const workbenchTurnKey = (linkId: string) => 'workbench-' + linkId

const fail = (bridge: WorkbenchBridge, link: WorkbenchLink, error: string) =>
  updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'failed', error: error.slice(0, 2000) }))

/** First turn of a handed-over task, built by the host from the card the user accepted. */
export function taskPrompt(link: WorkbenchLink, agentName: string): string {
  const request = link.request
  return [
    request.goal || request.title,
    request.acceptance ? `Acceptance criteria:\n${request.acceptance}` : '',
    request.relativePath ? `Document in focus: ${request.relativePath}` : '',
    `This task was handed over by the user's assistant${agentName ? ` "${agentName}"` : ''} and accepted by the user. ` +
      'Work on it as you normally would, keep the user informed through your normal replies, and finish with a clear summary of what changed and any caveats.'
  ].filter(Boolean).join('\n\n')
}

/**
 * Starts (or resumes starting) an accepted Code/Work task: create the target
 * thread, wait for an isolated worktree when asked, then admit the first turn.
 * Every step is idempotent, so a restart continues where the last tick stopped.
 */
export async function startTaskLink(bridge: WorkbenchBridge, row: RoomStoredDocument<WorkbenchLink>): Promise<void> {
  const link = row.value
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
  const directory = await bridge.resolveDirectory(root)
  if (!directory) return void await fail(bridge, link, 'The project directory is no longer available.')
  const threadId = link.threadId ?? workbenchThreadId(link.id)
  let thread = await bridge.deps.threads.getMetadata(threadId)
  if (!thread) {
    const model = bridge.deps.model()
    thread = await bridge.deps.threads.create({
      title: link.request.title, titleAuto: false, workspace: directory, model: model.model,
      ...(model.providerId ? { providerId: model.providerId } : {}), ...(model.accountId ? { accountId: model.accountId } : {}),
      agentSurface: code ? 'code' : 'write', mode: link.request.mode
    }, { id: threadId, workbenchOrigin: { kind: 'bot', roomId: link.roomId, linkId: link.id,
      agentId: link.participantAgentId, agentName: scope.name, ...(link.messageId ? { messageId: link.messageId } : {}) } })
    const ceiling = await bridge.permissionCeiling(link.roomId, thread)
    if (ceiling) thread = await bridge.deps.threads.update(thread.id, ceiling)
  }
  if (link.threadId !== thread.id) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ threadId: thread!.id }))
    return
  }
  if (code && link.request.isolation === 'worktree' && !thread.taskWorkspaceId) {
    if (!await isolateInWorktree(bridge, link, thread, directory)) return
  }
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
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ admissionAttempted: true, clientRequestId }))
  const model = bridge.deps.model()
  try {
    const admitted = await bridge.deps.turns.enqueueTurn({ threadId: thread.id, request: {
      prompt: taskPrompt(link, agentName), displayText: link.request.title.slice(0, 8000), clientRequestId,
      model: model.model, ...(model.providerId ? { providerId: model.providerId } : {}), ...(model.accountId ? { accountId: model.accountId } : {}),
      clientSurface: 'gui', agentSurface: link.surface === 'code' ? 'code' : 'write', mode: link.request.mode,
      orchestration: 'direct', attachmentIds: [], composerContexts: [], fileReferences: [], enqueueIfBusy: true } })
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ turnId: admitted.turnId, status: 'queued' }))
  } catch (error) {
    const known = error instanceof TurnConflictError || error instanceof ThreadClosingError
    if (known) await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'failed', admissionAttempted: false,
      error: (error as Error).message.slice(0, 2000) }))
    // Otherwise leave admissionAttempted set: the next tick reconciles this exact admission.
  }
}

