import type { AgentActivity, AgentPage } from '../contracts/agent-identities.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'

export async function agentDirectoryPage(directory: AgentIdentityService, input: unknown): Promise<AgentPage> {
  const page = await directory.list(input)
  const activities: Record<string, AgentActivity> = {}
  if (!page.agents.length) return { ...page, activities }
  const rooms = await directory.store.listRooms({ ids: page.agents.map((agent) => agentStableId('agent-direct', agent.id)),
    conversationKind: 'user_agent', limit: 100 })
  for (const agent of page.agents) {
    const room = rooms.rooms.find((entry) => entry.id === agentStableId('agent-direct', agent.id))
    const read = room ? await directory.store.get<{ seq: number }>('read_state', room.id) : null
    const runs = await directory.store.list<RoomRunRecord>('room_run', { participantAgentId: agent.id,
      status: ['queued', 'running', 'recovery_required'], summaryOnly: true, limit: 5 })
    activities[agent.id] = { conversationId: room?.id, unread: Boolean(room && room.latestMessageSeq > (read?.value.seq ?? 0)),
      runs: runs.map((run) => ({ id: run.id, roomId: run.roomId!, phase: run.value.phase, status: run.value.status })) }
  }
  return { ...page, activities }
}
