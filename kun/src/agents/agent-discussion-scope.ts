import type { Room } from '../contracts/rooms.js'
import type { RoomPeerTopic } from '../rooms/room-peer-types.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'

export function peerBudgetMember(topic: RoomPeerTopic, memberId: string): string {
  return topic.roomSnapshot.members.find((member) => member.id === memberId)?.participantAgentId ?? memberId
}
export function agentLane(id: string): string { return 'agent:' + id }
export async function discussionAgentLane(deps: RoomRuntimeDeps, roomId: string, memberId: string, snapshot?: Room): Promise<string | undefined> {
  const saved = snapshot?.members.find((member) => member.id === memberId)?.participantAgentId
  if (saved) return agentLane(saved)
  const room = await deps.store.get<Room>('room', roomId)
  const agentId = room?.value.members.find((member) => member.id === memberId)?.participantAgentId
  return agentId ? agentLane(agentId) : undefined
}
