import type { AgentIdentity } from '../contracts/agent-identities.js'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import {
  ConfirmWorkbenchLinkSchema, ResolveWorkbenchLinkSchema, WatchWorkbenchThreadSchema, WORKBENCH_ACTIVE_STATUSES,
  isWorkbenchTerminal, type WorkbenchLink, type WorkbenchLinkEntry
} from '../contracts/workbench-links.js'
import { interactionFingerprint, interactionId, interactionReplay, interactionRoom } from '../rooms/room-interaction-store.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import type { WorkbenchBridge } from './bridge.js'
import { countActiveLinks, createWorkbenchLink, readWorkbenchLink, updateWorkbenchLink } from './link-store.js'

const LONG_RUNNING = ['code_task', 'work_task'] as const

/** Replays an identical decision, and otherwise applies `update` under the caller's revision. */
async function decide(bridge: WorkbenchBridge, roomId: string, linkId: string, verb: string,
  input: { clientRequestId: string; expectedRevision: number },
  update: Parameters<typeof updateWorkbenchLink>[3]): Promise<WorkbenchLinkEntry> {
  const receipt = interactionId('workbench-' + verb, roomId, linkId, input.clientRequestId)
  const fingerprint = interactionFingerprint({ roomId, linkId, verb, ...input })
  const replay = await interactionReplay<WorkbenchLinkEntry>(bridge.store, receipt, fingerprint)
  if (replay) return replay
  return updateWorkbenchLink(bridge.store, roomId, linkId, update,
    { expectedRevision: input.expectedRevision, requestId: receipt, fingerprint })
}

/**
 * The user accepts a card. Only this route (never an Agent tool) moves a
 * proposal to `queued`; the reconciler then performs the real work.
 */
export async function confirmWorkbenchLink(bridge: WorkbenchBridge, roomId: string, linkId: string, raw: unknown) {
  const input = ConfirmWorkbenchLinkSchema.parse(raw)
  const link = await readWorkbenchLink(bridge.store, roomId, linkId)
  if (link.status === 'awaiting_confirmation' && (LONG_RUNNING as readonly string[]).includes(link.kind)) {
    const scope = await bridge.agentScope(link.participantAgentId)
    if (await countActiveLinks(bridge.store, roomId, link.participantAgentId) >= scope.policy.maxActiveTasks) {
      throw new RoomStoreConflictError(`This Agent already has ${scope.policy.maxActiveTasks} tasks in progress`)
    }
  }
  const result = await decide(bridge, roomId, linkId, 'confirm', input, (current) => {
    if (current.status !== 'awaiting_confirmation') throw new RoomStoreConflictError('task is not waiting for confirmation', current.revision)
    return { status: 'queued', confirmedAt: new Date().toISOString(), request: { ...current.request, ...input.edits } }
  })
  bridge.wake()
  return result
}

export async function dismissWorkbenchLink(bridge: WorkbenchBridge, roomId: string, linkId: string, raw: unknown) {
  const input = ResolveWorkbenchLinkSchema.parse(raw)
  return decide(bridge, roomId, linkId, 'dismiss', input, (current) => {
    if (current.status !== 'awaiting_confirmation') throw new RoomStoreConflictError('task is not waiting for confirmation', current.revision)
    return { status: 'dismissed' }
  })
}

/**
 * Stops a task. A card that never started is closed at once; a running task has
 * its turn interrupted and the reconciler records the outcome it actually had.
 */
export async function requestWorkbenchCancel(bridge: WorkbenchBridge, roomId: string, linkId: string,
  decision?: { clientRequestId: string; expectedRevision: number }): Promise<WorkbenchLinkEntry> {
  const link = await readWorkbenchLink(bridge.store, roomId, linkId)
  if (isWorkbenchTerminal(link.status)) throw new RoomStoreConflictError('task already ended', link.revision)
  if (link.kind === 'watch') {
    return updateWorkbenchLink(bridge.store, roomId, linkId, () => ({ status: 'cancelled' }), decision ? { expectedRevision: decision.expectedRevision } : {})
  }
  if (link.status === 'awaiting_confirmation' || (link.status === 'queued' && !link.threadId)) {
    return updateWorkbenchLink(bridge.store, roomId, linkId,
      (current) => ({ status: current.status === 'awaiting_confirmation' ? 'dismissed' : 'cancelled', cancelRequested: true }),
      decision ? { expectedRevision: decision.expectedRevision } : {})
  }
  if (link.taskWorkspaceId && bridge.taskWorkspaces) {
    try { bridge.taskWorkspaces.cancel(link.taskWorkspaceId) } catch { /* not creating any more */ }
  }
  if (link.threadId) {
    const thread = await bridge.deps.threads.getMetadata(link.threadId)
    const turn = thread?.turns.find((item) => item.id === link.turnId || (link.clientRequestId && item.clientRequestId === link.clientRequestId))
    if (turn?.status === 'running') await bridge.deps.turns.interruptTurn({ threadId: link.threadId, turnId: turn.id })
    else if (turn?.status === 'queued') await bridge.deps.turns.cancelQueuedTurn({ threadId: link.threadId, turnId: turn.id })
  }
  const marked = await updateWorkbenchLink(bridge.store, roomId, linkId,
    (current) => current.cancelRequested ? null : { cancelRequested: true },
    decision ? { expectedRevision: decision.expectedRevision } : {})
  bridge.wake()
  return marked
}

/** "Tell me when this session finishes": a user action, so it needs no Agent policy or card confirmation. */
export async function watchWorkbenchThread(bridge: WorkbenchBridge, roomId: string, raw: unknown): Promise<WorkbenchLinkEntry> {
  const input = WatchWorkbenchThreadSchema.parse(raw)
  const room = await interactionRoom(bridge.store, roomId)
  if (room.value.conversationKind !== 'user_agent') throw new RoomStoreConflictError('watching requires a private Agent conversation')
  const member = room.value.members.find((item) => item.id === room.value.defaultMemberId)
  if (!member?.participantAgentId || !member.enabled || member.removedAt) throw new RoomStoreConflictError('the Agent is unavailable')
  const agent = (await bridge.store.get<AgentIdentity>('agent_identity', member.participantAgentId))?.value
  if (!agent || agent.archivedAt) throw new RoomStoreConflictError('the Agent is unavailable')
  const thread = await bridge.deps.threads.getMetadata(input.threadId)
  if (!thread || thread.roomContext || thread.status === 'deleted') throw new Error('thread not found')
  const surface = resolveThreadAgentSurface(thread)
  if (surface !== 'code' && surface !== 'write') throw new RoomStoreConflictError('only Code and Work sessions can be watched')
  const active = [...thread.turns].reverse().find((turn) => turn.status === 'running' || turn.status === 'queued')
  if (!active) throw new RoomStoreConflictError('the session is not running')
  const watching = (await bridge.store.list<WorkbenchLink>('workbench_link', { roomId, threadId: thread.id,
    status: [...WORKBENCH_ACTIVE_STATUSES], limit: 10 })).find((row) => row.value.kind === 'watch')
  if (watching) return { ...watching.value, revision: watching.revision }
  const created = await createWorkbenchLink(bridge.store, {
    roomId, participantAgentId: agent.id, memberId: member.id, memberLabel: member.displayName,
    kind: 'watch', surface: surface === 'write' ? 'work' : 'code', status: 'running',
    origin: { kind: 'user', action: 'watch' }, clientRequestId: input.clientRequestId,
    threadId: thread.id, turnId: active.id,
    request: { title: (input.title ?? thread.title).slice(0, 160) || 'Session', goal: '', workspaceRoot: thread.workspace,
      mode: 'agent', isolation: 'inherit', report: 'final' } })
  bridge.wake()
  return created.link
}
