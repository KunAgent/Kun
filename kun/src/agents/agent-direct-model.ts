import type { z } from 'zod'
import type { AgentModelRef } from '../contracts/agent-identities.js'
import type { TurnReasoningEffort } from '../contracts/turn-reasoning.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import { RoomSchema } from '../contracts/rooms.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { assertExplicitAgentModel } from './agent-models.js'
import { resolveCodingAgentExecutor } from './agent-coding-agents.js'
import { agentExecutorRouteKey } from '../contracts/agent-executor.js'

/**
 * Change only future messages in this conversation; accepted requests keep
 * their snapshots. Model and reasoning effort move together or alone; a null
 * effort returns to the model default.
 */
export async function updateDirectModel(rooms: RoomRuntime, roomId: string, input: {
  clientRequestId: string; expectedRevision: number; modelRef?: z.infer<typeof AgentModelRef>
  executorModel?: string
  reasoningEffort?: TurnReasoningEffort | null
}) {
  const store = rooms.deps.store
  const key = `private-model:${roomId}:${input.clientRequestId}`
  const fingerprint = roomFingerprint(input)
  const previous = await store.getRequest(key)
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new RoomStoreConflictError('model selection request changed')
    return rooms.service.get(roomId)
  }
  const room = await rooms.service.get(roomId)
  if (room.conversationKind !== 'user_agent') throw new RoomStoreConflictError('Private conversation required')
  if (room.archivedAt || room.deletedAt) throw new RoomStoreConflictError('Restore the conversation before changing its model')
  const agent = await rooms.agents.active(room.members.find((member) => member.id === room.defaultMemberId)!.participantAgentId!)
  let executorModel = room.privateExecutorModel
  if (agent.executor) {
    if (input.modelRef) throw new RoomStoreConflictError('Choose a model from this coding Agent\'s engine')
    if (input.executorModel !== undefined) {
      const resolved = await resolveCodingAgentExecutor(rooms.workbench.harnesses, { ...agent.executor, model: input.executorModel })
      if (agentExecutorRouteKey(resolved) !== agentExecutorRouteKey(agent.executor)) {
        throw new RoomStoreConflictError('A conversation model cannot change its Agent\'s engine or account')
      }
      executorModel = resolved.model
    }
  } else {
    if (input.executorModel !== undefined) throw new RoomStoreConflictError('This Agent uses configured model connections')
    if (input.modelRef) await assertExplicitAgentModel(rooms.deps, input.modelRef)
  }
  const { privateReasoningEffort: _effort, ...rest } = room
  const effort = input.reasoningEffort === undefined ? room.privateReasoningEffort : input.reasoningEffort ?? undefined
  const next = RoomSchema.parse({ ...rest, privateModelRef: input.modelRef ?? room.privateModelRef,
    ...(executorModel ? { privateExecutorModel: executorModel } : {}),
    ...(effort ? { privateReasoningEffort: effort } : {}),
    revision: room.revision + 1, updatedAt: new Date().toISOString() })
  await store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'room', id: roomId, expectedRevision: input.expectedRevision }],
    puts: [{ kind: 'room', id: roomId, roomId, value: next }],
    events: [{ roomId, kind: 'room.updated', payload: { id: roomId } }] })
  return rooms.service.get(roomId)
}
