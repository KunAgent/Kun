import type { MemoryRecord } from '../../../contracts/memory.js'
import type { AgentMemoryCandidate } from '../../../agents/agent-memory-capture-types.js'
import { MemoryCandidate } from '../../../contracts/memory-distillation.js'
import type { RoomRuntime } from '../../../rooms/room-runtime.js'
import { canonicalMemoryHash } from '../../../memory/memory-record-normalizer.js'
import { privateAgentSource, requireAgent } from '../access.js'
import { RemoteNoEffect } from '../../requests/rejections.js'

/** UTF-16 offsets match the rest of the remote content API without splitting a surrogate pair. */
export function memoryContentSlice(text: string, offset: number, maxChars: number) {
  if (offset > text.length || offset > 0 && /[\uDC00-\uDFFF]/.test(text[offset] ?? '') && /[\uD800-\uDBFF]/.test(text[offset - 1]))
    throw new RemoteNoEffect('INVALID_REQUEST')
  let end = Math.min(text.length, offset + maxChars)
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) {
    if (end - offset === 1) throw new RemoteNoEffect('INVALID_REQUEST')
    end--
  }
  return { text: text.slice(offset, end), offset, ...(end < text.length ? { nextOffset: end } : {}), totalChars: text.length }
}
export async function privateMemory(rooms: RoomRuntime, agentId: string, memoryId: string, fingerprint?: string): Promise<MemoryRecord> {
  await requireAgent(rooms, agentId)
  if (!rooms.deps.memoryStore) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
  const memory = await rooms.agentMemory.find(agentId, memoryId).catch(() => null)
  if (!memory || memory.deletedAt || !memory.agentContext || memory.agentContext.agentId !== agentId)
    throw new RemoteNoEffect('NOT_FOUND')
  await privateAgentSource(rooms, agentId, memory.agentContext.sourceConversationId, [], false, true)
  if (fingerprint !== undefined && canonicalMemoryHash(memory) !== fingerprint) throw new RemoteNoEffect('REVISION_CONFLICT')
  return memory
}
export async function candidateRow(rooms: RoomRuntime, agentId: string, candidateId: string, expectedRevision?: number) {
  await requireAgent(rooms, agentId)
  const row = await rooms.deps.store.get<AgentMemoryCandidate>('agent_memory_job', candidateId)
  if (!row || row.value.id !== candidateId || row.value.phase !== 'candidate' || row.value.participantAgentId !== agentId || row.roomId !== row.value.roomId)
    throw new RemoteNoEffect('NOT_FOUND')
  if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
  const value = row.value
  if (!MemoryCandidate.safeParse(value.candidate).success || !Array.isArray(value.sourceMessageIds) || value.sourceMessageIds.length > 32 ||
    !['pending', 'completed', 'skipped', 'conflicted'].includes(value.status) || !['create', 'update', 'supersede'].includes(value.action))
    throw new RemoteNoEffect('INVALID_REQUEST')
  await privateAgentSource(rooms, agentId, value.roomId, value.sourceMessageIds, false, true)
  if (value.captureScope) {
    await privateAgentSource(rooms, agentId, value.captureScope.conversationId, [], false, true)
  }
  const storage = rooms.agentMemory.store()
  if (await storage.isForgotten?.({ ...value.candidate, scope: 'user', agentContext: {
    schemaVersion: 1, agentId, sourceConversationId: value.captureScope?.conversationId ?? value.roomId,
    sourceTaskId: value.captureScope?.taskId, sourceHandoffId: value.captureScope?.handoffId, shared: false,
    sharedConversationIds: [], sharedProjectRoots: [], locked: false } }, value.memoryId)) throw new RemoteNoEffect('NOT_FOUND')
  if (value.targetId) await privateMemory(rooms, agentId, value.targetId)
  return row
}
export function decisionInput(p: any, clientRequestId: string) {
  return { clientRequestId, expectedRevision: p.expectedRevision, decision: p.decision === 'accept' ? 'allow' as const : 'skip' as const,
    ...(p.decision === 'accept' ? { expectedTargetFingerprint: p.expectedTargetFingerprint } : {}) }
}
export function decisionResult(candidate: AgentMemoryCandidate, expectedRevision: number) {
  return { candidateId: candidate.id, status: candidate.status, revision: expectedRevision + 1,
    ...(candidate.memoryId ? { memoryId: candidate.memoryId } : {}) }
}
