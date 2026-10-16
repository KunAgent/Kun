import type { Room } from '../../contracts/rooms.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { AgentIdentity } from '../../contracts/agent-identities.js'
export class RemoteGroupTargetError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_A_GROUP') { super(code) }
}
/** An allowlisted projection, also used when recovering a committed native request. */
export function groupSummary(room: Room, leaders?: ReadonlySet<string>) {
  return { id: room.id, name: room.name, description: room.description, revision: room.revision,
    archived: Boolean(room.archivedAt), pinned: room.pinned, collaborationMode: room.collaborationMode,
    maxConcurrentTasks: room.maxConcurrentTasks, defaultMemberId: room.defaultMemberId,
    members: room.members.map((m) => ({ id: m.id, name: m.displayName, role: m.role, enabled: m.enabled,
      revision: m.revision, participantAgentId: m.participantAgentId, removed: Boolean(m.removedAt),
      ...(leaders ? { canLead: leaders.has(m.id) } : {}) })),
    createdAt: room.createdAt, updatedAt: room.updatedAt }
}
/** Lead eligibility is derived from the live directory, never an author-controlled member label or role. */
export async function publicGroup(runtime: ServerRuntime, room: Room) {
  const leaders = new Set<string>()
  await Promise.all(room.members.map(async (member) => {
    if (!member.participantAgentId || !member.enabled || member.removedAt) return
    const row = await runtime.rooms!.agents.store.get<AgentIdentity>('agent_identity', member.participantAgentId)
    if (row && !row.value.archivedAt && !row.value.executor) leaders.add(member.id)
  }))
  return groupSummary(room, leaders)
}
