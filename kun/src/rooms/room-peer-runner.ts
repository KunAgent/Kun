import { agentMainModel, agentFastModel, assertAgentModel } from '../agents/agent-models.js'
import { peerBudgetMember, discussionAgentLane } from '../agents/agent-discussion-scope.js'
import { roomRunId, updateRoomRun } from './room-run-recording.js'
import { randomUUID } from 'node:crypto'
import type { Room, RoomMember } from '../contracts/rooms.js'
import type { Turn } from '../contracts/turns.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomStoredDocument } from './room-store.js'
import type { RoomPeerMemberState, RoomPeerTopic, RoomPeerUpdates } from './room-peer-types.js'
import { RoomPeerStore } from './room-peer-state.js'
import { peerId } from './room-peer-inbox.js'
import { prepareRoomPeerContext, type RoomPeerTurnContext } from './room-peer-context.js'
import { ensureRoomThread, enqueueRoomTurn, observeRoomTurn } from './room-execution.js'
import { resolveRoomRepository } from './room-router.js'
import { roomDiscussionWorkspace } from './room-context.js'
import { roomPeerTriage, RoomPeerTriageError, type RoomPeerTriageResult } from './room-peer-triage.js'
import { RoomPeerMessageInput } from './room-peer-tools.js'
import { stopRoomTaskTurn } from './room-task-activity.js'
import { RoomContextPending } from './room-rule-compression.js'
import { releasePeerActivation, updatePeerTopicStatus, recordPeerMetric, setPeerMemberWait, failPeerPreparation } from './room-peer-runner-state.js'
import { capturePeerUsageBaseline, recordPeerResponseMetric } from './room-peer-runner-metrics.js'

type TopicRow = RoomStoredDocument<RoomPeerTopic>
type MemberRow = RoomStoredDocument<RoomPeerMemberState>
type TriageRun = { controller: AbortController; promise: Promise<void>;
  result?: RoomPeerTriageResult; error?: string; failure?: RoomPeerTriageError; done: boolean }

/** The queue observes durable turns; it never runs a second agent loop. */
export class RoomPeerRunner {
  readonly state: RoomPeerStore
  private readonly triages = new Map<string, TriageRun>()
  private nextTopic = 0
  private closed = false
  constructor(private readonly deps: RoomRuntimeDeps, private readonly wake: () => void,
    private readonly options: { debounceMs?: number } = {}) {
    this.state = new RoomPeerStore(deps.store)
  }

  async close(): Promise<void> {
    this.closed = true
    for (const run of this.triages.values()) run.controller.abort()
    await Promise.allSettled([...this.triages.values()].map((run) => run.promise))
    this.triages.clear()
  }

  async registerWaiting(): Promise<void> {
    if (!this.deps.discussionFairness) return
    for (const topic of await this.state.topics()) {
      if (!['active', 'idle'].includes(topic.value.status) || !await this.state.current(topic)) continue
      if (topic.value.roomSnapshot.conversationKind === 'user_agent' && this.deps.agentDirectory && !(await this.deps.agentDirectory.features()).identities) continue
      const request = await this.deps.store.get<RoomRequestState>('request', topic.value.requestId)
      if (!request || ['failed', 'needs_input'].includes(request.value.status) || request.value.message.executionIntent !== 'discussion' && !request.value.peerCoordinationDone) continue
      for (const member of await this.state.members(topic.id)) {
        if (member.value.activation || member.value.state === 'recovery_required' ||
          member.value.state === 'failed' && (!member.value.retryAt || Date.parse(member.value.retryAt) > Date.now()) ||
          (topic.value.memberResponses[peerBudgetMember(topic.value, member.value.memberId)] ?? 0) >= 8 || topic.value.responseCount >= 32) continue
        const actor = topic.value.roomSnapshot.members.find((value) => value.id === member.value.memberId)
        if (!actor?.participantAgentId || !actor.enabled || actor.removedAt) continue
        const updates = await this.state.readUpdates(topic.id, member.value.memberId)
        if (!updates?.items.length || !await this.direct(updates, request.value) && topic.value.triageCount >= 128) continue
        this.deps.discussionFairness.waiting(actor.participantAgentId, this.userDirected(updates, request.value) ? 'user' : 'peer')
      }
    }
  }
  private userDirected(updates: RoomPeerUpdates, request: RoomRequestState): boolean {
    const addressed = request.message.mentionMemberIds.length ? request.message.mentionMemberIds : [request.roomSnapshot.defaultMemberId]
    return addressed.includes(updates.member.value.memberId) && updates.items.some((item) => item.value.sourceId === request.sourceMessageId)
  }
  async tick(externalBusy: ReadonlySet<string> = new Set()): Promise<void> {
    if (this.closed) return
    const topics = await this.state.topics()
    // Complete/reconcile first, even for paused topics. Unknown execution keeps its member occupied.
    for (const topic of topics) {
      for (const member of await this.state.members(topic.id)) {
        if (!member.value.activation) continue
        try { await this.observe(topic, member) } catch (error) {
          await this.handleError(topic, member, error)
        }
      }
      if (topic.value.status === 'stopping' && !(await this.state.members(topic.id)).some((member) => member.value.activation)) {
        await updatePeerTopicStatus(this.state, topic.id, 'stopped', 'user_stopped')
      }
    }
    const busy = new Set(externalBusy)
    const roomCounts = new Map<string, number>()
    for (const key of busy) { const roomId = key.split(':')[0]; roomCounts.set(roomId, (roomCounts.get(roomId) ?? 0) + 1) }
    for (const topic of topics) for (const member of await this.state.members(topic.id)) {
      if (!member.value.activation) continue
      const key = member.value.roomId + ':' + member.value.memberId
      if (!busy.has(key)) roomCounts.set(member.value.roomId, (roomCounts.get(member.value.roomId) ?? 0) + 1)
      busy.add(key)
      const agent = await discussionAgentLane(this.deps, member.value.roomId, member.value.memberId, topic.value.roomSnapshot)
      if (agent) busy.add(agent)
    }
    const start = this.nextTopic % Math.max(1, topics.length)
    const ordered = [...topics.slice(start), ...topics.slice(0, start)]
    this.nextTopic = (start + 1) % Math.max(1, topics.length)
    for (const original of ordered) {
      const topic = await this.state.topic(original.id)
      if (!topic || !['active', 'idle'].includes(topic.value.status) || !await this.state.current(topic)) continue
      const request = await this.deps.store.get<RoomRequestState>('request', topic.value.requestId)
      if (!request || request.value.message.executionIntent !== 'discussion' && !request.value.peerCoordinationDone) continue
      if (['needs_input', 'failed'].includes(request.value.status)) {
        await updatePeerTopicStatus(this.state, topic.id, 'paused', 'coordination_needs_attention')
        continue
      }
      const states = await this.state.members(topic.id)
      const room = await this.deps.store.get<Room>('room', topic.value.roomId)
      const identitiesDisabled = room?.value.conversationKind === 'user_agent' && this.deps.agentDirectory && !(await this.deps.agentDirectory.features()).identities
      const enabled = new Set((identitiesDisabled ? [] : room?.value.members)?.filter((member) => member.enabled && !member.removedAt).map((member) => member.id) ?? [])
      for (const member of room?.value.members ?? []) {
        if (!member.participantAgentId) continue
        const agent = await this.deps.store.get<{ archivedAt?: string }>('agent_identity', member.participantAgentId)
        if (!agent || agent.value.archivedAt) enabled.delete(member.id)
      }
      const eligible = [...states].sort((a, b) => (topic.value.memberResponses[peerBudgetMember(topic.value, a.value.memberId)] ?? 0) -
        (topic.value.memberResponses[peerBudgetMember(topic.value, b.value.memberId)] ?? 0) || a.seq - b.seq)
      for (const member of eligible) {
        const key = topic.value.roomId + ':' + member.value.memberId
        if (!member.value.activation && !enabled.has(member.value.memberId)) {
          await setPeerMemberWait(this.deps, member, 'member_unavailable')
          continue
        }
        if (!member.value.activation && (topic.value.memberResponses[peerBudgetMember(topic.value, member.value.memberId)] ?? 0) >= 8) {
          await setPeerMemberWait(this.deps, member, 'member_budget_exhausted')
          continue
        }
        const agent = await discussionAgentLane(this.deps, topic.value.roomId, member.value.memberId, topic.value.roomSnapshot)
        if (member.value.activation || busy.has(key) || Boolean(agent && busy.has(agent)) || (roomCounts.get(topic.value.roomId) ?? 0) >= 2) continue
        if (member.value.state === 'recovery_required') continue
        if (member.value.state === 'failed' && (!member.value.retryAt || Date.parse(member.value.retryAt) > Date.now())) continue
        const updates = await this.state.readUpdates(topic.id, member.value.memberId)
        if (!updates?.items.length) continue
        const direct = await this.direct(updates, request.value)
        const actorId = topic.value.roomSnapshot.members.find((value) => value.id === member.value.memberId)?.participantAgentId
        const priority = this.userDirected(updates, request.value) ? 'user' : 'peer'
        if (actorId && this.deps.discussionFairness && !this.deps.discussionFairness.canStart(actorId, priority)) continue
        if (!direct && Date.parse(updates.items[0].value.createdAt) + (this.options.debounceMs ?? 2500) > Date.now()) continue
        if (!direct && this.triages.size >= 2) continue
        try {
          const active = await this.begin(updates, direct ? 'respond' : 'triage')
          if (!active?.value.activation) continue
          if (actorId) this.deps.discussionFairness?.started(actorId, priority)
          busy.add(key)
          if (agent) busy.add(agent)
          roomCounts.set(topic.value.roomId, (roomCounts.get(topic.value.roomId) ?? 0) + 1)
          if (active.value.activation.phase === 'triage') await this.startTriage(topic, active)
          else await this.admit(topic, active)
        } catch (error) {
          await this.handleError(topic, member, error)
        }
      }
      const latestMembers = await this.state.members(topic.id)
      const latestTopic = (await this.state.topic(topic.id))!
      let active = false, runnablePending = false, disabledPending = false, budgetPending = false, failedPending = false
      for (const member of latestMembers) {
        if (member.value.activation) { active = true; continue }
        if (!(await this.state.readUpdates(topic.id, member.value.memberId))?.items.length) continue
        if (!enabled.has(member.value.memberId)) disabledPending = true
        else if ((latestTopic.value.memberResponses[peerBudgetMember(latestTopic.value, member.value.memberId)] ?? 0) >= 8) budgetPending = true
        else if (member.value.state === 'failed' && !member.value.retryAt) failedPending = true
        else runnablePending = true
      }
      if (!active && !runnablePending) {
        if (budgetPending) await updatePeerTopicStatus(this.state, topic.id, 'paused', 'budget_exhausted')
        else if (failedPending) await updatePeerTopicStatus(this.state, topic.id, 'paused', 'member_failed')
        else await updatePeerTopicStatus(this.state, topic.id, 'idle', disabledPending ? 'member_unavailable' : undefined)
      }
    }
  }

  private async direct(updates: RoomPeerUpdates, request: RoomRequestState): Promise<boolean> {
    for (const item of updates.items) {
      if (item.value.sourceKind === 'invitation') return true
      if (item.value.sourceId !== request.sourceMessageId) continue
      const addressed = request.message.mentionMemberIds.length ? request.message.mentionMemberIds : [request.roomSnapshot.defaultMemberId]
      if (addressed.includes(updates.member.value.memberId)) return true
    }
    return false
  }

  private async begin(updates: RoomPeerUpdates, phase: 'triage' | 'respond') {
    const member = updates.topic.value.roomSnapshot.members.find((entry) => entry.id === updates.member.value.memberId)!
    const prepared = await prepareRoomPeerContext(this.deps, updates, member)
    const rootId = updates.topic.id
    return this.state.begin(rootId, member.id, {
      threadId: peerId('thread', rootId, member.id, updates.topic.value.generation),
      clientRequestId: 'peer-turn-' + randomUUID(), contextId: prepared.id,
      attempt: (updates.member.value.attempt ?? 0) + 1, phase,
      itemIds: prepared.itemIds, basePublicationRevision: prepared.publicationRevision, generation: prepared.generation
    })
  }

  private async context(member: MemberRow): Promise<RoomPeerTurnContext> {
    const active = member.value.activation!
    const row = await this.deps.store.get<RoomPeerTurnContext>('context', active.contextId)
    if (!row || row.roomId !== member.value.roomId || row.value.rootRequestId !== member.value.rootRequestId ||
      row.value.memberId !== member.value.memberId) throw new Error('Peer activation context is unavailable')
    return row.value
  }

  private async startTriage(topic: TopicRow, member: MemberRow) {
    const active = member.value.activation!
    const context = await this.context(member)
    const profile = topic.value.roomSnapshot.members.find((entry) => entry.id === member.value.memberId)!
    await updateRoomRun(this.deps.store, roomRunId(topic.value.roomId, active.clientRequestId, true),
      { status: 'running', startedAt: new Date().toISOString() })
    const model = this.deps.peerModels
    if (!model) {
      await recordPeerMetric(this.deps, { id: active.clientRequestId, rootRequestId: topic.id,
        roomId: topic.value.roomId, memberId: member.value.memberId, generation: active.generation,
        phase: 'triage', outcome: 'failed' })
      await releasePeerActivation(this.deps, member, { error: 'Room participation model is unavailable', retry: false })
      return
    }
    const main = agentMainModel(this.deps, profile)
    const fast = agentFastModel(this.deps, profile, main)
    try { if (fast) await assertAgentModel(this.deps, fast, true) } catch (error) {
      await updateRoomRun(this.deps.store, roomRunId(topic.value.roomId, active.clientRequestId, true),
        { status: 'failed', outcome: 'failed', endedAt: new Date().toISOString(), error: String(error) })
      await releasePeerActivation(this.deps, member, { error: String(error), retry: false })
      return
    }
    await updateRoomRun(this.deps.store, roomRunId(topic.value.roomId, active.clientRequestId, true),
      { model: fast?.model, providerId: fast?.providerId, accountId: fast?.accountId })
    const controller = new AbortController()
    const run: TriageRun = { controller, done: false, promise: Promise.resolve() }
    this.triages.set(active.clientRequestId, run)
    run.promise = roomPeerTriage({ client: model.client, roles: fast ? { ...model.roles(), smallModel: fast.model, smallModelProviderId: fast.providerId, smallModelAccountId: fast.accountId } : model.roles(),
      mainModel: main.model, mainProviderId: main.providerId, mainAccountId: main.accountId,
      identity: active.clientRequestId, member: profile, updates: context.triageInput ?? context.prompt, signal: controller.signal
    }).then((result) => { run.result = result }, (error: unknown) => {
      run.error = error instanceof Error ? error.message : String(error)
      if (error instanceof RoomPeerTriageError) run.failure = error
    }).finally(() => { run.done = true; this.wake() })
  }

  private async admit(topic: TopicRow, member: MemberRow): Promise<void> {
    const active = member.value.activation!
    const context = await this.context(member)
    const existing = await this.deps.threads.getMetadata(active.threadId)
    const admitted = existing?.turns.find((turn) => turn.clientRequestId === active.clientRequestId)
    if (admitted) {
      if (admitted.prompt !== context.prompt || JSON.stringify(admitted.attachmentIds) !== JSON.stringify(context.attachmentIds)) {
        throw new Error('Peer admission belongs to different input')
      }
      await enqueueRoomTurn(this.deps, active.threadId, active.clientRequestId, context.prompt, context.attachmentIds, {
        requestId: topic.value.requestId, rootRequestId: topic.id, generation: active.generation, attempt: active.attempt,
        contextId: active.contextId })
      await this.state.updateActivation(topic.id, member.value.memberId, active.clientRequestId, { turnId: admitted.id })
      if (admitted.status === 'queued') this.deps.turns.notifyTurnQueued(active.threadId)
      return
    }
    if (active.admissionAttempted) {
      await this.state.fail(topic.id, member.value.memberId, active.clientRequestId, 'Original peer admission requires reconciliation', true)
      return
    }
    const participant = topic.value.roomSnapshot.members.find((entry) => entry.id === member.value.memberId)!
    await ensureRoomThread(this.deps, { id: active.threadId, roomId: topic.value.roomId,
      rootRequestId: topic.id, requestId: topic.value.requestId, collaborationProtocol: 'peer',
      member: participant, kind: 'discussion', workspace: await this.workspace(topic, participant) })
    await this.state.updateActivation(topic.id, member.value.memberId, active.clientRequestId,
      { admissionAttempted: true, ...await capturePeerUsageBaseline(this.deps, active.threadId) })
    const turnId = await enqueueRoomTurn(this.deps, active.threadId, active.clientRequestId, context.prompt, context.attachmentIds, {
      requestId: topic.value.requestId, rootRequestId: topic.id, generation: active.generation, attempt: active.attempt,
      contextId: active.contextId })
    await this.state.updateActivation(topic.id, member.value.memberId, active.clientRequestId, { turnId })
  }

  private async workspace(topic: TopicRow, member: RoomMember): Promise<string | undefined> {
    const request = await this.deps.store.get<RoomRequestState>('request', topic.value.requestId)
    if (!request) return undefined
    if (request.value.referencedTask) return roomDiscussionWorkspace(this.deps, request.value)
    const id = request.value.message.repositoryId ?? member.defaultRepositoryId
    if (!id) return undefined
    const resolved = resolveRoomRepository({ room: topic.value.roomSnapshot, memberId: member.id, explicitRepositoryId: id })
    if (!resolved.ok) throw new Error(resolved.reason)
    return topic.value.roomSnapshot.repositories.find((repository) => repository.id === resolved.repositoryId)?.canonicalRoot
  }

  private async observe(topic: TopicRow, member: MemberRow): Promise<void> {
    const active = member.value.activation!
    const current = await this.state.topic(topic.id)
    const invalid = !current || active.generation !== current.value.generation ||
      ['stopping', 'stopped'].includes(current.value.status) || !await this.state.current(current, member.value.memberId)
    if (active.phase === 'triage') {
      const run = this.triages.get(active.clientRequestId)
      if (invalid) {
        run?.controller.abort()
        if (run && !run.done) return
        if (run) {
          const accounting = run.result ?? run.failure
          await recordPeerMetric(this.deps, { id: active.clientRequestId, roomId: topic.value.roomId,
            rootRequestId: topic.id, memberId: member.value.memberId, phase: 'triage', outcome: 'cancelled',
            generation: active.generation, model: accounting?.model, elapsedMs: accounting?.elapsedMs, usage: accounting?.usage }).catch(() => undefined)
        }
        await updateRoomRun(this.deps.store, roomRunId(topic.value.roomId, active.clientRequestId, true),
          { status: 'cancelled', outcome: 'cancelled', endedAt: new Date().toISOString() })
        this.triages.delete(active.clientRequestId)
        await releasePeerActivation(this.deps, member)
        return
      }
      if (!run) {
        await releasePeerActivation(this.deps, member, { error: 'Participation check interrupted before acknowledgement', retry: true })
        return
      }
      if (!run.done) return
      this.triages.delete(active.clientRequestId)
      const result = run.result
      const accounting = result ?? run.failure
      await updateRoomRun(this.deps.store, roomRunId(topic.value.roomId, active.clientRequestId, true), {
        status: result ? 'completed' : 'failed', outcome: result?.action === 'skip' ? 'skipped' : result?.action ?? 'failed',
        reason: result?.reason, error: run.error?.slice(0, 4000), endedAt: new Date().toISOString(),
        model: accounting?.model, usage: accounting?.usage, elapsedMs: accounting?.elapsedMs })
      await recordPeerMetric(this.deps, { id: active.clientRequestId, roomId: topic.value.roomId,
        rootRequestId: topic.id, memberId: member.value.memberId, phase: 'triage', outcome: result?.action ?? 'failed',
        generation: active.generation, model: accounting?.model, elapsedMs: accounting?.elapsedMs, usage: accounting?.usage }).catch(() => undefined)
      if (!result) {
        await releasePeerActivation(this.deps, member, { error: run.error ?? 'Participation check failed', retry: true })
      } else if (result.action === 'skip') await this.state.skip(topic.id, member.value.memberId, active.clientRequestId)
      else {
        const promoted = await this.state.updateActivation(topic.id, member.value.memberId, active.clientRequestId, { phase: 'respond' })
        if (promoted?.value.activation?.phase === 'respond') await this.admit(topic, promoted)
        else await releasePeerActivation(this.deps, member)
      }
      return
    }
    if (!active.turnId) {
      if (!invalid) await this.admit(topic, member)
      else await this.stopActivation(topic, member)
      return
    }
    const observed = await observeRoomTurn(this.deps, active.threadId, active.turnId)
    if (invalid) { await this.stopActivation(topic, member); return }
    if (observed.status === 'running' || observed.status === 'queued') return
    if (observed.status === 'missing') {
      await this.state.fail(topic.id, member.value.memberId, active.clientRequestId, 'Original peer turn is unavailable', true)
      return
    }
    if (observed.status !== 'completed') {
      await recordPeerResponseMetric(this.deps, topic.value, member, 'failed', observed.turn)
      await releasePeerActivation(this.deps, member, { error: observed.error ?? 'Member response failed', retry: true })
      return
    }
    if (observed.resultError && observed.structured === undefined) throw new Error(observed.resultError)
    const submitted = RoomPeerMessageInput.parse(observed.structured ?? {
      body: observed.text.trim(), skip: !observed.text.trim()
    })
    if (submitted.skip) {
      await this.state.skip(topic.id, member.value.memberId, active.clientRequestId)
      await recordPeerResponseMetric(this.deps, topic.value, member, 'skipped', observed.turn)
    }
    else {
      const context = await this.context(member)
      const result = await this.state.publish({ rootRequestId: topic.id, memberId: member.value.memberId,
        clientRequestId: active.clientRequestId, activationClientRequestId: active.clientRequestId,
        ...submitted, replyToMessageId: submitted.replyToMessageId ?? context.replyToMessageId })
      if (result.status === 'stale') {
        await updateRoomRun(this.deps.store, roomRunId(topic.value.roomId, active.clientRequestId), { status: 'completed', outcome: 'stale' })
        await releasePeerActivation(this.deps, member)
      }
      if (result.status === 'stopped') await this.stopActivation(topic, member)
      await recordPeerResponseMetric(this.deps, topic.value, member, result.status, observed.turn, result.message)
    }
  }

  private async handleError(topic: TopicRow, member: MemberRow, error: unknown): Promise<void> {
    const current = await this.state.member(topic.id, member.value.memberId)
    if (!current) return
    if (error instanceof RoomContextPending) {
      if (!current.value.activation) await setPeerMemberWait(this.deps, current, 'context_compression')
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    const active = current.value.activation
    if (!active) {
      // Publication may have committed before a telemetry write failed. It is already handled.
      if (!member.value.activation) await failPeerPreparation(this.deps, current, message)
      return
    }
    let stopped = active.phase === 'triage' || !active.admissionAttempted && !active.turnId
    let turn: Turn | undefined
    if (active.phase === 'triage') {
      const run = this.triages.get(active.clientRequestId)
      if (run && !run.done) { run.controller.abort(); return }
      this.triages.delete(active.clientRequestId)
    } else if (!stopped) {
      try {
        const thread = await this.deps.threads.getMetadata(active.threadId)
        turn = active.turnId ? thread?.turns.find((entry) => entry.id === active.turnId) :
          thread?.turns.find((entry) => entry.clientRequestId === active.clientRequestId)
        stopped = Boolean(turn && !['queued', 'running'].includes(turn.status)) ||
          !turn && await this.deps.proveStopped?.(active.threadId, active.turnId) === true
        if (thread?.turns.some((entry) => entry.id !== turn?.id && ['queued', 'running'].includes(entry.status)) ||
          this.deps.backgroundExecutionActive?.(active.threadId)) stopped = false
      } catch { stopped = false }
    }
    if (!stopped) {
      await this.state.fail(topic.id, current.value.memberId, active.clientRequestId, message, true)
      return
    }
    if (active.phase === 'respond') await recordPeerResponseMetric(this.deps, topic.value, current, 'failed', turn).catch(() => undefined)
    else await recordPeerMetric(this.deps, { id: active.clientRequestId, roomId: topic.value.roomId,
      rootRequestId: topic.id, memberId: current.value.memberId, generation: active.generation,
      phase: 'triage', outcome: 'failed' }).catch(() => undefined)
    await releasePeerActivation(this.deps, current, { error: message, retry: true })
  }

  private async stopActivation(topic: TopicRow, member: MemberRow): Promise<void> {
    const active = member.value.activation!
    const thread = await this.deps.threads.getMetadata(active.threadId)
    const turn = active.turnId ? thread?.turns.find((entry) => entry.id === active.turnId) :
      thread?.turns.find((entry) => entry.clientRequestId === active.clientRequestId)
    if (turn && ['queued', 'running'].includes(turn.status)) {
      await stopRoomTaskTurn(this.deps, active.threadId, turn.id)
      return
    }
    if (!turn && active.admissionAttempted && !await this.deps.proveStopped?.(active.threadId, active.turnId)) {
      await this.state.fail(topic.id, member.value.memberId, active.clientRequestId, 'Cannot prove the original response has stopped', true)
      return
    }
    if (this.deps.backgroundExecutionActive?.(active.threadId)) return
    await updateRoomRun(this.deps.store, roomRunId(topic.value.roomId, active.clientRequestId),
      { status: 'cancelled', outcome: 'cancelled', endedAt: new Date().toISOString() })
    await releasePeerActivation(this.deps, member)
  }
}
