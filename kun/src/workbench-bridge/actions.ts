import type { AgentIdentity } from '../contracts/agent-identities.js'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import {
  ConfirmWorkbenchLinkSchema, ResolveWorkbenchLinkSchema, WatchWorkbenchThreadSchema, WORKBENCH_ACTIVE_STATUSES, WORKBENCH_LIMITS,
  isWorkbenchTerminal, WorkbenchRequestSchema, type WorkbenchLink, type WorkbenchLinkEntry
} from '../contracts/workbench-links.js'
import { interactionFingerprint, interactionId, interactionReplay, interactionRoom } from '../rooms/room-interaction-store.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import type { WorkbenchBridge } from './bridge.js'
import { countActiveLinks, createWorkbenchLink, readWorkbenchLink, updateWorkbenchLink } from './link-store.js'
import { executionMode, validateExecution } from './execution.js'
import { buildTurnKey } from './reconcile-phases.js'
import { firstScheduleAt, seriesHasLiveChild } from './schedule.js'

const LONG_RUNNING = ['code_task', 'work_task'] as const

async function replayDecision(bridge: WorkbenchBridge, roomId: string, linkId: string, verb: string,
  input: { clientRequestId: string; expectedRevision: number }): Promise<WorkbenchLinkEntry | undefined> {
  return interactionReplay<WorkbenchLinkEntry>(bridge.store,
    interactionId('workbench-' + verb, roomId, linkId, input.clientRequestId),
    interactionFingerprint({ roomId, linkId, verb, ...input }))
}

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
  const replay = await replayDecision(bridge, roomId, linkId, 'confirm', input)
  if (replay) return replay
  const link = await readWorkbenchLink(bridge.store, roomId, linkId)
  const request = WorkbenchRequestSchema.parse({ ...link.request, ...input.edits })
  if (input.edits?.execution && !(LONG_RUNNING as readonly string[]).includes(link.kind)) {
    throw new RoomStoreConflictError('Execution options are only available for tasks')
  }
  if (request.schedule && !(LONG_RUNNING as readonly string[]).includes(link.kind)) throw new RoomStoreConflictError('Only tasks can be scheduled')
  if (link.surface === 'work' && (['plan', 'auto', 'goal'].includes(executionMode(request)) || request.execution?.orchestration === 'graph')) {
    throw new RoomStoreConflictError('This mode requires a Code task')
  }
  await validateExecution(bridge, roomId, request)
  const scheduledFor = request.schedule ? firstScheduleAt(request.schedule) : undefined
  if (link.status === 'awaiting_confirmation' && (LONG_RUNNING as readonly string[]).includes(link.kind) && !request.schedule) {
    const scope = await bridge.agentScope(link.participantAgentId)
    if (await countActiveLinks(bridge.store, roomId, link.participantAgentId) >= scope.policy.maxActiveTasks) {
      throw new RoomStoreConflictError(`This Agent already has ${scope.policy.maxActiveTasks} tasks in progress`)
    }
  }
  if (request.schedule) {
    const statuses = request.schedule.kind === 'once' ? ['scheduled'] : ['active', 'paused']
    const limit = request.schedule.kind === 'once' ? WORKBENCH_LIMITS.maxScheduledPerAgent : WORKBENCH_LIMITS.maxSeriesPerAgent
    const rows = await bridge.store.list<WorkbenchLink>('workbench_link', { participantAgentId: link.participantAgentId,
      status: statuses, limit })
    if (rows.length >= limit) throw new RoomStoreConflictError(`This Agent has reached the limit of ${limit} scheduled tasks`)
  }
  const result = await decide(bridge, roomId, linkId, 'confirm', input, (current) => {
    if (current.status !== 'awaiting_confirmation') throw new RoomStoreConflictError('task is not waiting for confirmation', current.revision)
    return { status: request.schedule?.kind === 'once' ? 'scheduled' : request.schedule?.kind === 'recurring' ? 'active' : 'queued',
      ...(request.schedule?.kind === 'recurring' ? { kind: 'schedule_series' as const, runCount: 0, recentRunIds: [] } : {}),
      scheduledFor, confirmedAt: new Date().toISOString(), request: request.schedule?.kind === 'recurring' && !input.edits?.report
        ? { ...request, report: 'silent' as const } : request }
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
  if (link.kind === 'schedule_series') {
    return updateWorkbenchLink(bridge.store, roomId, linkId, () => ({ status: 'ended', scheduledFor: undefined }),
      decision ? { expectedRevision: decision.expectedRevision } : {})
  }
  if (link.status === 'scheduled' || link.status === 'missed' || link.status === 'plan_ready') {
    return updateWorkbenchLink(bridge.store, roomId, linkId, () => ({ status: 'cancelled', scheduledFor: undefined, cancelRequested: true }),
      decision ? { expectedRevision: decision.expectedRevision } : {})
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

export async function updateScheduledWorkbenchLink(bridge: WorkbenchBridge, roomId: string, linkId: string, raw: unknown) {
  const input = ConfirmWorkbenchLinkSchema.parse(raw)
  const replay = await replayDecision(bridge, roomId, linkId, 'update', input)
  if (replay) return replay
  const link = await readWorkbenchLink(bridge.store, roomId, linkId)
  if (!['scheduled', 'active', 'paused'].includes(link.status)) throw new RoomStoreConflictError('task is not scheduled', link.revision)
  const request = WorkbenchRequestSchema.parse({ ...link.request, ...input.edits })
  if (!request.schedule || (link.kind === 'schedule_series') !== (request.schedule.kind === 'recurring')) {
    throw new RoomStoreConflictError('schedule kind cannot be changed')
  }
  if (link.surface === 'work' && (['plan', 'auto', 'goal'].includes(executionMode(request)) || request.execution?.orchestration === 'graph')) {
    throw new RoomStoreConflictError('This mode requires a Code task')
  }
  await validateExecution(bridge, roomId, request)
  const scheduledFor = firstScheduleAt(request.schedule)
  const result = await decide(bridge, roomId, linkId, 'update', input, (current) => {
    if (!['scheduled', 'active', 'paused'].includes(current.status)) throw new RoomStoreConflictError('task is not scheduled', current.revision)
    return { request, scheduledFor }
  })
  bridge.wake()
  return result
}

export async function runNowWorkbenchLink(bridge: WorkbenchBridge, roomId: string, linkId: string, raw: unknown) {
  const input = ResolveWorkbenchLinkSchema.parse(raw)
  const replay = await replayDecision(bridge, roomId, linkId, 'run-now', input)
  const link = replay ?? await readWorkbenchLink(bridge.store, roomId, linkId)
  if (link.kind === 'schedule_series') {
    if (!replay && !['active', 'paused'].includes(link.status)) throw new RoomStoreConflictError('series is not available', link.revision)
    if (!replay && await seriesHasLiveChild(bridge, link)) throw new RoomStoreConflictError('series already has a running task', link.revision)
    const updated = replay ?? await decide(bridge, roomId, linkId, 'run-now', input, (current) => {
      if (current.kind !== 'schedule_series' || !['active', 'paused'].includes(current.status)) {
        throw new RoomStoreConflictError('series is not available', current.revision)
      }
      const runCount = (current.runCount ?? 0) + 1
      if (current.request.schedule?.kind === 'recurring' && current.request.schedule.maxRuns &&
        runCount > current.request.schedule.maxRuns) throw new RoomStoreConflictError('series run limit reached', current.revision)
      return { runCount, ...(current.request.schedule?.kind === 'recurring' && current.request.schedule.maxRuns === runCount
        ? { status: 'ended' as const, scheduledFor: undefined } : {}) }
    })
    const occurrence = updated.runCount!
    const agent = await bridge.agentScope(updated.participantAgentId)
    const child = await createWorkbenchLink(bridge.store, { roomId, participantAgentId: updated.participantAgentId,
      memberId: updated.memberId, memberLabel: agent.name, kind: updated.surface === 'code' ? 'code_task' : 'work_task',
      surface: updated.surface, status: 'queued', origin: { kind: 'series', seriesId: updated.id, occurrence },
      seriesId: updated.id, occurrence, request: { ...updated.request, schedule: undefined } })
    await updateWorkbenchLink(bridge.store, roomId, linkId, (current) => current.recentRunIds?.includes(child.link.id) ? null :
      ({ recentRunIds: [child.link.id, ...(current.recentRunIds ?? [])].slice(0, 50) }))
    bridge.wake()
    return updated
  }
  if (replay) return replay
  const result = await decide(bridge, roomId, linkId, 'run-now', input, (current) => {
    if (current.status !== 'scheduled' && current.status !== 'missed') throw new RoomStoreConflictError('task is not scheduled', current.revision)
    return { status: 'queued', scheduledFor: undefined, error: undefined }
  })
  bridge.wake()
  return result
}

export async function setSeriesPaused(bridge: WorkbenchBridge, roomId: string, linkId: string, raw: unknown, paused: boolean) {
  const input = ResolveWorkbenchLinkSchema.parse(raw)
  const result = await decide(bridge, roomId, linkId, paused ? 'pause' : 'resume', input, (current) => {
    if (current.kind !== 'schedule_series' || current.status !== (paused ? 'active' : 'paused')) {
      throw new RoomStoreConflictError('series is not in the expected state', current.revision)
    }
    return { status: paused ? 'paused' : 'active' }
  })
  bridge.wake()
  return result
}

export async function buildWorkbenchPlan(bridge: WorkbenchBridge, roomId: string, linkId: string, raw: unknown) {
  const input = ResolveWorkbenchLinkSchema.parse(raw)
  const result = await decide(bridge, roomId, linkId, 'build', input, (current) => {
    if (current.status !== 'plan_ready' || !current.planPath || !current.threadId) {
      throw new RoomStoreConflictError('plan is not ready', current.revision)
    }
    return { status: 'queued', phase: 'build', turnId: undefined, clientRequestId: buildTurnKey(linkId), admissionAttempted: false }
  })
  bridge.wake()
  return result
}

export async function skipMissedWorkbenchLink(bridge: WorkbenchBridge, roomId: string, linkId: string, raw: unknown) {
  const input = ResolveWorkbenchLinkSchema.parse(raw)
  return decide(bridge, roomId, linkId, 'skip', input, (current) => {
    if (current.status !== 'missed') throw new RoomStoreConflictError('task was not missed', current.revision)
    return { status: 'cancelled', scheduledFor: undefined }
  })
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
