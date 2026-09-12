import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomDelivery, RoomReview } from '../contracts/room-deliveries.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { RoomRequestRunner } from './room-request-runner.js'
import { RoomTaskRunner } from './room-task-runner.js'
import { roomTaskAction } from './room-task-actions.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import type { RoomStore } from './room-store.js'

export class RoomRuntime {
  readonly service: RoomService
  private readonly requests: RoomRequestRunner
  private readonly tasks: RoomTaskRunner
  private timer?: ReturnType<typeof setTimeout>
  private stopped = true
  private inFlight?: Promise<void>
  private actionQueue: Promise<unknown> = Promise.resolve()
  private readonly executionService: RoomService

  constructor(readonly deps: RoomRuntimeDeps, private readonly held: () => boolean = () => true,
    apiStore: RoomStore = deps.store) {
    this.service = new RoomService(apiStore, () => this.wake())
    this.executionService = new RoomService(deps.store, () => this.wake())
    this.requests = new RoomRequestRunner(deps, this.executionService)
    this.tasks = new RoomTaskRunner(deps, this.executionService)
  }
  start() { this.stopped = false; this.wake() }
  wake() {
    if (this.stopped || this.timer || this.inFlight) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.inFlight = this.exclusive(() => this.tick()).catch((error) => {
        console.warn('[kun] room coordinator:', error instanceof Error ? error.message : String(error))
      }).finally(() => {
        this.inFlight = undefined
        if (!this.stopped) this.timer = setTimeout(() => { this.timer = undefined; this.wake() }, 1000)
      })
    }, 0)
    this.timer.unref?.()
  }
  async close() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.inFlight
    await this.actionQueue.catch(() => undefined)
  }
  async action(roomId: string, id: string, action: string, input: unknown) {
    const run = this.exclusive(() => roomTaskAction(this.deps, roomId, id, action, input))
    try { return await run } finally { this.wake() }
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.actionQueue.catch(() => undefined).then(operation)
    this.actionQueue = run
    return run
  }
  async taskDetail(roomId: string, taskId: string) {
    const row = await this.deps.store.get<RoomTaskExecution>('task', taskId)
    if (!row || row.roomId !== roomId) throw new Error('task not found')
    const task = { ...row.value.task, revision: row.revision }
    const delivery = task.latestDeliveryId ? (await this.deps.store.get<RoomDelivery>('delivery', task.latestDeliveryId))?.value : undefined
    return { task, delivery, workspace: (await this.deps.store.get<RoomWorkspace>('workspace', task.workspaceId))?.value,
      reviews: (await this.deps.store.list<RoomReview>('review', { taskId, limit: 100 })).map((row) => row.value),
      diff: delivery ? (await this.deps.store.get<string>('artifact', delivery.diffArtifactId))?.value : undefined,
      controlThreadId: task.stage === 'review' ? row.value.reviewThreadId : task.executionThreadId,
      approvals: this.deps.approvals.pending(task.executionThreadId),
      userInputs: this.deps.inputs.pending(task.executionThreadId) }
  }
  async listRooms(input: { cursor?: string; archivedOnly?: boolean; limit: number }) {
    const page = await this.service.store.listRooms(input)
    return { rooms: page.rooms.map((row) => ({ ...row.value, revision: row.revision,
      latestMessageSeq: row.latestMessageSeq })), nextCursor: page.nextCursor }
  }
  async messages(roomId: string, limit: number, cursor?: number) {
    await this.service.get(roomId)
    const rows = await this.deps.store.list<RoomMessage>('message', { roomId, limit, beforeSeq: cursor })
    return { messages: [...rows].reverse().map((row) => ({ ...row.value, messageSeq: row.seq })),
      nextCursor: rows.length === limit ? String(rows.at(-1)!.seq) : undefined }
  }
  private async tick() {
    if (!this.held()) return
    await this.deps.assertOwnership()
    const requests = await this.deps.store.list<RoomRequestState>('request', {
      status: ['pending', 'running'], limit: 100, order: 'asc' })
    for (const row of requests) {
      if (this.stopped) return
      try { await this.requests.tick(row) } catch (error) {
        const current = await this.deps.store.get<RoomRequestState>('request', row.id)
        if (!current || current.revision !== row.revision) continue
        const message = error instanceof Error ? error.message : String(error)
        await this.executionService.append(row.roomId!, 'error-' + row.id, message)
        await putRoomDocument(this.deps.store, 'request', row.id, row.roomId!,
          { ...row.value, status: 'failed', error: message }, row)
      }
    }
    const taskRows = await this.deps.store.list<RoomTaskExecution>('task', {
      status: ['queued', 'waiting_dependency', 'running', 'needs_input', 'needs_approval', 'stopping'],
      limit: 1000, order: 'asc' })
    const activeTurn = (execution: RoomTaskExecution) => execution.task.stage === 'review' ?
      execution.completedReviewRunId === execution.reviewThreadId ? undefined : execution.reviewTurnId : execution.turnId
    const actingMember = (execution: RoomTaskExecution) => execution.task.stage === 'review' ?
      execution.reviewer?.id ?? execution.task.ownerMemberId : execution.task.ownerMemberId
    let occupied = taskRows.filter((row) => activeTurn(row.value) &&
      ['queued', 'running', 'needs_input', 'needs_approval', 'stopping'].includes(row.value.task.status)).length
    const busyMembers = new Set(taskRows.filter((row) => activeTurn(row.value) &&
      ['queued', 'running', 'needs_input', 'needs_approval', 'stopping'].includes(row.value.task.status))
      .map((row) => row.roomId + ':' + actingMember(row.value)))
    for (const row of taskRows) {
      if (this.stopped) return
      if (row.value.task.status === 'needs_input' && row.value.task.stage === 'review') continue
      const member = row.roomId + ':' + actingMember(row.value)
      const canStart = occupied < 2 && !busyMembers.has(member)
      try {
        await this.tasks.tick(row, canStart)
        if (canStart && !activeTurn(row.value) &&
          (row.value.task.status === 'queued' || row.value.task.stage === 'review')) {
          occupied += 1
          busyMembers.add(member)
        }
      } catch (error) { await this.tasks.fail(row, error) }
    }
  }
}
