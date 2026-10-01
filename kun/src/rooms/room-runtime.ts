import { reconcileRoomNotificationGates } from './room-notification-observer.js'
import { AgentCommitmentService } from '../agents/agent-commitment-service.js'
import { AgentArtifactLibrary, bindAgentArtifactLibrary } from '../agents/agent-artifact-library.js'
import { bindAgentCommitmentService } from '../agents/agent-commitment-tools.js'
import { RoomTaskDueQueue } from './room-task-due-queue.js'
import { AgentDirectRunner } from '../agents/agent-direct-runner.js'
import { AgentDiscussionFairness } from '../agents/agent-discussion-fairness.js'
import { AgentHandoffService } from '../agents/agent-handoff-service.js'
import { AgentHandoffRunner } from '../agents/agent-handoff-runner.js'
import { bindAgentHandoffService } from '../agents/agent-handoff-tools.js'
import { bindAgentSetupDirectory } from '../agents/agent-setup-tools.js'
import { discussionAgentLane } from '../agents/agent-discussion-scope.js'
import { AgentMemoryCoordinator } from '../agents/agent-memory-coordinator.js'
import { AgentMemoryService } from '../agents/agent-memory-service.js'
import { AgentIdentityService } from '../agents/agent-identity-service.js'
import { isHiddenAgentSetupMessage } from '../agents/agent-setup.js'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomDelivery, RoomReview } from '../contracts/room-deliveries.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { RoomRequestRunner } from './room-request-runner.js'
import { RoomTaskRunner } from './room-task-runner.js'
import { roomTaskAction } from './room-task-actions.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import type { RoomStore, RoomListOptions } from './room-store.js'
import { roomTaskActivity } from './room-task-activity.js'
import { RoomProductService } from './room-product-service.js'
import { RoomIntegrationService } from './room-integration.js'
import { roomActivitySummary } from './room-activity-summary.js'
import { RoomContextPending } from './room-rule-compression.js'
import { RoomPeerRunner } from './room-peer-runner.js'
import { bindRoomPeerStore } from './room-peer-tools.js'
import { bindImMessageService } from './room-im-message-tool.js'
import { roomPeerTopicPage, roomPeerMetricPage, stopRoomPeerTopic, deliverRoomPeerTaskProgress } from './room-peer-api.js'
import { roomDiscussionBusy, roomRequestDiscussionTarget, cancelSupersededRoomRequest } from './room-discussion-scheduler.js'
import { pendingPeerRoomAmendment } from './room-peer-dispatch-guard.js'
import { isRoomRouteReason, roomRouteMessage } from './room-router.js'
import { bindRoomContinuationDispatcher } from './room-continuation-dispatch.js'
import { enqueuePrivateContinuation } from './room-continuation-service.js'
import { fireDueRoomReminders } from './room-reminders.js'
import { bindRoomReminderWake } from './room-reminder-tools.js'
import { WorkbenchBridge, bindWorkbenchBridge } from '../workbench-bridge/bridge.js'
import { reconcileWorkbench } from '../workbench-bridge/reconcile.js'

/** A tick reports whether live work remains and, when idle, the next scheduled wake time. */
type RoomTickOutcome = { active: boolean; nextWakeAt?: number; catchUp?: boolean }

const ACTIVE_TICK_MS = 1_000
const IDLE_TICK_MS = 15_000

export class RoomRuntime {
  private readonly memoryCapture: AgentMemoryCoordinator
  readonly agentMemory: AgentMemoryService
  readonly handoffs: AgentHandoffService
  private readonly handoffRunner: AgentHandoffRunner
  readonly agents: AgentIdentityService
  readonly commitments: AgentCommitmentService
  readonly artifactLibrary: AgentArtifactLibrary
  readonly service: RoomService
  readonly product: RoomProductService
  readonly integrations: RoomIntegrationService
  readonly peers: RoomPeerRunner
  /** Code/Work hand-offs for private Agents: tools, durable links and outcome delivery. */
  readonly workbench: WorkbenchBridge
  private readonly direct: AgentDirectRunner
  private readonly requests: RoomRequestRunner
  private readonly taskDue: RoomTaskDueQueue
  private readonly taskSubscriptions = new Map<string, () => void>()
  private readonly taskOccupied = new Map<string, boolean>()
  private readonly taskActions = new Map<string, Promise<unknown>>()
  private readonly tasks: RoomTaskRunner
  private timer?: ReturnType<typeof setTimeout>
  private stopped = true
  private inFlight?: Promise<void>
  private wakeQueued = false
  private actionQueue: Promise<unknown> = Promise.resolve()
  private requestCursor?: number
  private readonly executionService: RoomService
  private readonly unbindContinuations: () => void

  constructor(readonly deps: RoomRuntimeDeps, private readonly held: () => boolean = () => true,
    apiStore: RoomStore = deps.store) {
    void apiStore
    deps.discussionFairness ??= new AgentDiscussionFairness()
    this.agents = new AgentIdentityService(deps.store, deps.profiles, async (members) => {
      if (!deps.validateAgentAvatars) throw new Error('avatar storage unavailable')
      await deps.validateAgentAvatars(members)
    })
    this.agentMemory = new AgentMemoryService(this.agents, () => deps.memoryStore, deps.memoryEnabled)
    deps.agentMemory = this.agentMemory
    this.memoryCapture = new AgentMemoryCoordinator(deps)
    this.service = new RoomService(deps.store, () => this.wake())
    this.service.setAgentDirectory(this.agents)
    this.commitments = new AgentCommitmentService(deps, this.agents)
    this.artifactLibrary = new AgentArtifactLibrary(deps)
    bindAgentCommitmentService(deps.threadStore, this.commitments)
    bindAgentArtifactLibrary(deps.threadStore, this.artifactLibrary)
    deps.agentDirectory = this.agents
    this.executionService = new RoomService(deps.store, () => this.wake())
    this.executionService.setAgentDirectory(this.agents)
    this.handoffs = new AgentHandoffService(deps, this.agents, this.service, () => this.wake())
    deps.agentHandoffs = this.handoffs
    this.handoffRunner = new AgentHandoffRunner(this.handoffs)
    bindAgentHandoffService(deps.threadStore, this.handoffs)
    bindAgentSetupDirectory(deps.threadStore, this.agents)
    this.product = new RoomProductService(deps, this.service)
    this.integrations = new RoomIntegrationService(deps)
    this.direct = new AgentDirectRunner(deps, this.executionService)
    this.requests = new RoomRequestRunner(deps, this.executionService)
    this.tasks = new RoomTaskRunner(deps, this.executionService)
    this.taskDue = new RoomTaskDueQueue(deps.store)
    this.peers = new RoomPeerRunner(deps, () => this.wake())
    bindRoomPeerStore(deps.threadStore, deps.store)
    bindRoomReminderWake(deps.threadStore, () => this.wake())
    bindImMessageService(deps.threadStore, this.executionService)
    this.workbench = new WorkbenchBridge(deps, this.executionService, () => this.wake())
    bindWorkbenchBridge(deps.threadStore, this.workbench)
    this.unbindContinuations = bindRoomContinuationDispatcher(deps.threadStore, (input) =>
      this.exclusive(async () => {
        if (this.stopped || !this.held()) throw new Error('Room continuation owner is temporarily unavailable')
        const result = await enqueuePrivateContinuation(this.deps, input)
        this.wake()
        return result
      }))
  }
  start() { this.stopped = false; this.wake() }
  /**
   * Immediate wake: a pending idle timer is cancelled so new room work never
   * waits out the backoff window. A wake arriving mid-tick is queued and
   * drains as soon as the current pass ends.
   */
  wake() {
    if (this.stopped) return
    if (this.inFlight) { this.wakeQueued = true; return }
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    this.timer = setTimeout(() => { this.timer = undefined; this.runTick() }, 0)
    this.timer.unref?.()
  }
  private runTick(): void {
    this.inFlight = this.tick().catch((error) => {
      console.warn('[kun] room coordinator:', error instanceof Error ? error.message : String(error))
      const outcome: RoomTickOutcome = { active: true }
      return outcome
    }).then((outcome) => {
      if (this.stopped) return
      this.timer = setTimeout(() => { this.timer = undefined; if (!this.stopped) this.runTick() }, this.nextDelay(outcome))
      this.timer.unref?.()
    }).finally(() => {
      this.inFlight = undefined
      if (this.wakeQueued) { this.wakeQueued = false; this.wake() }
    })
  }
  /**
   * Active work keeps the one-second cadence. Idle passes wait up to fifteen
   * seconds, bounded by the nearest scheduled reminder so it still fires on
   * time. A past-due reminder keeps a prompt one-second retry floor instead of
   * a hot loop.
   */
  private nextDelay(outcome: RoomTickOutcome): number {
    // Yield between bounded replay/bootstrap pages instead of waiting one second per page.
    if (outcome.catchUp) return 10
    if (outcome.active) return ACTIVE_TICK_MS
    if (outcome.nextWakeAt === undefined) return IDLE_TICK_MS
    return Math.min(IDLE_TICK_MS, Math.max(ACTIVE_TICK_MS, outcome.nextWakeAt - Date.now()))
  }
  async close() {
    this.stopped = true
    this.unbindContinuations()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.inFlight
    for (const unsubscribe of this.taskSubscriptions.values()) unsubscribe()
    this.taskSubscriptions.clear()
    await this.peers.close()
    await this.memoryCapture.close()
    await this.actionQueue.catch(() => undefined)
    await Promise.allSettled(this.taskActions.values())
  }
  async action(roomId: string, id: string, action: string, input: unknown) {
    this.taskDue.invalidate(id)
    const run = this.taskExclusive(id, async () => {
      const result = await roomTaskAction(this.deps, roomId, id, action, input)
      const row = await this.deps.store.get<RoomTaskExecution>('task', id)
      if (row) await this.product.summarizeRequests([row.value])
      return result
    })
    try { return await run } finally { this.taskDue.invalidate(id); this.wake() }
  }
  taskExclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const run = (this.taskActions.get(id) ?? Promise.resolve()).catch(() => undefined).then(operation)
    this.taskActions.set(id, run)
    void run.finally(() => { if (this.taskActions.get(id) === run) this.taskActions.delete(id) }).catch(() => undefined)
    return run
  }
  notifyThread(threadId: string) { this.taskDue.invalidateThread(threadId); this.wake() }
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.actionQueue.catch(() => undefined).then(operation)
    this.actionQueue = run
    return run
  }
  peerTopics(roomId: string, limit: number, cursor?: number) {
    return roomPeerTopicPage(this.peers.state, roomId, limit, cursor)
  }
  peerMetrics(roomId: string, rootRequestId: string, limit: number, cursor?: number) {
    return roomPeerMetricPage(this.peers.state, roomId, rootRequestId, limit, cursor)
  }
  async stopPeerTopic(roomId: string, rootRequestId: string, input: unknown) {
    try { return await this.exclusive(() => stopRoomPeerTopic(this.deps, this.peers.state, roomId, rootRequestId, input)) }
    finally { this.wake() }
  }
  async taskDetail(roomId: string, taskId: string, includeDiff = true) {
    const row = await this.deps.store.get<RoomTaskExecution>('task', taskId)
    if (!row || row.roomId !== roomId) throw new Error('task not found')
    const task = { ...row.value.task, revision: row.revision }
    const delivery = task.latestDeliveryId ? (await this.deps.store.get<RoomDelivery>('delivery', task.latestDeliveryId))?.value : undefined
    const controlThreadId = task.stage === 'review' ? row.value.reviewThreadId : task.executionThreadId
    return { task, delivery, workspace: (await this.deps.store.get<RoomWorkspace>('workspace', task.workspaceId))?.value,
      reviews: (await this.deps.store.list<RoomReview>('review', { taskId, limit: 100 })).map((row) => row.value),
      diff: delivery && includeDiff ? (await this.deps.store.get<string>('artifact', delivery.diffArtifactId))?.value : undefined,
      agreements: row.value.agreements ?? row.value.contextSnapshot?.agreements,
      controlThreadId,
      approvals: controlThreadId ? this.deps.approvals.pending(controlThreadId) : [],
      userInputs: controlThreadId ? this.deps.inputs.pending(controlThreadId) : [] }
  }
  async listRooms(input: RoomListOptions) {
    const page = await this.service.store.listRooms(input)
    return { rooms: await Promise.all(page.rooms.map(async (row) => {
      const { runningCount, attentionCount } = await roomActivitySummary(this.service.store, row.id)
      return { ...await this.agents.present(row.value), revision: row.revision, latestMessageSeq: row.latestMessageSeq,
        ...(row.latestMessage ? { latestMessage: row.latestMessage } : {}),
        readSeq: (await this.service.store.get<{ seq: number }>('read_state', row.id))?.value.seq ?? 0,
        runningCount, attentionCount }
    })), nextCursor: page.nextCursor }
  }
  async messages(roomId: string, limit: number, cursor?: number) {
    await this.service.get(roomId)
    const rows = await this.deps.store.list<RoomMessage>('message', { roomId, limit, beforeSeq: cursor })
    return { messages: [...rows].reverse().filter((row) => !isHiddenAgentSetupMessage(row.value)).map((row) => ({ ...row.value, messageSeq: row.seq })),
      nextCursor: rows.length === limit ? String(rows.at(-1)!.seq) : undefined }
  }

  private async tickRequest(row: import('./room-store.js').RoomStoredDocument<RoomRequestState>, discussionBusy: Set<string>) {
    const current = await this.deps.store.get<RoomRequestState>('request', row.id)
    if (!current || current.revision !== row.revision) return
      try {
        if (row.value.handoffReturnId && !await this.handoffs.current(row.value.handoffReturnId)) {
          await cancelSupersededRoomRequest(this.deps, row.id); return
        }
        if (!row.value.privateProtocol && row.value.collaborationProtocol === 'peer') {
          if (await pendingPeerRoomAmendment(this.deps, row.value)) {
            await this.requests.tick(row)
            return
          }
          const topic = await this.peers.state.initialize(row.value)
          if (!topic || topic.value.requestId !== row.id) {
            await cancelSupersededRoomRequest(this.deps, row.id)
            return
          }
          if (row.value.cancellationRequested) await this.peers.state.stop(topic.id)
        }
        const target = roomRequestDiscussionTarget(row.value)
        const directPeerDiscussion = row.value.collaborationProtocol === 'peer' && row.value.message.executionIntent === 'discussion'
        if (target && !target.turnId && !target.admissionAttempted && !row.value.cancellationRequested && !directPeerDiscussion) {
          if (row.value.roomSnapshot.conversationKind === 'user_agent' && !(await this.agents.features()).identities) return
          const key = row.value.roomId + ':' + target.memberId
          const agent = await discussionAgentLane(this.deps, row.value.roomId, target.memberId, row.value.roomSnapshot)
          if (agent) {
            const identity = await this.deps.store.get<{ archivedAt?: string }>('agent_identity', agent.slice('agent:'.length))
            if (!identity || identity.value.archivedAt) return
          }
          const priority = row.value.handoffReturnId ? 'peer' : 'user'
          const busy = (agent && !this.deps.discussionFairness!.canStart(agent.slice('agent:'.length), priority)) ||
            discussionBusy.has(key) || Boolean(agent && discussionBusy.has(agent)) ||
            [...discussionBusy].filter((item) => item.startsWith(row.value.roomId + ':')).length >= 2
          if (busy) {
            // Plain user messages can steer the existing private turn without
            // claiming another lane; the runner still checks exact authority.
            if (row.value.privateProtocol) await this.direct.tick(row, false)
            return
          }
          discussionBusy.add(key)
          if (agent) { discussionBusy.add(agent); this.deps.discussionFairness!.started(agent.slice('agent:'.length), priority) }
        }
        if (row.value.privateProtocol) await this.direct.tick(row)
        else await this.requests.tick(row)
      } catch (error) {
        if (error instanceof RoomContextPending) return
        const current = await this.deps.store.get<RoomRequestState>('request', row.id)
        if (!current || current.revision !== row.revision) return
        const raw = error instanceof Error ? error.message : String(error)
        const clarify = isRoomRouteReason(raw)
        const message = clarify ? roomRouteMessage(raw) : raw
        const dispatchedAmendment = await pendingPeerRoomAmendment(this.deps, row.value)
        // Retry an interrupted admitted operation once; retain its receipt for an explicit retry after persistent failure.
        const status = dispatchedAmendment ? row.value.status === 'recovery_required' ? 'needs_input' : 'recovery_required'
          : clarify ? 'needs_input' : 'failed'
        if (!row.value.privateProtocol) {
          await this.executionService.append(row.roomId!, 'error-' + row.id, message,
            clarify ? row.value.roomSnapshot.defaultMemberId : undefined)
        }
        await putRoomDocument(this.deps.store, 'request', row.id, row.roomId!,
          { ...row.value, status, error: message, ...(clarify ? { clarification: message } : {}) }, row)
      }
  }

  private async tick(): Promise<RoomTickOutcome> {
    if (!this.held()) return { active: false }
    await this.deps.assertOwnership()
    await this.agents.initialize()
    const outcome: RoomTickOutcome = { active: await this.memoryCapture.tick() }
    try { await reconcileRoomNotificationGates(this.deps) }
    catch (error) {
      console.warn('[kun] room notification reconciliation:', error instanceof Error ? error.message : String(error))
      outcome.active = true
    }
    try {
      const reminders = await this.exclusive(() => fireDueRoomReminders(this.deps, this.service, new Date().toISOString()))
      if (reminders.fired) outcome.active = true
      if (reminders.nextFireAt) outcome.nextWakeAt = Date.parse(reminders.nextFireAt)
    } catch (error) {
      // A transient store failure retries at the active cadence like before.
      console.warn('[kun] room reminders:', error instanceof Error ? error.message : String(error))
      outcome.active = true
    }
    try {
      if (await this.exclusive(() => reconcileWorkbench(this.workbench))) outcome.active = true
      if (this.workbench.nextWakeAt !== undefined) outcome.nextWakeAt = Math.min(outcome.nextWakeAt ?? Infinity, this.workbench.nextWakeAt)
    } catch (error) {
      console.warn('[kun] workbench bridge:', error instanceof Error ? error.message : String(error))
      outcome.active = true
    }
    const requests = await this.deps.store.list<RoomRequestState>('request', {
      status: ['pending', 'running', 'stopping', 'recovery_required'], limit: 100, order: 'asc', afterSeq: this.requestCursor })
    if (requests.length) outcome.active = true
    this.requestCursor = requests.length === 100 ? requests.at(-1)!.seq : undefined
    this.deps.discussionFairness!.resetWaiting()
    await this.handoffRunner.registerWaiting()
    await this.peers.registerWaiting()
    for (const row of requests) {
      if (row.value.roomSnapshot.conversationKind === 'user_agent' && !(await this.agents.features()).identities) continue
      const target = roomRequestDiscussionTarget(row.value)
      const actor = row.value.roomSnapshot.members.find((member) => member.id === target?.memberId)
      if (actor?.participantAgentId && !target?.turnId && !target?.admissionAttempted) {
        this.deps.discussionFairness!.waiting(actor.participantAgentId, row.value.handoffReturnId ? 'peer' : 'user')
      }
    }
    if (await this.exclusive(() => this.handoffRunner.tick(new Set(), false))) outcome.active = true
    const discussionBusy = new Set([...await roomDiscussionBusy(this.deps, true), ...await this.handoffRunner.busy()])
    for (const row of requests) {
      if (this.stopped) return { active: true }
      await this.exclusive(() => this.tickRequest(row, discussionBusy))
    }
    const now = Date.now()
    await this.taskDue.refresh(now)
    const taskRows = this.taskDue.all()
    const taskIds = new Set(taskRows.map((row) => row.id))
    for (const id of this.taskOccupied.keys()) if (!taskIds.has(id)) this.taskOccupied.delete(id)
    const dueTaskRows = this.taskDue.due(now)
    const dueTaskIds = new Set(dueTaskRows.map((row) => row.id))
    const taskThreads = new Set(taskRows.flatMap((row) => [row.value.task.executionThreadId, row.value.reviewThreadId].filter((id): id is string => Boolean(id))))
    if (this.deps.eventBus) for (const id of taskThreads) {
      if (!this.taskSubscriptions.has(id)) this.taskSubscriptions.set(id, this.deps.eventBus.subscribe(id, (event) => {
        if (['approval_resolved', 'user_input_resolved', 'turn_completed', 'turn_failed', 'turn_aborted'].includes(event.kind)) this.notifyThread(id)
      }))
    }
    for (const [id, unsubscribe] of this.taskSubscriptions) if (!taskThreads.has(id)) { unsubscribe(); this.taskSubscriptions.delete(id) }
    if (this.taskDue.backlogged) { outcome.active = true; outcome.catchUp = true }
    const activeTurn = (execution: RoomTaskExecution) => execution.task.stage === 'review' ?
      execution.completedReviewRunId === execution.reviewThreadId ? undefined : execution.reviewTurnId : execution.turnId
    const actingMember = (execution: RoomTaskExecution) => execution.task.stage === 'review' ?
      execution.reviewer?.id ?? execution.task.ownerMemberId : execution.task.ownerMemberId
    let occupied = 0
    const occupiedByRoom = new Map<string, number>()
    const roomLimits = new Map<string, number>()
    const claimRoom = (roomId: string) => occupiedByRoom.set(roomId, (occupiedByRoom.get(roomId) ?? 0) + 1)
    const roomHasCapacity = async (roomId: string) => {
      if (!roomLimits.has(roomId)) {
        const room = await this.deps.store.get<Room>('room', roomId)
        roomLimits.set(roomId, room?.value.maxConcurrentTasks ?? 2)
      }
      return (occupiedByRoom.get(roomId) ?? 0) < roomLimits.get(roomId)!
    }
    const busyMembers = new Set<string>()
    const integrations = await this.integrations.active()
    // The active() scan only returns in-flight integration stages.
    if (integrations.length) outcome.active = true
    const activeIntegrations = new Set<string>()
    const integrationMembers = new Map<string, string>()
    for (const row of integrations) {
      const task = await this.deps.store.get<RoomTaskExecution>('task', row.value.taskId)
      const member = row.roomId + ':' + (row.value.runKind === 'review' ? task?.value.reviewer?.id : task?.value.task.ownerMemberId)
      integrationMembers.set(row.id, member)
      try {
        if (await this.integrations.activity(row.value) !== 'idle') {
          activeIntegrations.add(row.id); occupied++; claimRoom(row.roomId!); busyMembers.add(member)
        }
      } catch { activeIntegrations.add(row.id); occupied++; claimRoom(row.roomId!); busyMembers.add(member) }
    }
    const occupiedTasks = new Set<string>()
    for (const row of taskRows) {
      const execution = row.value
      const uncertain = execution.task.status === 'recovery_required' ||
        (!activeTurn(execution) && execution.task.status !== 'waiting_dependency')
      const isOccupied = uncertain ? (!dueTaskIds.has(row.id) && this.taskOccupied.has(row.id) ? this.taskOccupied.get(row.id)!
        : (await roomTaskActivity(this.deps, execution)).state !== 'idle') : Boolean(activeTurn(execution))
      this.taskOccupied.set(row.id, isOccupied)
      if (!isOccupied) continue
      occupied += 1
      claimRoom(row.roomId!)
      occupiedTasks.add(row.id)
      busyMembers.add(row.roomId + ':' + actingMember(execution))
    }
    for (const row of dueTaskRows) {
      if (this.stopped) return { active: true }
      if (row.value.task.status === 'needs_input' && row.value.task.stage === 'review' &&
        row.value.completedReviewRunId && row.value.completedReviewRunId === row.value.reviewThreadId) continue
      const member = row.roomId + ':' + actingMember(row.value)
      const canStart = this.taskDue.ready && occupied < (this.deps.maxConcurrentTasks ?? 2) && !busyMembers.has(member) && await roomHasCapacity(row.roomId!)
      try {
        await this.taskExclusive(row.id, async () => {
          const current = await this.deps.store.get<RoomTaskExecution>('task', row.id)
          if (current) await this.tasks.tick(current, canStart)
        })
      } catch (error) { await this.tasks.fail(row, error) }
      this.taskDue.observed(await this.deps.store.get<RoomTaskExecution>('task', row.id) ?? row, now)
      if (canStart && !occupiedTasks.has(row.id)) {
        // Admission can succeed before saving its receipt fails. Reconcile the
        // original identity before allowing a later task to use this slot.
        const current = await this.deps.store.get<RoomTaskExecution>('task', row.id)
        const execution = current?.value ?? row.value
        if ((await roomTaskActivity(this.deps, execution)).state !== 'idle') {
          occupied += 1
          claimRoom(row.roomId!)
          occupiedTasks.add(row.id)
          busyMembers.add(row.roomId + ':' + actingMember(execution))
        }
      }
    }
    await this.product.summarizeRequests(dueTaskRows.map((row) => row.value))
    for (const row of integrations) {
      if (this.stopped) return { active: true }
      const member = integrationMembers.get(row.id)!
      const allowStart = this.taskDue.ready && occupied < (this.deps.maxConcurrentTasks ?? 2) && !busyMembers.has(member) && await roomHasCapacity(row.roomId!)
      await this.taskExclusive(row.value.taskId, async () => {
        const current = await this.deps.store.get<typeof row.value>('integration', row.id)
        if (current) await this.integrations.tick(current, allowStart)
      })
      if (allowStart && !activeIntegrations.has(row.id)) {
        const current = await this.integrations.get(row.value.roomId, row.value.taskId, row.id)
        if (await this.integrations.activity(current.value) !== 'idle') { occupied++; claimRoom(row.roomId!); busyMembers.add(member) }
      }
    }
    const nextTaskWake = this.taskDue.nextWakeAt
    if (nextTaskWake !== undefined) outcome.nextWakeAt = Math.min(outcome.nextWakeAt ?? Infinity, nextTaskWake)
    await this.exclusive(() => deliverRoomPeerTaskProgress(this.deps, this.peers.state))
    if (await this.exclusive(async () => this.peers.tick(new Set([...await roomDiscussionBusy(this.deps), ...await this.handoffRunner.busy()])))) outcome.active = true
    if (await this.exclusive(async () => this.handoffRunner.tick(await roomDiscussionBusy(this.deps, true)))) outcome.active = true
    return outcome
  }
}
