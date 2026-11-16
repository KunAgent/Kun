import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { Room } from '../../contracts/rooms.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../../contracts/room-runs.js'
import type { WorkboardHostSnapshot, WorkboardSession } from '@kun/remote-protocol'
import { isRemoteCodeAllowed } from '../code/access.js'
import { contextGeneration } from '../../agents/agent-lifecycle-state.js'
import { currentAgentConversation } from '../../agents/agent-conversations.js'

const LIMIT = 200
const valid = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id)
const timestamp = (value: string | undefined, fallback: number) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : fallback

/** Only durable metadata is projected; no session item history or message text is loaded. */
export async function workboardSnapshot(runtime: ServerRuntime, now = Date.now()): Promise<WorkboardHostSnapshot> {
  const sessions: WorkboardSession[] = []
  let complete = true
  const summaries = await runtime.threadService.list({ includeArchived: false, includeSide: false, limit: 1001 })
  if (summaries.length >= 1000) complete = false
  for (const summary of summaries.slice(0, 1000)) {
    if (!await isRemoteCodeAllowed(runtime, summary)) continue
    const thread = await runtime.threadService.getMetadata(summary.id)
    if (!thread || !valid(thread.id) || !await isRemoteCodeAllowed(runtime, thread)) continue
    const turn = [...thread.turns].reverse().find(turn => ['running', 'queued'].includes(turn.status)) ?? thread.turns.at(-1)
    if (!turn || !valid(turn.id)) continue
    const active = ['running', 'queued'].includes(turn.status) || thread.goal?.status === 'active'
    const updatedAt = timestamp(turn.finishedAt ?? turn.startedAt ?? thread.updatedAt, now)
    if (!active && turn.status !== 'failed' && updatedAt < now - 600000) continue
    const approval = runtime.approvalGate.pending(thread.id).some(gate => gate.turnId === turn.id) && turn.approvalReviewer !== 'agent'
    const input = runtime.userInputGate.pending(thread.id).some(gate => gate.turnId === turn.id)
    const phase = turn.status === 'failed' ? 'failed' : active ? approval ? 'approval' : input ? 'input' : 'running' :
      turn.status === 'completed' ? 'completed' : 'stopped'
    sessions.push({ id: thread.id, kind: 'code', runId: turn.id, phase, updatedAt })
  }
  if (runtime.rooms) {
    const rooms = runtime.rooms
    const conversations = await rooms.deps.store.list<Room>('room', { limit: 201 })
    if (conversations.length > 200) complete = false
    for (const row of conversations.slice(0, 200)) {
      const room = row.value
      if (room.conversationKind !== 'user_agent' || room.deletedAt) continue
      const agentId = room.members[0]?.participantAgentId
      if (!agentId || !valid(agentId)) continue
      const agent = await rooms.agents.active(agentId).catch(() => null)
      if (!agent || (await currentAgentConversation(rooms.agents, agentId))?.id !== room.id) continue
      const rows = await rooms.deps.store.list<RoomRequestState>('request', { roomId: room.id, order: 'desc', limit: 201 })
      if (rows.length > 200) complete = false
      const visible = rows.filter(value => value.value.privateProtocol && !value.value.steer &&
        (contextGeneration(value.value.roomSnapshot) === contextGeneration(room) || value.value.cancellationRequested))
      const request = visible.find(value => value.value.status === 'recovery_required') ??
        visible.find(value => ['running', 'stopping'].includes(value.value.status)) ??
        [...visible].reverse().find(value => value.value.status === 'pending') ?? visible[0]
      if (!request || !valid(request.id)) continue
      const value = request.value
      const active = ['running', 'pending', 'stopping'].includes(value.status)
      const updatedAt = timestamp(value.roomSnapshot.updatedAt, now)
      // For terminal requests use their durable row timestamp, not a new poll time.
      const run = value.privateRunId ? await rooms.deps.store.get<RoomRunRecord>('room_run', value.privateRunId) : null
      const endedAt = timestamp(run?.value.endedAt, updatedAt)
      if (!active && !['recovery_required', 'failed'].includes(value.status) && endedAt < now - 600000) continue
      const gates = rooms.deps.approvals.pending(value.threadId).filter(gate => !value.turnId || gate.turnId === value.turnId)
      const gateThread = gates.length ? await runtime.threadService.getMetadata(value.threadId) : null
      const approval = gates.some(gate => gateThread?.turns.find(turn => turn.id === gate.turnId)?.approvalReviewer !== 'agent')
      const input = rooms.deps.inputs.pending(value.threadId).some(gate => !value.turnId || gate.turnId === value.turnId)
      const phase = value.status === 'recovery_required' ? 'failed' : active ? approval ? 'approval' : input ? 'input' : 'running' :
        value.status === 'failed' && value.failureAcknowledgedRevision === undefined ? 'failed' : value.status === 'completed' ? 'completed' : 'stopped'
      sessions.push({ id: agentId, kind: 'agent', runId: request.id, phase, updatedAt: active ? updatedAt : endedAt })
    }
  }
  // An incomplete inventory must never be interpreted as "all finished".
  if (sessions.length > LIMIT) complete = false
  sessions.sort((a, b) => Number(['completed', 'stopped'].includes(a.phase)) - Number(['completed', 'stopped'].includes(b.phase)) || b.updatedAt - a.updatedAt)
  const unique = [...new Map(sessions.map(session => [session.kind + ':' + session.id, session])).values()]
  const result: WorkboardHostSnapshot = { schemaVersion: 1, observedAt: now, complete, sessions: unique.slice(0, LIMIT) }
  // Leave space for JSONB's whitespace and the publisher envelope at the API boundary.
  while (Buffer.byteLength(JSON.stringify(result)) > 56000) { result.sessions.pop(); result.complete = false }
  return result
}
