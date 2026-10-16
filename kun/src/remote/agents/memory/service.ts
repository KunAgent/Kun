import { canonicalMemoryHash } from '../../../memory/memory-record-normalizer.js'
import type { MemoryRecord } from '../../../contracts/memory.js'
import type { RoomRuntime } from '../../../rooms/room-runtime.js'
import { RemoteNoEffect } from '../../requests/rejections.js'
import { pageInput, pageOutput, privateAgentSource, requireAgent } from '../access.js'
export function publicAgentMemory(memory: MemoryRecord, fingerprint = canonicalMemoryHash(memory)) {
  return { id: memory.id, content: memory.content, type: memory.type, disabled: Boolean(memory.disabledAt), deleted: Boolean(memory.deletedAt),
    revision: memory.revision, createdAt: memory.createdAt, updatedAt: memory.updatedAt, fingerprint }
}
export class RemoteAgentMemory {
  constructor(private readonly rooms: RoomRuntime) {}
  async list(p: any) {
    await requireAgent(this.rooms, p.agentId)
    if (!this.rooms.deps.memoryStore) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    const page = pageInput('agent.memory.list', p)
    const result = await this.rooms.agentMemory.list(p.agentId, {
      limit: p.limit, includeDeleted: p.includeDeleted, ...(page.native ? { cursor: page.native } : {}) })
    return { memories: result.memories.map((entry) => publicAgentMemory(entry.memory, entry.fingerprint)),
      available: result.available, ...pageOutput(page.scope, result.nextCursor) }
  }
  async preflight(p: any) {
    const agent = await requireAgent(this.rooms, p.agentId)
    if (!await this.rooms.agentMemory.available()) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    if (p.action === 'create') {
      if (agent.archivedAt) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
      if (new Set(p.sourceMessageIds).size !== p.sourceMessageIds.length) throw new RemoteNoEffect('INVALID_REQUEST')
      await privateAgentSource(this.rooms, p.agentId, p.roomId, p.sourceMessageIds)
    } else {
      const memory = await this.rooms.agentMemory.find(p.agentId, p.memoryId)
      if (canonicalMemoryHash(memory) !== p.expectedFingerprint) throw new RemoteNoEffect('REVISION_CONFLICT')
    }
  }
  async update(p: any, clientRequestId: string) {
    await this.preflight(p)
    const result = await this.rooms.exclusive(async () => {
      await this.preflight(p)
      if (p.action === 'create') return this.rooms.agentMemory.create(p.agentId, { clientRequestId,
        conversationId: p.roomId, sourceMessageIds: p.sourceMessageIds, content: p.content, type: p.type, shared: false })
      return this.rooms.agentMemory.edit(p.agentId, p.memoryId, { clientRequestId, expectedFingerprint: p.expectedFingerprint,
        ...(p.action === 'forget' ? { forget: true } : {
          ...(p.content !== undefined ? { content: p.content } : {}), ...(p.disabled !== undefined ? { disabled: p.disabled } : {}) }) })
    }) as { memory: MemoryRecord; fingerprint: string }
    if (p.action === 'forget') return { memoryId: p.memoryId, forgotten: true }
    return { memory: publicAgentMemory(result.memory, result.fingerprint) }
  }
}
