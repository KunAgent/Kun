import type { AgentActivity, AgentPage } from '../contracts/agent-identities.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { AgentIdentityService } from './agent-identity-service.js'
import { currentAgentConversation } from './agent-conversations.js'

export async function agentDirectoryPage(directory: AgentIdentityService, input: unknown): Promise<AgentPage> {
  const page = await directory.list(input)
  const activities: Record<string, AgentActivity> = {}
  if (!page.agents.length) return { ...page, activities }
  const roomIds = new Map<string, string>()
  const currentRooms = await Promise.all(page.agents.map((agent) => currentAgentConversation(directory, agent.id)))
  for (const [index, agent] of page.agents.entries()) {
    const row = currentRooms[index]
    if (row && !row.value.archivedAt) roomIds.set(agent.id, row.id)
  }
  const ids = [...roomIds.values()]
  const rooms = ids.length ? await directory.store.listRooms({ ids, conversationKind: 'user_agent', limit: 100 }) : { rooms: [] }
  for (const agent of page.agents) {
    const room = rooms.rooms.find((entry) => entry.id === roomIds.get(agent.id))
    const read = room ? await directory.store.get<{ seq: number }>('read_state', room.id) : null
    const runs = await directory.store.list<RoomRunRecord>('room_run', { participantAgentId: agent.id,
      status: ['queued', 'running', 'recovery_required'], summaryOnly: true, limit: 5 })
    activities[agent.id] = { conversationId: room?.id, unread: Boolean(room && room.latestMessageSeq > (read?.value.seq ?? 0)),
      runs: runs.map((run) => ({ id: run.id, roomId: run.roomId!, phase: run.value.phase, status: run.value.status })) }
  }
  return { ...page, activities }
}
