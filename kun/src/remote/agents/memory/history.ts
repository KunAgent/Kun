import type { RoomRuntime } from '../../../rooms/room-runtime.js'
import type { MemoryRevision } from '../../../contracts/memory.js'
import { privateAgentSource } from '../access.js'
import { memoryContentSlice, privateMemory } from './content-window.js'
import { cursorScope, readCursor, writeCursor } from '../../cursor-codec.js'
import { RemoteNoEffect } from '../../requests/rejections.js'

export class RemoteMemoryHistory {
  constructor(private readonly rooms: RoomRuntime) {}
  private async history(p: any) {
    const current = await privateMemory(this.rooms, p.agentId, p.memoryId, p.expectedFingerprint)
    const history: MemoryRevision[] = []
    let incomplete = false
    // Native canonical history is capped at 20 revisions/64k JSON characters.
    for (const entry of current.history) {
      const context = entry.snapshot.agentContext
      if (!context || context.agentId !== p.agentId) { incomplete = true; continue }
      try { await privateAgentSource(this.rooms, p.agentId, context.sourceConversationId, [], false, true) }
      catch { incomplete = true; continue }
      history.push(entry)
    }
    return { current, history: history.sort((a, b) => b.revision - a.revision), incomplete }
  }
  async list(p: any) {
    const result = await this.history(p), scope = cursorScope(['agent.memory.history.list', p.agentId, p.memoryId, p.expectedFingerprint])
    const position = readCursor<{ offset: number }>(p.cursor, scope, { offset: 0 })
    if (!Number.isSafeInteger(position.offset) || position.offset < 0 || position.offset > result.history.length)
      throw new RemoteNoEffect('INVALID_REQUEST')
    const revisions = result.history.slice(position.offset, position.offset + p.limit).map((entry) => ({
      revision: entry.revision, changedAt: entry.changedAt, operation: entry.operation, type: entry.snapshot.type,
      contentLength: entry.snapshot.content.length, available: true as const }))
    const offset = position.offset + revisions.length, hasMore = offset < result.history.length
    return { agentId: p.agentId, memoryId: p.memoryId, fingerprint: p.expectedFingerprint, currentRevision: result.current.revision,
      coverage: 'retained_local_revisions' as const, revisions, hasMore, complete: !hasMore && !result.incomplete,
      ...(hasMore ? { nextCursor: writeCursor(scope, { offset }) } : {}) }
  }
  async get(p: any) {
    const result = await this.history(p), entry = result.history.find((item) => item.revision === p.revision)
    if (!entry) throw new RemoteNoEffect('NOT_FOUND')
    return { agentId: p.agentId, memoryId: p.memoryId, fingerprint: p.expectedFingerprint, revision: entry.revision,
      coverage: 'retained_local_revisions' as const, content: memoryContentSlice(entry.snapshot.content, p.contentOffset, p.maxChars) }
  }
}
