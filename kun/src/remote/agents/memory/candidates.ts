import type { RoomRuntime } from '../../../rooms/room-runtime.js'
import type { AgentMemoryCandidate } from '../../../agents/agent-memory-capture-types.js'
import { decideAgentMemoryCandidate } from '../../../agents/agent-memory-candidates.js'
import { canonicalMemoryHash } from '../../../memory/memory-record-normalizer.js'
import { requireAgent } from '../access.js'
import { cursorScope, readCursor, writeCursor } from '../../cursor-codec.js'
import { candidateRow, decisionInput, decisionResult, memoryContentSlice, privateMemory } from './content-window.js'
import { RemoteNoEffect } from '../../requests/rejections.js'

export class RemoteMemoryCandidates {
  constructor(private readonly rooms: RoomRuntime) {}
  async list(p: any) {
    const agent = await requireAgent(this.rooms, p.agentId)
    if (!this.rooms.deps.memoryStore) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    const canWrite = !agent.archivedAt && await this.rooms.agentMemory.available()
    const scope = cursorScope(['agent.memory.candidates.list', p.agentId])
    const position = readCursor<{ before?: number; incomplete?: boolean }>(p.cursor, scope, {})
    if (position.before !== undefined && (!Number.isSafeInteger(position.before) || position.before < 0) ||
      position.incomplete !== undefined && typeof position.incomplete !== 'boolean') throw new RemoteNoEffect('INVALID_REQUEST')
    const candidates = [], deadline = Date.now() + 1000
    let before = position.before, incomplete = Boolean(position.incomplete), hasMore = false, scanned = 0
    while (candidates.length < p.limit && scanned < 100 && Date.now() < deadline) {
      const rows = await this.rooms.deps.store.list<AgentMemoryCandidate>('agent_memory_job', {
        participantAgentId: p.agentId, phase: 'candidate', status: ['pending', 'conflicted'], limit: 1, beforeSeq: before })
      if (!rows.length) { hasMore = false; break }
      const row = rows[0]; before = row.seq; scanned++; hasMore = true
      // Other room kinds are deliberately outside this personal-Agent surface.
      const room = await this.rooms.deps.store.get<any>('room', row.value.roomId)
      if (room?.value.conversationKind !== 'user_agent') continue
      try {
        const checked = await candidateRow(this.rooms, p.agentId, row.id, row.revision), value = checked.value
        const target = value.targetId ? await privateMemory(this.rooms, p.agentId, value.targetId).catch(() => null) : null
        const content = memoryContentSlice(value.candidate.content, 0, 320)
        candidates.push({ candidateId: row.id, revision: row.revision, status: value.status, action: value.action,
          type: value.candidate.type, proposed: { snippet: content.text, contentLength: content.totalChars,
            contentTruncated: content.nextOffset !== undefined, summary: true as const },
          canAccept: Boolean(canWrite && (target ? !target.disabledAt && !target.supersededAt :
            value.action === 'create' && !value.targetId && value.captureScope?.conversationId)),
          targetAvailable: Boolean(target), ...(target ? { target: { memoryId: target.id, fingerprint: canonicalMemoryHash(target),
            contentLength: target.content.length, disabled: Boolean(target.disabledAt || target.supersededAt) } } : {}),
          ...(['user_locked', 'source_changed', 'conflicting_memory'].includes(value.reason ?? '') ? { reason: value.reason } :
            value.reason?.startsWith('invalid-relation ') ? { reason: 'comparison_review_required' } : {}),
          source: { roomId: value.roomId, messageIds: value.sourceMessageIds.slice(0, 8) } })
      } catch { incomplete = true }
    }
    if (hasMore) hasMore = Boolean((await this.rooms.deps.store.list('agent_memory_job', {
      participantAgentId: p.agentId, phase: 'candidate', status: ['pending', 'conflicted'], limit: 1, beforeSeq: before })).length)
    return { agentId: p.agentId, candidates, hasMore, complete: !hasMore && !incomplete,
      ...(hasMore ? { nextCursor: writeCursor(scope, { before, incomplete }) } : {}) }
  }
  async get(p: any) {
    const row = await candidateRow(this.rooms, p.agentId, p.candidateId, p.expectedRevision)
    const target = p.side === 'current' ? await privateMemory(this.rooms, p.agentId, row.value.targetId ?? '', p.expectedTargetFingerprint) : undefined
    return { agentId: p.agentId, candidateId: p.candidateId, revision: row.revision, side: p.side,
      ...(target ? { targetFingerprint: canonicalMemoryHash(target) } : {}),
      content: memoryContentSlice(target?.content ?? row.value.candidate.content, p.contentOffset, p.maxChars) }
  }
  async preflight(p: any) {
    const agent = await requireAgent(this.rooms, p.agentId)
    const row = await candidateRow(this.rooms, p.agentId, p.candidateId, p.expectedRevision)
    if (!['pending', 'conflicted'].includes(row.value.status)) throw new RemoteNoEffect('REVISION_CONFLICT')
    if (p.decision === 'accept') {
      if (agent.archivedAt || !await this.rooms.agentMemory.available()) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
      if (row.value.targetId) {
        if (!p.expectedTargetFingerprint) throw new RemoteNoEffect('INVALID_REQUEST')
        const target = await privateMemory(this.rooms, p.agentId, row.value.targetId, p.expectedTargetFingerprint)
        if (target.disabledAt || target.supersededAt) throw new RemoteNoEffect('REVISION_CONFLICT')
      } else if (row.value.action !== 'create' || !row.value.captureScope?.conversationId || p.expectedTargetFingerprint !== undefined) {
        // Missing update targets and legacy candidates with unknown scope must not become creates.
        throw new RemoteNoEffect('INVALID_REQUEST')
      }
    }
  }
  async decide(p: any, clientRequestId: string) {
    return this.rooms.exclusive(async () => {
      await this.preflight(p)
      // Native service owns its canonical MemoryStore write and RoomStore decision proof.
      const result = await decideAgentMemoryCandidate(this.rooms.agentMemory, p.agentId, p.candidateId, decisionInput(p, clientRequestId)) as { candidate: AgentMemoryCandidate }
      return decisionResult(result.candidate, p.expectedRevision)
    })
  }
}
