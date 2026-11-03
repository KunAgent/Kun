import { z } from 'zod'
import type { Room, RoomMessage } from '../../contracts/rooms.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { receiptKey } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { requireRemoteScope, type RemoteAuthority } from '../authorization/scopes.js'
import { GroupGetParams, GroupListParams, GroupHistoryParams, GroupSendParams } from './contracts.js'
import { RemoteGroupMutations } from './mutations.js'
import { RemoteGroupTargetError, publicGroup } from './projection.js'
import type { Receipt } from '../requests/receipts.js'
export { GroupGetParams, GroupListParams, GroupHistoryParams, GroupSendParams, GroupWriteParamSchemas } from './contracts.js'
export { RemoteGroupTargetError, groupSummary } from './projection.js'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
function groupMessage(m: RoomMessage) {
  return { id: m.id, roomId: m.roomId, body: m.body, bodyRevision: m.bodyRevision, status: m.status,
    authorKind: m.authorKind, authorLabel: m.authorLabelSnapshot, authorMemberId: m.authorMemberId,
    attachmentIds: m.attachmentIds, createdAt: m.createdAt, messageSeq: m.messageSeq,
    replyToMessageId: m.replyToMessageId, rootRequestId: m.rootRequestId, presentationKind: m.presentationKind }
}
/** Standalone until the versioned scoped envelope is wired; never attached to a personal grant. */
export class RemoteGroups {
  private mutations: RemoteGroupMutations
  constructor(private runtime: ServerRuntime) { this.mutations = new RemoteGroupMutations(runtime, (scope, id) => this.requireGroup(scope, id)) }
  async preflight(method: string, params: unknown, scope: RemoteAuthority) {
    if (method !== 'group.message.send') return this.mutations.preflight(method, params, scope)
    try { await this.requireGroup(scope, (params as { roomId: string }).roomId) }
    catch (error) {
      if (error instanceof RemoteGroupTargetError) throw new RemoteNoEffect(error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST')
      throw error
    }
  }
  mutate(scope: RemoteAuthority, method: string, params: unknown, requestId: string) { return this.mutations.mutate(scope, method, params, requestId) }
  recoverMutation(scope: RemoteAuthority, receipt: Receipt) { return this.mutations.recover(scope, receipt) }
  async get(scope: RemoteAuthority, raw: unknown) { return { group: await publicGroup(this.runtime, await this.requireGroup(scope, GroupGetParams.parse(raw).roomId)) } }
  async requireGroup(scope: RemoteAuthority, roomId: string) {
    requireRemoteScope(scope, 'groups.read')
    const row = await this.runtime.rooms!.deps.store.get<Room>('room', roomId)
    if (!row || row.value.deletedAt) throw new RemoteGroupTargetError('NOT_FOUND')
    if (row.value.conversationKind && row.value.conversationKind !== 'group') throw new RemoteGroupTargetError('NOT_A_GROUP')
    const room = await this.runtime.rooms!.service.get(roomId)
    return room
  }
  async list(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'groups.read')
    const p = GroupListParams.parse(raw)
    const page = await this.runtime.rooms!.listRooms({ conversationKind: 'group', limit: p.limit,
      cursor: p.cursor, archivedOnly: p.archived, search: p.query })
    return { groups: await Promise.all(page.rooms.map((room) => publicGroup(this.runtime, room))), nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) }
  }
  async history(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'groups.read')
    const p = GroupHistoryParams.parse(raw), room = await this.requireGroup(scope, p.roomId)
    const beforeSeq = p.cursor === undefined ? undefined : z.coerce.number().int().positive().parse(p.cursor)
    const store = this.runtime.rooms!.deps.store, cursor = await store.latestEventSeq?.()
    const rows = await store.list<RoomMessage>('message', { roomId: room.id, limit: p.limit + 1, beforeSeq })
    const messages = [], taken = []
    let bytes = 0
    for (const row of rows.slice(0, p.limit)) {
      const message = groupMessage({ ...row.value, messageSeq: row.seq }), size = Buffer.byteLength(JSON.stringify(message))
      if (bytes + size > 512 * 1024) break
      taken.push(row); bytes += size
      if (row.value.presentationKind !== 'setup') messages.push(message)
    }
    if (rows.length && !taken.length) throw new Error('MESSAGE_TOO_LARGE')
    const hasMore = taken.length < rows.length
    return { room: await publicGroup(this.runtime, room), messages: messages.reverse(), hasMore,
      nextCursor: hasMore ? String(taken.at(-1)!.seq) : undefined,
      eventScope: await store.eventScope?.(), cursor }
  }
  async send(scope: RemoteAuthority, raw: unknown, requestId: string) {
    requireRemoteScope(scope, 'groups.write')
    requireRemoteScope(scope, 'groups.read')
    const p = GroupSendParams.parse(raw)
    const rooms = this.runtime.rooms!
    const result = await rooms.exclusive(async () => {
      await this.requireGroup(scope, p.roomId)
      return rooms.service.send(p.roomId, { clientRequestId: receiptKey(scope, Id.parse(requestId)),
        body: p.text, mentionMemberIds: p.mentionMemberIds, executionIntent: p.executionIntent },
      { clientSurface: 'api', remoteDeviceId: scope.deviceId })
    })
    rooms.wake()
    return { ...result, roomId: p.roomId }
  }
  async recover(scope: RemoteAuthority, roomId: string, requestId: string) {
    await this.requireGroup(scope, roomId)
    const old = await this.runtime.rooms!.deps.store.getRequest('room-message:' + roomId + ':' + receiptKey(scope, requestId))
    return old?.result
  }
}
