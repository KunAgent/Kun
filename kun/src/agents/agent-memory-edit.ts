import { createHash } from 'node:crypto'
import { MemoryUpdateRequest, type MemoryRecord } from '../contracts/memory.js'
import { containsCredentialLikeData } from '../memory/memory-distillation.js'
import { canonicalMemoryHash } from '../memory/memory-record-normalizer.js'
import type { Room } from '../contracts/rooms.js'
import { RoomStoreConflictError, type RoomStoredDocument } from '../rooms/room-store.js'
import { agentStableId } from './agent-identity-service.js'
import { AgentMemoryEdit, type AgentMemoryService } from './agent-memory-service.js'
import type { z } from 'zod'

type EditJob = { id: string; phase: 'edit'; status: 'prepared' | 'completed' | 'conflicted';
  participantAgentId: string; memoryId: string; input: z.infer<typeof AgentMemoryEdit>;
  fingerprint: string; error?: string }
async function finish(service: AgentMemoryService, row: RoomStoredDocument<EditJob>, memory: MemoryRecord) {
  const job = row.value
  const result = { memory, fingerprint: canonicalMemoryHash(memory) }
  const receipt = await service.agents.store.commit({ requestId: job.id, fingerprint: job.fingerprint,
    checks: [{ kind: 'agent_memory_job', id: job.id, expectedRevision: row.revision }],
    puts: [{ kind: 'agent_memory_job', id: job.id, taskId: job.memoryId, roomId: row.roomId,
      value: { ...job, status: 'completed' } }], result,
    events: [{ roomId: row.roomId!, kind: 'agent.memory.updated', payload: { agentId: job.participantAgentId, id: job.memoryId } }] })
  return receipt.result
}
async function apply(service: AgentMemoryService, row: RoomStoredDocument<EditJob>) {
  const job = row.value, input = job.input
  const current = await service.find(job.participantAgentId, job.memoryId)
  if (current.agentContext?.lastOperationId === job.id) return finish(service, row, current)
  if (canonicalMemoryHash(current) !== input.expectedFingerprint) throw new RoomStoreConflictError('memory changed; reload before editing')
  const owner = current.agentContext!
  const access = { agent: { agentId: job.participantAgentId, manage: true,
    operationId: job.id, expectedFingerprint: input.expectedFingerprint } }
  const memory = input.forget ? await service.store().delete(current.id, access) :
    await service.store().update(current.id, MemoryUpdateRequest.parse({
      content: input.content, disabled: input.disabled,
      agentContext: { ...owner, lastOperationId: job.id,
        locked: input.locked ?? (input.content ? true : owner.locked),
        shared: input.shared ?? owner.shared, sharedConversationIds: input.sharedConversationIds ?? owner.sharedConversationIds,
        sharedProjectRoots: input.sharedProjectRoots ?? owner.sharedProjectRoots }
    }), access)
  return finish(service, row, memory)
}
export async function recoverAgentMemoryEdits(service: AgentMemoryService, memoryId?: string) {
  const rows = await service.agents.store.list<EditJob>('agent_memory_job', {
    taskId: memoryId, phase: 'edit', status: 'prepared', order: 'asc', limit: 50 })
  for (const row of rows) {
    try { await apply(service, row) } catch (error) {
      if (!(error instanceof RoomStoreConflictError)) throw error
      await service.agents.store.commit({ requestId: 'conflict:' + row.id,
        checks: [{ kind: 'agent_memory_job', id: row.id, expectedRevision: row.revision }],
        puts: [{ kind: 'agent_memory_job', id: row.id, taskId: row.taskId, roomId: row.roomId,
          value: { ...row.value, status: 'conflicted', error: error.message } }] })
    }
  }
}
export async function editAgentMemory(service: AgentMemoryService, agentId: string, id: string, raw: unknown) {
  const input = AgentMemoryEdit.parse(raw)
  await service.agents.get(agentId)
  await recoverAgentMemoryEdits(service, id)
  const key = agentStableId('agent-memory-edit', agentId, id, input.clientRequestId)
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const replay = await service.agents.store.getRequest(key)
  if (replay) {
    if (replay.fingerprint !== hash) throw new RoomStoreConflictError('memory edit identity changed')
    return replay.result
  }
  const current = await service.find(agentId, id)
  if (canonicalMemoryHash(current) !== input.expectedFingerprint) throw new RoomStoreConflictError('memory changed; reload before editing')
  if (input.shared && current.type !== 'preference') throw new RoomStoreConflictError('only a preference can be universal')
  if (input.content && containsCredentialLikeData({ content: input.content, type: current.type,
    confidence: 1, importance: current.importance, tags: [], observedAt: new Date().toISOString(), sources: current.sources })) {
    throw new RoomStoreConflictError('credential-like content cannot be saved as memory')
  }
  for (const roomId of input.sharedConversationIds ?? []) {
    const room = await service.agents.store.get<Room>('room', roomId)
    if (!room?.value.members.some((member) => member.participantAgentId === agentId && !member.removedAt)) {
      throw new RoomStoreConflictError('sharing requires this agent to participate in the target conversation')
    }
  }
  const missingRoots = new Set(input.sharedProjectRoots ?? [])
  let afterSeq = 0
  while (missingRoots.size) {
    const rooms = await service.agents.store.list<Room>('room', { limit: 50, afterSeq, order: 'asc' })
    for (const room of rooms) {
      const member = room.value.members.find((m) => m.participantAgentId === agentId && m.enabled && !m.removedAt)
      for (const repo of room.value.repositories) {
        if (member?.allowedRepositoryIds.includes(repo.id) && repo.availability === 'available') missingRoots.delete(repo.canonicalRoot)
      }
    }
    if (rooms.length < 50) break
    afterSeq = rooms.at(-1)!.seq
  }
  if (missingRoots.size) throw new RoomStoreConflictError('share only to an authorized canonical project')
  const job: EditJob = { id: key, phase: 'edit', status: 'prepared', participantAgentId: agentId, memoryId: id, input, fingerprint: hash }
  await service.agents.store.commit({ requestId: 'prepare:' + key, fingerprint: hash,
    checks: [{ kind: 'agent_memory_job', id: key, expectedRevision: null }],
    puts: [{ kind: 'agent_memory_job', id: key, roomId: current.agentContext!.sourceConversationId, taskId: id, value: job }] })
  return apply(service, (await service.agents.store.get<EditJob>('agent_memory_job', key))!)
}
