import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { utf8Size } from '@kun/remote-protocol'
import { pageInput, pageOutput, privateAgentSource, requireAgent } from './access.js'
export class RemoteAgentCommitments {
  constructor(private readonly rooms: RoomRuntime) {}
  async list(p: any) {
    await requireAgent(this.rooms, p.agentId)
    const page = pageInput('agent.commitments.list', p)
    if (page.native && (!/^(0|[1-9][0-9]{0,15})$/.test(page.native) || !Number.isSafeInteger(Number(page.native))))
      throw new RemoteNoEffect('INVALID_REQUEST')
    const commitments = [], limit = p.limit ?? 20
    let native = page.native, hasMore = false, bytes = 0
    for (let scanned = 0; scanned < 200 && commitments.length < limit; scanned++) {
      const result = await this.rooms.commitments.list(p.agentId, {
        limit: 1, ...(native ? { cursor: native } : {}),
        ...(p.status ? { status: p.status } : {}), ...(p.search !== undefined ? { search: p.search } : {}) })
      const item = result.commitments[0]
      if (!item) { hasMore = false; break }
      let allowed = true
      try { await privateAgentSource(this.rooms, p.agentId, item.sourceRoomId, [], false, true) }
      catch (error) { if (error instanceof RemoteNoEffect) allowed = false; else throw error }
      const size = utf8Size(JSON.stringify(item))
      // Keep full records; continue from the unconsumed item instead of silently clipping evidence.
      if (allowed && commitments.length && bytes + size > 512 * 1024) { hasMore = true; break }
      if (allowed) { commitments.push(item); bytes += size }
      native = result.nextCursor
      hasMore = Boolean(native)
      if (!hasMore) break
    }
    return { commitments, ...pageOutput(page.scope, hasMore ? native : undefined) }
  }
  async preflight(p: any) {
    const agent = await requireAgent(this.rooms, p.agentId)
    if (p.action === 'create') {
      if (agent.archivedAt) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
      await privateAgentSource(this.rooms, p.agentId, p.roomId, [p.sourceMessageId], true)
    }
    else {
      const current = await this.rooms.commitments.get(p.agentId, p.commitmentId)
      if (current.revision !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
      await privateAgentSource(this.rooms, p.agentId, current.sourceRoomId, [], false, true)
      const status = p.action === 'cancel' ? 'cancelled' : p.status ?? current.status
      if (status === 'completed' && !(p.acceptanceEvidence ?? current.acceptanceEvidence).length)
        throw new RemoteNoEffect('INVALID_REQUEST')
      if (['waiting', 'blocked'].includes(status) && !(p.waitingOn ?? current.waitingOn)?.trim())
        throw new RemoteNoEffect('INVALID_REQUEST')
    }
  }
  async act(p: any, clientRequestId: string) {
    await this.preflight(p)
    try {
      return await this.rooms.exclusive(async () => {
        await this.preflight(p)
        const { agentId, action, roomId, sourceMessageId, commitmentId, ...fields } = p
        if (action === 'create') return { commitment: await this.rooms.commitments.create(agentId, {
          ...fields, clientRequestId, sourceRoomId: roomId, sourceMessageId }) }
        return { commitment: await this.rooms.commitments.update(agentId, commitmentId, {
          ...fields, clientRequestId, ...(action === 'cancel' ? { status: 'cancelled' } : {}) }) }
      })
    } catch (error) {
      if (error instanceof RoomStoreConflictError && error.currentRevision !== null)
        throw new RemoteNoEffect('REVISION_CONFLICT')
      throw error
    }
  }
}
