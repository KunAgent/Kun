import { createHash } from 'node:crypto'
import type { ThreadRecord } from '../contracts/threads.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { roomBaseContextBudget } from '../rooms/room-context.js'
import { agentStableId } from './agent-identity-service.js'

/** Persist the exact selected memory prefix before queue admission; replay never re-retrieves. */
export async function freezeAgentMemoryInput(deps: RoomRuntimeDeps, thread: ThreadRecord,
  clientRequestId: string, prompt: string): Promise<string> {
  const scope = thread.roomContext
  if (!scope?.participantAgentId || !deps.agentMemory) return prompt
  const id = agentStableId('agent-memory-input', thread.id, clientRequestId)
  const originalHash = createHash('sha256').update(prompt).digest('hex')
  const prior = await deps.store.get<{ originalHash: string; prompt: string }>('context', id)
  if (prior) {
    if (prior.roomId !== scope.roomId || prior.value.originalHash !== originalHash) throw new Error('memory input identity changed')
    return prior.value.prompt
  }
  const request = scope.requestId ? await deps.store.get<RoomRequestState>('request', scope.requestId) : null
  const byteBudget = request ? Math.floor(roomBaseContextBudget(deps, request.value) * .25) : 4000
  const task = scope.taskId ? await deps.store.get<import('../rooms/room-runtime-types.js').RoomTaskExecution>('task', scope.taskId) : null
  const handoff = scope.handoffId ? await deps.store.get<import('../contracts/agent-handoffs.js').AgentHandoff>('agent_handoff', scope.handoffId) : null
  const member = request?.value.roomSnapshot.members.find((member) => member.participantAgentId === scope.participantAgentId)
  const repositoryId = request?.value.message.repositoryId ?? task?.value.task.repositoryId ?? handoff?.value.repositoryId ?? member?.defaultRepositoryId
  const memory = await deps.agentMemory.context(scope.participantAgentId, scope.roomId,
    request?.value.message.body ?? prompt.slice(0, 4096),
    request?.value.roomSnapshot.repositories.find((repository) => repository.id === repositoryId)?.canonicalRoot,
    scope.handoffId, Math.min(4000, byteBudget), scope.taskScopedMemory ? scope.taskId : undefined)
  const combined = prompt + (memory.text ? '\n' + memory.text : '')
  await deps.store.commit({ requestId: id,
    checks: [{ kind: 'context', id, expectedRevision: null }],
    puts: [{ kind: 'context', id, roomId: scope.roomId, value: { id, roomId: scope.roomId,
      rootRequestId: scope.rootRequestId, memberId: scope.memberId, participantAgentId: scope.participantAgentId,
      originalHash, prompt: combined, memoryIds: memory.records.map((record) => record.id) } }] })
  return combined
}
