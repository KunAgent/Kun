import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { isRemoteCodeAllowed } from '../code/access.js'
import type {RemoteResource } from '../resources/contracts.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
export class RemoteAttention {
  constructor(private runtime: ServerRuntime) {}
  private async resource(threadId: string): Promise<RemoteResource | null> {
    const thread = await this.runtime.threadService.getMetadata(threadId)
    if (!thread) return null
    if (!thread.roomContext) return await isRemoteCodeAllowed(this.runtime, thread) ? { kind: 'code', id: thread.id } : null
    const room = await this.runtime.rooms!.service.get(thread.roomContext.roomId).catch(() => null)
    if (!room || room.conversationKind !== 'user_agent' || room.deletedAt) return null
    const id = room.members.find((member) => !member.removedAt && member.participantAgentId)?.participantAgentId
    if (!id || !await this.runtime.rooms!.agents.store.get('agent_identity', id)) return null
    return { kind: 'agent', id }
  }
  async list(p: { cursor?: string; limit?: number }) {
    const scope = cursorScope('attention.list'), position = readCursor<{ after?: string }>(p.cursor, scope, {})
    if (position.after !== undefined && typeof position.after !== 'string') throw new Error('INVALID_CURSOR')
    const pending = [
      ...this.runtime.approvalGate.pending().map((approval) => ({ id: 'approval:' + approval.id, approval, input: undefined })),
      ...this.runtime.userInputGate.pending().map((input) => ({ id: 'input:' + input.id, input, approval: undefined }))
    ].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).filter((entry) => !position.after || entry.id > position.after)
    const items = [], limit = p.limit ?? 20
    let after: string | undefined, hasMore = false, scanned = 0
    for (const entry of pending) {
      const request = entry.approval ?? entry.input!
      after = entry.id
      scanned++
      const resource = await this.resource(request.threadId)
      if (resource) {
        // A decision can settle while metadata is being read. Never reissue its card.
        const live = entry.approval ? this.runtime.approvalGate.get(request.id)?.status === 'pending'
          : Boolean(this.runtime.userInputGate.get(request.id))
        if (live) items.push({ id: request.id, kind: entry.approval ? 'approval' : 'input', resource,
          summary: (entry.approval?.summary ?? entry.input?.prompt ?? '').slice(0, 2048),
          threadId: request.threadId, turnId: request.turnId,
          ...(entry.approval ? { approval: entry.approval } : { input: entry.input }) })
      }
      if (items.length >= limit || scanned >= 200) { hasMore = entry !== pending.at(-1); break }
    }
    return { items, hasMore, ...(hasMore && after ? { nextCursor: writeCursor(scope, { after }) } : {}) }
  }
}
