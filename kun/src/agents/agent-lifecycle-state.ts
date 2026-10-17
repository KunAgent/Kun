import { z } from 'zod'
import type { Room } from '../contracts/rooms.js'
import type { RoomStore, RoomStoreCommit, RoomStoredDocument } from '../rooms/room-store.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'

export const AgentLifecycleState = z.object({
  kind: z.literal('state'), agentId: z.string(), roomId: z.string(),
  state: z.enum(['active', 'restarting']), generation: z.number().int().nonnegative(),
  operationId: z.string(), handoffId: z.string().optional(), queuePaused: z.boolean(), updatedAt: z.string()
}).strict()
export type AgentLifecycleState = z.infer<typeof AgentLifecycleState>
export const agentLifecycleId = (agentId: string) => 'agent-lifecycle:' + agentId
export const contextGeneration = (room: Room) => room.privateContextGeneration ?? 0

export async function lifecycleRow(store: RoomStore, room: Room) {
  const agentId = room.members.find(member => member.id === room.defaultMemberId)?.participantAgentId
  const state = agentId ? await store.get<AgentLifecycleState>('agent_lifecycle', agentLifecycleId(agentId)) : null
  return state?.value.roomId === room.id ? state : null
}
/** Runtime generation is separate from the user's transcript/reset epoch. */
export async function privateRequestCanRun(store: RoomStore, request: RoomRequestState): Promise<boolean> {
  const room = await store.get<Room>('room', request.roomId)
  if (!room || room.value.deletedAt || contextGeneration(room.value) !== contextGeneration(request.roomSnapshot)) return false
  const state = await lifecycleRow(store, room.value)
  return !state || state.value.state === 'active' && state.value.generation === contextGeneration(room.value)
}
export async function privateAdmissionChecks(store: RoomStore, room: Room): Promise<NonNullable<RoomStoreCommit['checks']>> {
  if (room.conversationKind !== 'user_agent') return []
  const state = await lifecycleRow(store, room)
  if (state?.value.state === 'restarting') throw new Error('AGENT_RESTART_IN_PROGRESS')
  return state ? [{ kind: 'agent_lifecycle', id: state.id, expectedRevision: state.revision }] : []
}
export type LifecycleRow = RoomStoredDocument<AgentLifecycleState>
