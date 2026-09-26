import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { AgentHandoffInput, AgentHandoffSchema, type AgentHandoff } from '../contracts/agent-handoffs.js'
import { RoomMessageSchema, RoomSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution } from '../rooms/room-runtime-types.js'
import type { RoomPeerTopic } from '../rooms/room-peer-types.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import type { RoomService } from '../rooms/room-service.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'
import { openAgentPairConversation } from './agent-conversations.js'
import { roomRunId } from '../rooms/room-run-recording.js'

export type HandoffOrigin = { thread: ThreadRecord; turnId: string; parent?: AgentHandoff }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export class AgentHandoffService {
  constructor(readonly deps: RoomRuntimeDeps, readonly agents: AgentIdentityService,
    readonly rooms: RoomService, private readonly wake: () => void) {}

  async get(id: string): Promise<AgentHandoff> {
    const row = await this.deps.store.get<AgentHandoff>('agent_handoff', id)
    if (!row) throw new Error('agent handoff not found')
    return row.value
  }
  async source(id: string) {
    const job = await this.get(id)
    const root = await this.deps.store.get<RoomRequestState>('request', job.sourceRootRequestId)
    const request = job.sourceRequestId === root?.id ? root : await this.deps.store.get<RoomRequestState>('request', job.sourceRequestId)
    const topic = await this.deps.store.get<RoomPeerTopic>('peer_topic', job.sourceRootRequestId)
    const room = await this.deps.store.get<Room>('room', job.sourceRoomId)
    return { job, root, request, topic, room }
  }
  async current(id: string): Promise<boolean> {
    const { job, root, request, topic, room } = await this.source(id)
    if (!root || !request || root.roomId !== job.sourceRoomId || !room || room.value.archivedAt ||
      root.value.cancellationRequested || request.value.cancellationRequested ||
      ['cancelled', 'stopping'].includes(request.value.status) ||
      topic && (topic.value.generation !== job.sourceGeneration || ['stopped', 'stopping'].includes(topic.value.status)) ||
      !topic && (request.value.continuation ?? 0) !== (job.sourceGeneration ?? 0)) return false
    for (const source of job.sources) {
      const message = await this.deps.store.get<RoomMessage>('message', source.id)
      if (!message || message.roomId !== job.sourceRoomId || message.value.bodyRevision !== source.version ||
        message.value.status !== 'final') return false
    }
    const recipientPresent = room.value.members.some((member) => member.participantAgentId === job.recipientAgentId && member.enabled && !member.removedAt)
    if (!recipientPresent && !job.designatedAgentIds.includes(job.recipientAgentId)) return false
    if (job.sourceTaskId) {
      const task = await this.deps.store.get<RoomTaskExecution>('task', job.sourceTaskId)
      if (!task || !job.sourceTaskActorAgentId || task.roomId !== job.sourceRoomId || ['stopping', 'cancelled'].includes(task.value.task.status) ||
        ![task.value.task.memberSnapshot.participantAgentId, task.value.reviewer?.participantAgentId].includes(job.sourceTaskActorAgentId)) return false
    }
    if (!job.parentHandoffId && !job.sourceTaskId && !room.value.members.some((member) => member.id === job.senderMemberId && member.participantAgentId === job.senderAgentId && member.enabled && !member.removedAt)) return false
    if (job.parentHandoffId) {
      const parent = await this.deps.store.get<AgentHandoff>('agent_handoff', job.parentHandoffId)
      if (!parent || ['cancelled', 'stale', 'budget_exhausted'].includes(parent.value.status) || !await this.current(parent.id)) return false
    }
    return true
  }
  async permitted(origin: HandoffOrigin): Promise<string[]> {
    if (origin.parent) return origin.parent.allowedAgentIds
    const scope = origin.thread.roomContext!
    const request = scope.requestId ? await this.deps.store.get<RoomRequestState>('request', scope.requestId) : null
    if (!request) throw new Error('source request not found')
    const room = await this.deps.store.get<Room>('room', scope.roomId)
    const common = request.value.roomSnapshot.members.filter((member) => member.enabled && !member.removedAt &&
      room?.value.members.some((current) => current.id === member.id && current.enabled && !current.removedAt))
      .flatMap((member) => member.participantAgentId ? [member.participantAgentId] : [])
    const task = scope.taskId ? await this.deps.store.get<RoomTaskExecution>('task', scope.taskId) : null
    const actor = task ? [task.value.task.memberSnapshot, task.value.reviewer].find((member) => member?.participantAgentId === scope.participantAgentId) : request.value.roomSnapshot.members.find((member) => member.participantAgentId === scope.participantAgentId)
    return [...new Set([...common, ...(request.value.message.designatedAgentIds ?? []),
      ...(actor?.configuredReviewerAgentId ? [actor.configuredReviewerAgentId] : []), scope.participantAgentId!])]
  }
  async create(raw: unknown, origin?: HandoffOrigin): Promise<{ handoff: AgentHandoff }> {
    const input = AgentHandoffInput.parse(raw)
    const id = agentStableId('agent-handoff', input.sourceRoomId, input.sourceRootRequestId, input.senderAgentId, input.clientRequestId)
    const fingerprint = hash(input), key = id + ':create'
    const replay = await this.deps.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('handoff identity changed')
      return replay.result as { handoff: AgentHandoff }
    }
    if (!(await this.agents.features()).collaboration) throw new RoomStoreConflictError('agent collaboration is disabled')
    if (input.senderAgentId === input.recipientAgentId) throw new RoomStoreConflictError('cannot collaborate with yourself')
    const sender = await this.agents.active(input.senderAgentId), recipient = await this.agents.active(input.recipientAgentId)
    const parent = origin?.parent
    if (input.parentHandoffId && input.parentHandoffId !== parent?.id) throw new RoomStoreConflictError('handoff parent is host-bound')
    const root = await this.deps.store.get<RoomRequestState>('request', input.sourceRootRequestId)
    if (!root || root.roomId !== input.sourceRoomId || root.value.cancellationRequested) throw new Error('source request not found')
    const topic = await this.deps.store.get<RoomPeerTopic>('peer_topic', input.sourceRootRequestId)
    const request = topic?.value.requestId && topic.value.requestId !== root.id ?
      await this.deps.store.get<RoomRequestState>('request', topic.value.requestId) : root
    if (!request || request.value.cancellationRequested || topic && ['stopped', 'stopping', 'paused'].includes(topic.value.status)) {
      throw new RoomStoreConflictError('source discussion is stopped or paused')
    }
    const sourceRoom = await this.rooms.get(input.sourceRoomId)
    const sourceTask = origin?.thread.roomContext?.taskId ? await this.deps.store.get<RoomTaskExecution>('task', origin.thread.roomContext.taskId) : null
    const taskActor = sourceTask?.roomId === input.sourceRoomId ? [sourceTask.value.task.memberSnapshot, sourceTask.value.reviewer].find((member) => member?.participantAgentId === sender.id) : undefined
    if (sourceTask && !taskActor) throw new RoomStoreConflictError('task participant identity mismatch')
    const currentMember = taskActor ?? sourceRoom.members.find((member) => member.participantAgentId === sender.id && member.enabled && !member.removedAt)
    const sourceMember = taskActor ?? request.value.roomSnapshot.members.find((member) => member.participantAgentId === sender.id ||
      currentMember && member.id === currentMember.id)
    if (!parent && (!currentMember || !sourceMember)) throw new RoomStoreConflictError('sender is not a source conversation member')
    let allowedAgentIds = [...new Set([...sourceRoom.members.filter((member) => member.enabled && !member.removedAt)
      .flatMap((member) => member.participantAgentId ? [member.participantAgentId] : []),
      ...(request.value.message.designatedAgentIds ?? [])])]
    if (origin) {
      if (origin.thread.roomContext?.participantAgentId !== sender.id || !origin.thread.turns.some((turn) =>
        turn.id === origin.turnId && turn.status === 'running')) throw new RoomStoreConflictError('active sender run required')
      allowedAgentIds = await this.permitted(origin)
      if (!allowedAgentIds.includes(recipient.id)) throw new RoomStoreConflictError('recipient is not a common member or user-designated agent')
    } else allowedAgentIds = [...new Set([...allowedAgentIds, recipient.id])]
    if (parent && (!await this.current(parent.id) || parent.sourceRoomId !== input.sourceRoomId ||
      parent.sourceRootRequestId !== input.sourceRootRequestId)) throw new RoomStoreConflictError('parent handoff is no longer current')
    const pending = await this.deps.store.list('agent_handoff', { rootRequestId: input.sourceRootRequestId,
      status: ['queued', 'running', 'waiting', 'recovery_required'], limit: 33 })
    if (pending.length >= 32) throw new RoomStoreConflictError('too many pending handoffs in this topic')
    const sources: AgentHandoff['sources'] = []
    const taskSources = taskActor?.taskScopedMemory && sourceTask ? new Set(sourceTask.value.sharedMessageIds ?? [sourceTask.value.task.sourceMessageId]) : undefined
    for (const sourceId of input.sourceMessageIds) {
      if (taskSources && !taskSources.has(sourceId)) throw new RoomStoreConflictError('task participant cannot share unrelated private history')
      if (parent && !parent.sources.some((source) => source.id === sourceId)) throw new RoomStoreConflictError('child handoff cannot expand source access')
      const message = await this.deps.store.get<RoomMessage>('message', sourceId)
      if (!message || message.roomId !== input.sourceRoomId || message.value.rootRequestId !== input.sourceRootRequestId ||
        message.value.status !== 'final') throw new RoomStoreConflictError('source message is outside this topic')
      sources.push({ id: sourceId, version: message.value.bodyRevision, body: message.value.body.slice(0, 1600),
        author: message.value.authorLabelSnapshot, attachmentIds: message.value.attachmentIds })
    }
    const sourceScope = parent?.repositories ?? request.value.roomSnapshot.repositories.filter((repository) =>
      sourceMember?.allowedRepositoryIds.includes(repository.id) && currentMember?.allowedRepositoryIds.includes(repository.id))
    const repositories = sourceScope.filter((repository) => (!recipient.allowedRepositoryRoots || recipient.allowedRepositoryRoots.includes(repository.canonicalRoot)) &&
      (!sender.allowedRepositoryRoots || sender.allowedRepositoryRoots.includes(repository.canonicalRoot)))
    let requestedRepository = parent?.repositoryId ?? request.value.message.repositoryId ?? sourceMember?.defaultRepositoryId
    let workspace = parent?.workspace && repositories.some((repo) => repo.id === parent.repositoryId) ? parent.workspace :
      repositories.find((repo) => repo.id === requestedRepository)?.canonicalRoot
    if (origin?.thread.roomContext?.taskId) {
      const task = await this.deps.store.get<RoomTaskExecution>('task', origin.thread.roomContext.taskId)
      if (task?.roomId === input.sourceRoomId && repositories.some((repo) => repo.id === task.value.task.repositoryId)) { workspace = origin.thread.workspace; requestedRepository = task.value.task.repositoryId }
    }
    const pair = await openAgentPairConversation(this.agents, this.rooms, sender.id, recipient.id)
    const frozen = await this.agents.freeze(RoomSchema.parse({ ...pair.room, repositories,
      defaultMemberId: recipient.id, members: pair.room.members.map((member) => ({
        ...member, allowedRepositoryIds: repositories.map((repo) => repo.id)
      })) }))
    const now = new Date().toISOString()
    const handoff = AgentHandoffSchema.parse({ schemaVersion: 1, id, participantAgentId: recipient.id,
      sourceRoomId: input.sourceRoomId, sourceRootRequestId: input.sourceRootRequestId,
      sourceTaskId: parent?.sourceTaskId ?? sourceTask?.id, sourceTaskActorAgentId: parent?.sourceTaskActorAgentId ?? (taskActor ? sender.id : undefined),
      sourceRequestId: request.id, sourceGeneration: topic?.value.generation ?? request.value.continuation ?? 0,
      sourceRunId: origin ? roomRunId(origin.thread.roomContext!.roomId, origin.thread.turns.find((turn) => turn.id === origin.turnId)!.clientRequestId!) : undefined,
      senderAgentId: sender.id, senderMemberId: sourceMember?.id ?? parent!.senderMemberId,
      recipientAgentId: recipient.id, pairRoomId: pair.room.id,
      parentHandoffId: parent?.id, chainId: parent?.chainId ?? id, body: input.body, sources,
      allowedAgentIds, designatedAgentIds: parent?.designatedAgentIds ?? [...new Set([...(request.value.message.designatedAgentIds ?? []), ...(sourceMember?.configuredReviewerAgentId ? [sourceMember.configuredReviewerAgentId] : []), ...(taskActor ? [sender.id] : []), ...(!origin ? [recipient.id] : [])])], recipientSnapshot: frozen.members.find((member) => member.id === recipient.id),
      repositories, workspace, repositoryId: requestedRepository, attachmentIds: [...new Set(sources.flatMap((source) => source.attachmentIds))].slice(0, 20),
      status: 'queued', attempt: 0, threadId: agentStableId('agent-handoff-thread', id), clientTurnId: agentStableId('agent-handoff-turn', id, '1'),
      createdAt: now, updatedAt: now })
    const opening = RoomMessageSchema.parse({ id: id + '-opening', roomId: pair.room.id, rootRequestId: id,
      sourceRequestId: id, handoffId: id, messageSeq: 1, authorKind: 'member',
      authorMemberId: sender.id, authorAgentId: sender.id, authorLabelSnapshot: sender.name,
      body: input.body, bodyRevision: 0, mentionMemberIds: [recipient.id], attachmentIds: handoff.attachmentIds, status: 'final', createdAt: now })
    const synthetic: RoomRequestState = { id, roomId: pair.room.id, rootRequestId: id, collaborationProtocol: 'peer', status: 'completed',
      message: { clientRequestId: id, body: input.body, executionIntent: 'discussion', mentionMemberIds: [recipient.id], attachmentIds: handoff.attachmentIds },
      sourceMessageId: opening.id, roomSnapshot: frozen, threadId: handoff.threadId }
    const sourceChecks = []
    for (const source of sources) {
      const row = await this.deps.store.get<RoomMessage>('message', source.id)
      if (!row || row.value.bodyRevision !== source.version) throw new RoomStoreConflictError('source message changed')
      sourceChecks.push({ kind: 'message' as const, id: source.id, expectedRevision: row.revision })
    }
    const roomRow = await this.deps.store.get('room', sourceRoom.id)
    await this.deps.store.commit({ requestId: key, fingerprint,
      checks: [{ kind: 'agent_handoff', id, expectedRevision: null }, { kind: 'message', id: opening.id, expectedRevision: null },
        { kind: 'request', id, expectedRevision: null }, { kind: 'request', id: root.id, expectedRevision: root.revision },
        ...(request.id !== root.id ? [{ kind: 'request' as const, id: request.id, expectedRevision: request.revision }] : []),
        ...(topic ? [{ kind: 'peer_topic' as const, id: topic.id, expectedRevision: topic.revision }] : []),
        { kind: 'room', id: sourceRoom.id, expectedRevision: roomRow!.revision }, ...sourceChecks,
        { kind: 'agent_identity', id: sender.id, expectedRevision: sender.revision },
        { kind: 'agent_identity', id: recipient.id, expectedRevision: recipient.revision }],
      puts: [{ kind: 'agent_handoff', id, roomId: pair.room.id, value: handoff },
        { kind: 'message', id: opening.id, roomId: pair.room.id, value: opening },
        { kind: 'request', id, roomId: pair.room.id, value: synthetic }],
      events: [{ roomId: pair.room.id, kind: 'message.presentation.created', payload: { id: opening.id } },
        { roomId: input.sourceRoomId, kind: 'agent.handoff.updated', payload: { id } }], result: { handoff } })
    this.wake()
    return { handoff }
  }
  async action(id: string, action: 'cancel' | 'retry', input: { clientRequestId: string; expectedRevision: number }) {
    const key = agentStableId('handoff-action', id, input.clientRequestId), fingerprint = hash([action, input])
    const replay = await this.deps.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('handoff action identity changed')
      return replay.result
    }
    const row = await this.deps.store.get<AgentHandoff>('agent_handoff', id)
    if (!row) throw new Error('agent handoff not found')
    if (row.revision !== input.expectedRevision) throw new RoomStoreConflictError('handoff changed; reload before acting')
    if (action === 'retry' && (!['failed', 'cancelled', 'stale', 'budget_exhausted'].includes(row.value.status) ||
      row.value.phase !== 'settled' || !await this.current(id))) throw new RoomStoreConflictError('original execution must be settled and its source still current')
    const terminal = ['completed', 'failed', 'cancelled', 'stale', 'budget_exhausted'].includes(row.value.status)
    const handoff = AgentHandoffSchema.parse({ ...row.value,
      ...(action === 'cancel' ? terminal ? {} : { status: 'cancelled' } :
        { status: 'queued', phase: 'handoff', admissionAttempted: false, turnId: undefined, error: undefined, endedAt: undefined }),
      updatedAt: new Date().toISOString() })
    const result = { handoff, revision: row.revision + 1 }
    await this.deps.store.commit({ requestId: key, fingerprint,
      checks: [{ kind: 'agent_handoff', id, expectedRevision: row.revision }],
      puts: [{ kind: 'agent_handoff', id, roomId: row.roomId, value: handoff }],
      events: [{ roomId: handoff.sourceRoomId, kind: 'agent.handoff.updated', payload: { id } }], result })
    this.wake()
    return result
  }
}
