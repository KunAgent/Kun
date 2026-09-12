import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { RoomSchema, RoomMessageSchema, RoomMemberSchema, SendRoomMessageSchema,
  type Room, type RoomMessage } from '../contracts/rooms.js'
import { CreateRoomRequestSchema, UpdateRoomRequestSchema } from '../contracts/rooms-api.js'
import type { RoomStore, RoomDocumentKind, RoomStoredDocument } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { observeRoomRepository } from './task-workspace-service.js'
import type { RoomRequestState } from './room-runtime-types.js'
import { assertRoomMemberRemovalAllowed } from './room-member-dependencies.js'

export const roomId = (): string => randomUUID()
export const roomFingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function putRoomDocument(
  store: RoomStore, kind: RoomDocumentKind, id: string, roomId: string,
  value: unknown, previous: RoomStoredDocument | null, taskId?: string
): Promise<void> {
  await store.commit({
    requestId: randomUUID(),
    checks: [{ kind, id, expectedRevision: previous?.revision ?? null }],
    puts: [{ kind, id, roomId, taskId, value }],
    events: [{ roomId, kind: kind + '.updated', payload: { id, ...(taskId ? { taskId } : {}) } }]
  })
}

export function defaultRoomMembers(repositoryIds: string[]) {
  return (['coordinator', 'developer', 'reviewer'] as const).map((role) =>
    RoomMemberSchema.parse({
      id: role, displayName: role === 'coordinator' ? '协调员' : role === 'developer' ? '开发' : '评审',
      presetId: role, role, revision: 0,
      allowedRepositoryIds: repositoryIds,
      ...(repositoryIds.length === 1 ? { defaultRepositoryId: repositoryIds[0] } : {})
    }))
}

export class RoomService {
  constructor(readonly store: RoomStore, private readonly wake: () => void) {}

  async get(id: string): Promise<Room> {
    const row = await this.store.get<Room>('room', id)
    if (!row) throw new Error('room not found')
    return { ...row.value, revision: row.revision }
  }

  async create(input: unknown): Promise<{ room: Room }> {
    const body = CreateRoomRequestSchema.parse(input)
    const key = 'room-create:' + body.clientRequestId
    const replay = await this.replay(key, body)
    if (replay) return replay as { room: Room }
    const repositories = await this.repositories(body.repositories ?? [])
    const now = new Date().toISOString()
    const members = body.members ?? defaultRoomMembers(repositories.map((repo) => repo.id))
    const room = RoomSchema.parse({ schemaVersion: 1, id: roomId(), name: body.name,
      description: body.description, collaborationMode: body.collaborationMode,
      defaultMemberId: body.defaultMemberId ?? members[0].id, members, repositories,
      revision: 0, createdAt: now, updatedAt: now })
    const result = { room }
    const committed = await this.store.commit({
      requestId: key, fingerprint: roomFingerprint(body),
      checks: [{ kind: 'room', id: room.id, expectedRevision: null }],
      puts: [{ kind: 'room', id: room.id, roomId: room.id, value: room }],
      events: [{ roomId: room.id, kind: 'room.created', payload: { id: room.id } }], result
    })
    return committed.result as typeof result
  }

  async update(id: string, input: unknown): Promise<{ room: Room }> {
    const body = UpdateRoomRequestSchema.parse(input)
    const key = 'room-update:' + id + ':' + body.clientRequestId
    const replay = await this.replay(key, body)
    if (replay) return replay as { room: Room }
    const old = await this.get(id)
    const { clientRequestId: _request, expectedRevision, archived, repositories, ...patch } = body
    void _request
    const room = RoomSchema.parse({ ...old, ...patch,
      ...(repositories ? { repositories: await this.repositories(repositories) } : {}),
      ...(archived !== undefined ? { archivedAt: archived ? new Date().toISOString() : undefined } : {}),
      revision: expectedRevision + 1, updatedAt: new Date().toISOString() })
    await assertRoomMemberRemovalAllowed(this.store, old, room)
    const result = { room }
    const saved = await this.store.commit({ requestId: key, fingerprint: roomFingerprint(body),
      checks: [{ kind: 'room', id, expectedRevision }],
      puts: [{ kind: 'room', id, roomId: id, value: room }],
      events: [{ roomId: id, kind: 'room.updated', payload: { id } }], result })
    return saved.result as typeof result
  }

  async send(id: string, input: unknown, internal?: { ruleAdoption: import('../contracts/rooms-product.js').RoomRule }): Promise<{ message: RoomMessage; requestId: string }> {
    const body = SendRoomMessageSchema.parse(input)
    const identity = internal ? { ...body, ruleAdoption: internal.ruleAdoption } : body
    const key = 'room-message:' + id + ':' + body.clientRequestId
    const replay = await this.replay(key, identity)
    if (replay) return replay as { message: RoomMessage; requestId: string }
    const room = await this.get(id)
    if (room.archivedAt) throw new RoomStoreConflictError('restore the room before sending')
    const message = RoomMessageSchema.parse({
      id: roomId(), roomId: id, messageSeq: 1, authorKind: 'user', authorLabelSnapshot: '你',
      body: body.body, bodyRevision: 0, mentionMemberIds: body.mentionMemberIds,
      replyToMessageId: body.replyToMessageId, taskId: body.taskId,
      attachmentIds: body.attachmentIds, clientRequestId: body.clientRequestId,
      requestFingerprint: roomFingerprint(body), createdAt: new Date().toISOString()
    })
    const request: RoomRequestState = { id: roomId(), roomId: id, status: 'pending',
      message: body, sourceMessageId: message.id, roomSnapshot: room,
      threadId: 'room-discussion-' + roomId(), ...(internal ? { ruleAdoption: internal.ruleAdoption } : {}) }
    const result = { message, requestId: request.id }
    const saved = await this.store.commit({ requestId: key, fingerprint: roomFingerprint(identity),
      checks: [{ kind: 'room', id, expectedRevision: room.revision },
        { kind: 'message', id: message.id, expectedRevision: null },
        { kind: 'request', id: request.id, expectedRevision: null }],
      puts: [{ kind: 'message', id: message.id, roomId: id, value: message },
        { kind: 'request', id: request.id, roomId: id, value: request }],
      events: [{ roomId: id, kind: 'message.created', payload: { id: message.id } }], result })
    this.wake()
    return saved.result as typeof result
  }

  async append(id: string, key: string, body: string, memberId?: string, taskId?: string) {
    const room = await this.get(id)
    const member = room.members.find((member) => member.id === memberId)
    const message = RoomMessageSchema.parse({ id: key, roomId: id, messageSeq: 1,
      authorKind: memberId ? 'member' : 'system', authorMemberId: memberId,
      authorLabelSnapshot: member?.displayName ?? 'Kun', body: body.slice(0, 64000),
      bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], taskId,
      createdAt: new Date().toISOString() })
    await this.store.commit({ requestId: 'append:' + key,
      fingerprint: roomFingerprint({ body, memberId, taskId }),
      checks: [{ kind: 'message', id: key, expectedRevision: null }],
      puts: [{ kind: 'message', id: key, roomId: id, value: message }],
      events: [{ roomId: id, kind: 'message.created', payload: { id: key } }], result: { id: key } })
  }

  async publish(id: string, key: string, body: string, memberId: string, taskId?: string) {
    if (!body.trim()) return
    const old = await this.store.get<RoomMessage>('message', key)
    if (!old) return this.append(id, key, body, memberId, taskId)
    if (old.roomId !== id || old.value.authorMemberId !== memberId) throw new Error('message identity mismatch')
    const text = body.slice(0, 64000)
    if (old.value.body === text) return
    await putRoomDocument(this.store, 'message', key, id,
      { ...old.value, body: text, bodyRevision: old.value.bodyRevision + 1 }, old, taskId)
  }

  async rule(id: string, messageId: string, clientRequestId: string) {
    const message = await this.store.get<RoomMessage>('message', messageId)
    if (!message || message.roomId !== id) throw new Error('message not found')
    const ruleId = roomId()
    const value = { id: ruleId, messageId, body: message.value.body, version: 1, active: true }
    return this.store.commit({ requestId: 'rule:' + id + ':' + clientRequestId,
      fingerprint: roomFingerprint({ messageId }), checks: [{ kind: 'rule', id: ruleId, expectedRevision: null },
        { kind: 'rule_version', id: ruleId + '-v1', expectedRevision: null }],
      puts: [{ kind: 'rule', id: ruleId, roomId: id, value },
        { kind: 'rule_version', id: ruleId + '-v1', roomId: id, value }],
      events: [{ roomId: id, kind: 'rule.created', payload: value }], result: value })
  }

  private async replay(key: string, body: unknown): Promise<unknown> {
    const replay = await this.store.getRequest(key)
    if (replay && replay.fingerprint !== roomFingerprint(body)) {
      throw new RoomStoreConflictError('request identifier was already used with different content')
    }
    return replay?.result
  }

  private async repositories(inputs: Array<{ id?: string; displayName?: string; displayPath: string; defaultBaseRef?: string }>) {
    return Promise.all(inputs.map(async (input) => {
      const observed = await observeRoomRepository(input.displayPath)
      const suppliedRef = input.defaultBaseRef?.trim()
      const baseRef = suppliedRef ? suppliedRef.startsWith('refs/heads/') ? suppliedRef : 'refs/heads/' + suppliedRef : observed.branch
      if (baseRef !== observed.branch) throw new Error('select the checked-out local branch as the room baseline')
      return { id: input.id ?? roomId(), displayName: input.displayName ?? basename(observed.root),
        displayPath: input.displayPath, canonicalRoot: observed.root, gitCommonDir: observed.commonDir,
        defaultBaseRef: baseRef, availability: 'available' as const }
    }))
  }
}
