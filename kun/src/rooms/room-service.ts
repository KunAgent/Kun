import { freezeAgentPermissions } from '../agents/agent-permission-snapshot.js'
import { prepareAgentTaskParticipants } from '../agents/agent-task-participants.js'
import type { AgentIdentityService } from '../agents/agent-identity-service.js'
import { attachRoomRunPublication } from './room-run-recording.js'
import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { RoomSchema, RoomMessageSchema, RoomMemberSchema, SendRoomMessageSchema,
  type Room, type RoomMessage } from '../contracts/rooms.js'
import type { RoomAvatarReference, RoomContentReference } from '../contracts/room-content.js'
import { CreateRoomRequestSchema, UpdateRoomRequestSchema } from '../contracts/rooms-api.js'
import type { RoomStore, RoomStoreCommit, RoomDocumentKind, RoomStoredDocument } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { observeRoomRepository } from './task-workspace-service.js'
import type { RoomRequestState } from './room-runtime-types.js'
import { assertRoomMemberRemovalAllowed } from './room-member-dependencies.js'
import { appendRoomReplyChecks, attachRoomPublicationReply, prepareRoomReplyContext } from './room-replies.js'
import { prepareRoomPollInvitation } from './room-poll-invitations.js'

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
  private directModel?: (room: Room) => Promise<import('../agents/agent-models.js').AgentModelBinding>
  setDirectModelResolver(resolver: NonNullable<RoomService['directModel']>) { this.directModel = resolver }
  async directBinding(room: Room) { return this.directModel?.(room) }
  private agents?: AgentIdentityService
  setAgentDirectory(agents: AgentIdentityService): void { this.agents = agents }
  private memberAvatarValidator?: (members: Array<{ avatar?: RoomAvatarReference | null }>) => Promise<void>
  private contentReferenceValidator?: (room: Room, references: NonNullable<import('../contracts/rooms.js').SendRoomMessage['references']>) => Promise<void>
  constructor(readonly store: RoomStore, private readonly wake: () => void) {}

  setContentReferenceValidator(validator: NonNullable<RoomService['contentReferenceValidator']>): void {
    this.contentReferenceValidator = validator
  }
  setMemberAvatarValidator(validator: NonNullable<RoomService['memberAvatarValidator']>): void {
    this.memberAvatarValidator = validator
  }
  private async assertUploadedAvatars(subjects: Array<{ avatar?: RoomAvatarReference | null }>): Promise<void> {
    const uploaded = subjects.filter((subject) => subject.avatar?.kind === 'uploaded')
    if (!uploaded.length) return
    if (!this.memberAvatarValidator) throw new Error('avatar storage unavailable')
    await this.memberAvatarValidator(uploaded)
  }

  async get(id: string): Promise<Room> {
    const row = await this.store.get<Room>('room', id)
    if (!row) throw new Error('room not found')
    const room = { ...row.value, revision: row.revision }
    return this.agents ? this.agents.present(room) : room
  }

  async create(input: unknown, internal?: { id: string; conversationKind: 'user_agent' | 'agent_agent' }): Promise<{ room: Room }> {
    const body = CreateRoomRequestSchema.parse(input)
    const key = 'room-create:' + body.clientRequestId
    const replay = await this.replay(key, body)
    if (replay) return replay as { room: Room }
    const repositories = await this.repositories(body.repositories ?? [])
    const now = new Date().toISOString()
    const members = body.members ?? (this.agents ? await this.agents.defaultMembers(repositories.map((repo) => repo.id)) : defaultRoomMembers(repositories.map((repo) => repo.id)))
    let room = RoomSchema.parse({ schemaVersion: 1, id: internal?.id ?? roomId(),
      conversationKind: internal?.conversationKind ?? 'group', name: body.name,
      description: body.description, ...(body.avatar ? { avatar: body.avatar } : {}),
      collaborationMode: body.collaborationMode ?? 'peer',
      maxConcurrentTasks: body.maxConcurrentTasks,
      defaultMemberId: body.defaultMemberId ?? members[0].id, members, repositories,
      revision: 0, createdAt: now, updatedAt: now })
    await this.assertUploadedAvatars([...room.members, { avatar: room.avatar }])
    const binding = this.agents ? await this.agents.prepareRoom(room) : undefined
    room = binding?.room ?? room
    const result = { room }
    const committed = await this.store.commit({
      requestId: key, fingerprint: roomFingerprint(body),
      checks: [{ kind: 'room', id: room.id, expectedRevision: null }, ...(binding?.checks ?? [])],
      puts: [{ kind: 'room', id: room.id, roomId: room.id, value: room }, ...(binding?.puts ?? [])],
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
    const { clientRequestId: _request, expectedRevision, archived, repositories, avatar, ...patch } = body
    void _request
    const next = { ...old, ...patch,
      ...(repositories ? { repositories: await this.repositories(repositories) } : {}),
      ...(archived !== undefined ? { archivedAt: archived ? new Date().toISOString() : undefined } : {}),
      revision: expectedRevision + 1, updatedAt: new Date().toISOString() }
    if (avatar === null) delete next.avatar
    else if (avatar !== undefined) next.avatar = avatar
    let room = RoomSchema.parse(next)
    const changedAvatars = [
      ...room.members.filter((member) => member.avatar?.kind === 'uploaded' &&
        JSON.stringify(member.avatar) !== JSON.stringify(old.members.find((previous) => previous.id === member.id)?.avatar)),
      ...(room.avatar?.kind === 'uploaded' && JSON.stringify(room.avatar) !== JSON.stringify(old.avatar)
        ? [{ avatar: room.avatar }] : [])
    ]
    await this.assertUploadedAvatars(changedAvatars)
    if (old.conversationKind && old.conversationKind !== 'group' && JSON.stringify(room.members.map((m) => [m.id, m.participantAgentId, m.removedAt])) !== JSON.stringify(old.members.map((m) => [m.id, m.participantAgentId, m.removedAt]))) {
      throw new RoomStoreConflictError('direct conversation participants cannot change')
    }
    const binding = this.agents ? await this.agents.prepareRoom(room, old) : undefined
    room = binding?.room ?? room
    await assertRoomMemberRemovalAllowed(this.store, old, room)
    const result = { room }
    const saved = await this.store.commit({ requestId: key, fingerprint: roomFingerprint(body),
      checks: [{ kind: 'room', id, expectedRevision }, ...(binding?.checks ?? [])],
      puts: [{ kind: 'room', id, roomId: id, value: room }, ...(binding?.puts ?? [])],
      events: [{ roomId: id, kind: 'room.updated', payload: { id } }], result })
    return saved.result as typeof result
  }

  async send(id: string, input: unknown, internal?: { ruleAdoption: import('../contracts/rooms-product.js').RoomRule }): Promise<{ message: RoomMessage; requestId: string }> {
    const body = SendRoomMessageSchema.parse(input)
    // Sharing a card alone supplies reference data, not an implementation goal.
    if (!body.body.trim() && body.references?.length && body.executionIntent === 'auto') body.executionIntent = 'discussion'
    const identity = internal ? { ...body, ruleAdoption: internal.ruleAdoption } : body
    const key = 'room-message:' + id + ':' + body.clientRequestId
    const replay = await this.replay(key, identity)
    if (replay) return replay as { message: RoomMessage; requestId: string }
    const storedRoom = await this.get(id)
    if (storedRoom.conversationKind === 'agent_agent') throw new RoomStoreConflictError('continue collaboration from its source conversation')
    if (this.agents && !(await this.agents.features()).identities && storedRoom.conversationKind === 'user_agent') throw new RoomStoreConflictError('independent conversations are disabled')
    const room = this.agents ? await this.agents.freeze(storedRoom) : storedRoom
    if (room.archivedAt) throw new RoomStoreConflictError('restore the room before sending')
    if (body.references?.length) {
      if (!this.contentReferenceValidator) throw new Error('Room content reference validation is unavailable')
      await this.contentReferenceValidator(room, body.references)
    }
    const replyContext = await prepareRoomReplyContext(this.store, id, body.replyToMessageId)
    const pollContext = await prepareRoomPollInvitation(this.store, room, body)
    const reply = body.replyToMessageId
      ? await this.store.get<RoomMessage>('message', body.replyToMessageId) : null
    if (body.replyToMessageId && (!reply || reply.roomId !== id)) {
      throw new RoomStoreConflictError('reply message is unavailable in this room')
    }
    if (body.rootRequestId && reply?.value.rootRequestId && body.rootRequestId !== reply.value.rootRequestId) {
      throw new RoomStoreConflictError('reply and topic refer to different room requests')
    }
    const inheritedRootId = body.rootRequestId ?? reply?.value.rootRequestId
    const root = inheritedRootId ? await this.store.get<RoomRequestState>('request', inheritedRootId) : null
    if (inheritedRootId && (!root || root.roomId !== id ||
      (root.value.rootRequestId && root.value.rootRequestId !== inheritedRootId))) {
      throw new RoomStoreConflictError('root request is unavailable in this room')
    }
    const requestId = roomId()
    const protocol = root ? root.value.collaborationProtocol ??
      (root.value.roomSnapshot.collaborationMode === 'peer' ? 'peer' : 'legacy') :
      room.collaborationMode === 'peer' ? 'peer' : 'legacy'
    const rootRequestId = inheritedRootId ?? requestId
    const message = RoomMessageSchema.parse({
      id: roomId(), roomId: id, messageSeq: 1, authorKind: 'user', authorLabelSnapshot: '你',
      rootRequestId, sourceRequestId: requestId, status: 'final',
      body: body.body, bodyRevision: 0, mentionMemberIds: body.mentionMemberIds,
      replyToMessageId: body.replyToMessageId, taskId: body.taskId,
      displayThreadRootId: replyContext.displayThreadRootId,
      references: body.references,
      attachmentIds: body.attachmentIds, clientRequestId: body.clientRequestId,
      requestFingerprint: roomFingerprint(body), createdAt: new Date().toISOString()
    })
    const privateTarget = room.conversationKind === 'user_agent' && !body.taskId && !body.executionAgentId
    const taskParticipants = this.agents ? await prepareAgentTaskParticipants(this.agents, room, body) : undefined
    const request: RoomRequestState = privateTarget
      ? {
          ...await this.privateDirectRequest(room, {
            requestId, rootRequestId, message: body, sourceMessageId: message.id,
            roomSnapshot: root ? { ...room, collaborationMode: root.value.roomSnapshot.collaborationMode } : room,
            ...(protocol === 'peer' && !root ? { peerLatestRequestId: requestId } : {}) }),
          taskParticipants,
          ...(pollContext.invitation ? { pollInvitation: pollContext.invitation } : {}),
          ...(internal ? { ruleAdoption: internal.ruleAdoption } : {})
        }
      : {
          taskParticipants, id: requestId, roomId: id, status: 'pending',
          rootRequestId, collaborationProtocol: protocol,
          ...(protocol === 'peer' && !root ? { peerLatestRequestId: requestId } : {}),
          message: body, sourceMessageId: message.id,
          ...(pollContext.invitation ? { pollInvitation: pollContext.invitation } : {}),
          roomSnapshot: root ? { ...room, collaborationMode: root.value.roomSnapshot.collaborationMode } : room,
          threadId: 'room-discussion-' + roomId(), ...(internal ? { ruleAdoption: internal.ruleAdoption } : {}) }
    const result = { message, requestId: request.id }
    const commit: RoomStoreCommit = { requestId: key, fingerprint: roomFingerprint(identity),
      checks: [{ kind: 'room', id, expectedRevision: room.revision },
        { kind: 'message', id: message.id, expectedRevision: null },
        { kind: 'request', id: request.id, expectedRevision: null },
        ...(root && protocol === 'peer' ? [{ kind: 'request' as const, id: root.id, expectedRevision: root.revision }] : [])],
      puts: [{ kind: 'message', id: message.id, roomId: id, value: message },
        { kind: 'request', id: request.id, roomId: id, value: request },
        ...(root && protocol === 'peer' ? [{ kind: 'request' as const, id: root.id, roomId: id,
          value: { ...root.value, peerLatestRequestId: requestId } }] : [])],
      events: [{ roomId: id, kind: 'message.created', payload: { id: message.id } }], result }
    appendRoomReplyChecks(commit, replyContext.checks)
    appendRoomReplyChecks(commit, pollContext.checks)
    const saved = await this.store.commit(commit)
    this.wake()
    return saved.result as typeof result
  }

  /**
   * Shared private-request construction for user sends and reminder wake-ups:
   * permission freezing, direct model binding, and the frozen room snapshot
   * all follow one path so both bindings stay identical.
   */
  async privateDirectRequest(room: Room, input: {
    requestId: string
    rootRequestId: string
    message: import('../contracts/rooms.js').SendRoomMessage
    sourceMessageId: string
    roomSnapshot?: Room
    peerLatestRequestId?: string
    privateReminder?: RoomRequestState['privateReminder']
  }): Promise<RoomRequestState> {
    if (this.agents) await freezeAgentPermissions(this.agents, room)
    return {
      privateProtocol: 'direct-v1', privateModel: await this.directModel?.(room),
      id: input.requestId, roomId: room.id, status: 'pending', rootRequestId: input.rootRequestId,
      collaborationProtocol: 'legacy',
      ...(input.peerLatestRequestId ? { peerLatestRequestId: input.peerLatestRequestId } : {}),
      message: input.message, sourceMessageId: input.sourceMessageId,
      roomSnapshot: input.roomSnapshot ?? room,
      threadId: 'room-discussion-' + roomId(),
      ...(input.privateReminder ? { privateReminder: input.privateReminder } : {})
    }
  }

  async append(id: string, key: string, body: string, memberId?: string, taskId?: string, originRunId?: string, status: 'streaming' | 'final' | 'failed' = 'final') {
    const room = await this.get(id)
    const execution = taskId ? await this.store.get<import('./room-runtime-types.js').RoomTaskExecution>('task', taskId) : null
    const member = room.members.find((member) => member.id === memberId) ??
      (execution?.roomId === id ? [execution.value.task.memberSnapshot, execution.value.reviewer].find((member) => member?.id === memberId) : undefined)
    const message = RoomMessageSchema.parse({ id: key, roomId: id, messageSeq: 1,
      authorKind: memberId ? 'member' : 'system', authorMemberId: memberId,
      authorAgentId: member?.participantAgentId,
      authorLabelSnapshot: member?.displayName ?? 'Kun', body: body.slice(0, 64000),
      bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], taskId, status,
      createdAt: new Date().toISOString() })
    const commit: RoomStoreCommit = { requestId: 'append:' + key,
      fingerprint: roomFingerprint({ body, memberId, taskId, ...(status === 'final' ? {} : { status }), ...(originRunId ? { originRunId } : {}) }),
      checks: [{ kind: 'message', id: key, expectedRevision: null }],
      puts: [{ kind: 'message', id: key, roomId: id, value: message }],
      events: [{ roomId: id, kind: 'message.created', payload: { id: key } }], result: { id: key } }
    await attachRoomRunPublication(this.store, commit, message, originRunId)
    await attachRoomPublicationReply(this.store, commit, message, originRunId)
    await this.store.commit(commit)
  }

  async publish(id: string, key: string, body: string, memberId: string, taskId?: string, originRunId?: string) {
    if (!body.trim()) return
    const run = originRunId ? await this.store.get<import('../contracts/room-runs.js').RoomRunRecord>('room_run', originRunId) : null
    const status = run && ['running', 'queued', 'recovery_required'].includes(run.value.status) ? 'streaming' : run && ['failed', 'cancelled'].includes(run.value.status) ? 'failed' : 'final'
    const old = await this.store.get<RoomMessage>('message', key)
    if (!old) return this.append(id, key, body, memberId, taskId, originRunId, status)
    if (old.roomId !== id || old.value.authorMemberId !== memberId) throw new Error('message identity mismatch')
    const text = body.slice(0, 64000)
    if (old.value.body === text && old.value.status === status && (!originRunId || old.value.originRunId === originRunId)) return
    const message: RoomMessage = { ...old.value, status, body: text, bodyRevision: old.value.bodyRevision + 1 }
    const commit: RoomStoreCommit = { requestId: randomUUID(),
      checks: [{ kind: 'message', id: key, expectedRevision: old.revision }],
      puts: [{ kind: 'message', id: key, roomId: id, value: message }],
      events: [{ roomId: id, kind: 'message.updated', payload: { id: key } }] }
    await attachRoomRunPublication(this.store, commit, message, originRunId)
    await this.store.commit(commit)
  }

  /** Publish one segmented assistant_text item as its own message, idempotently by source item. */
  async publishSegment(id: string, input: {
    messageId: string
    runId: string
    itemId: string
    body: string
    memberId: string
    taskId?: string
    createdAt: string
    status: 'streaming' | 'final' | 'failed'
    references?: RoomContentReference[]
    displayThreadRootId?: string
  }): Promise<void> {
    const text = input.body.slice(0, 64000)
    // An explicit send_im_message call may publish an attachment-only bubble.
    if (!text.trim() && !input.references?.length) return
    const old = await this.store.get<RoomMessage>('message', input.messageId)
    if (old && (old.roomId !== id || old.value.authorMemberId !== input.memberId)) throw new Error('message identity mismatch')
    if (old && (old.value.status === 'final' || old.value.status === 'failed') && input.status === 'streaming') return
    const message: RoomMessage = old
      ? { ...old.value, status: input.status, body: text, bodyRevision: old.value.bodyRevision + 1,
          ...(input.references?.length ? { references: input.references } : {}),
          ...(input.displayThreadRootId ? { displayThreadRootId: input.displayThreadRootId } : {}) }
      : RoomMessageSchema.parse({ id: input.messageId, roomId: id, messageSeq: 1,
          authorKind: 'member', authorMemberId: input.memberId, originItemId: input.itemId,
          authorLabelSnapshot: '', body: text, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
          taskId: input.taskId, status: input.status, createdAt: input.createdAt,
          ...(input.references?.length ? { references: input.references } : {}),
          ...(input.displayThreadRootId ? { displayThreadRootId: input.displayThreadRootId } : {}) })
    if (old && old.value.body === message.body && old.value.status === input.status && old.value.originRunId === input.runId) return
    const commit: RoomStoreCommit = { requestId: randomUUID(),
      checks: [{ kind: 'message', id: input.messageId, expectedRevision: old?.revision ?? null }],
      puts: [{ kind: 'message', id: input.messageId, roomId: id, value: message }],
      events: [{ roomId: id, kind: old ? 'message.updated' : 'message.created', payload: { id: input.messageId } }] }
    await attachRoomRunPublication(this.store, commit, message, input.runId)
    await attachRoomPublicationReply(this.store, commit, message, input.runId)
    await this.store.commit(commit)
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
