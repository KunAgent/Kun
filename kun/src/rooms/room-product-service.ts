import { RoomRuleUpdateSchema, RoomRuleSchema, type RoomRule, type RoomRequestOutcome } from '../contracts/rooms-product.js'
import type { RoomDelivery, RoomReview } from '../contracts/room-deliveries.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomRequestState } from './room-runtime-types.js'
import { RoomStoreConflictError } from './room-store.js'
import { RoomService, roomFingerprint } from './room-service.js'
import { inspectRoomRecovery, recoverRoomTask } from './room-recovery.js'
import { RoomMessageSchema } from '../contracts/rooms.js'
import { roomActivitySummary } from './room-activity-summary.js'
import { roomRequestActivity } from './room-request-actions.js'
import { roomHistoryPage, type RoomHistoryPage } from './room-history.js'

export class RoomProductService {
  constructor(private readonly deps: RoomRuntimeDeps, private readonly service: RoomService) {}

  async updateRule(roomId: string, ruleId: string, input: unknown) {
    const body = RoomRuleUpdateSchema.parse(input)
    const key = 'rule-update-' + roomFingerprint({ roomId, ruleId, requestId: body.clientRequestId })
    const fingerprint = roomFingerprint(body)
    const replay = await this.service.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('rule update request identity conflict')
      return replay
    }
    const old = await this.service.store.get<RoomRule>('rule', ruleId)
    if (!old || old.roomId !== roomId) throw new Error('rule not found')
    const rule = { ...RoomRuleSchema.parse(old.value), ...('body' in body ? { body: body.body! } : {}),
      active: body.active ?? old.value.active ?? true, version: old.value.version + 1,
      updatedAt: new Date().toISOString() }
    const versionId = ruleId + '-v' + rule.version
    return this.service.store.commit({ requestId: key, fingerprint,
      checks: [{ kind: 'rule', id: ruleId, expectedRevision: body.expectedRevision },
        { kind: 'rule_version', id: versionId, expectedRevision: null }],
      puts: [{ kind: 'rule', id: ruleId, roomId, value: rule },
        { kind: 'rule_version', id: versionId, roomId, value: rule }],
      events: [{ roomId, kind: 'rule.changed', payload: { id: ruleId, version: rule.version } }],
      result: { rule: { ...rule, revision: old.revision + 1 } } })
  }

  async requests(roomId: string) { return (await this.requestPage(roomId)).requests }
  async requestPage(roomId: string, page: { limit?: number; cursor?: number } = {}) {
    await this.service.get(roomId)
    const limit = page.limit ?? 50
    const rows = await this.service.store.list<RoomRequestState>('request', { roomId, limit, beforeSeq: page.cursor, summaryOnly: true })
    const projection = await this.service.store.requestOutcomes?.({ roomId, requestIds: rows.map((row) => row.id), limit })
    const requests = await Promise.all(rows.map(async (row) => ({
      id: row.id, roomId, status: row.value.status, message: { body: row.value.message.body },
      sourceMessageId: row.value.originalSourceMessageId ?? row.value.sourceMessageId, error: row.value.error,
      clarification: row.value.clarification, contextState: row.value.contextState, continuation: row.value.continuation ?? 0,
      revision: row.revision, outcome: projection ? projection.outcomes.find((item) => item.requestId === row.id) :
        await this.requestOutcome(roomId, row.id), outcomeInitializing: projection?.initializing ?? false
    })))
    return { requests, nextCursor: rows.length === limit ? String(rows.at(-1)!.seq) : undefined }
  }
  async adoptRule(roomId: string, ruleId: string, input: {
    taskId: string; expectedTaskRevision: number; version: number; clientRequestId: string; body?: string
  }) {
    const key = 'adopt-' + roomFingerprint({ roomId, ruleId, clientRequestId: input.clientRequestId })
    const fingerprint = roomFingerprint({ roomId, ruleId, input })
    const replay = await this.deps.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('rule adoption request identity conflict')
      return replay.result as Awaited<ReturnType<RoomService['send']>>
    }
    const preparation = await this.deps.store.getRequest(key + '-prepare')
    if (preparation && preparation.fingerprint !== fingerprint) throw new RoomStoreConflictError('rule adoption request identity conflict')
    let rule = preparation?.result as RoomRule | undefined
    if (!rule) {
      const ruleRow = await this.service.store.get<RoomRule>('rule', ruleId)
      if (!ruleRow || ruleRow.roomId !== roomId) throw new Error('rule not found')
      rule = RoomRuleSchema.parse(ruleRow.value)
      if (rule.version !== input.version) throw new RoomStoreConflictError('rule changed; review its latest version')
      const task = await this.deps.store.get<RoomTaskExecution>('task', input.taskId)
      if (!task || task.roomId !== roomId) throw new Error('task not found')
      if (task.revision !== input.expectedTaskRevision) throw new RoomStoreConflictError('task changed', task.revision)
      await this.deps.store.commit({ requestId: key + '-prepare', fingerprint,
        checks: [{ kind: 'rule', id: ruleId, expectedRevision: ruleRow.revision },
          { kind: 'task', id: input.taskId, expectedRevision: input.expectedTaskRevision }], result: rule })
    }
    const payload = { clientRequestId: key, taskId: input.taskId, executionIntent: 'execute' as const,
      body: input.body ?? (rule.active ? 'Apply this project agreement to the current task: ' : 'Withdraw this project agreement from the current task: ') +
        rule.id + ' v' + rule.version,
      mentionMemberIds: [], attachmentIds: [] }
    const result = await this.service.send(roomId, payload, { ruleAdoption: rule })
    return (await this.deps.store.commit({ requestId: key, fingerprint, result })).result as typeof result
  }
  async retryRequest(roomId: string, id: string, clientRequestId: string, expectedRevision: number) {
    const key = 'retry-request-' + roomFingerprint({ roomId, id, clientRequestId })
    const fingerprint = roomFingerprint({ roomId, id, expectedRevision })
    const replay = await this.deps.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('request retry identity conflict')
      return replay
    }
    const row = await this.deps.store.get<RoomRequestState>('request', id)
    if (!row || row.roomId !== roomId) throw new Error('request not found')
    if (!['failed', 'needs_input'].includes(row.value.status)) throw new RoomStoreConflictError('request is not awaiting retry')
    if ((await roomRequestActivity(this.deps, row.value)).state !== 'stopped') throw new RoomStoreConflictError('original request is still active or requires reconciliation')
    const value: RoomRequestState = { ...row.value, status: 'pending', turnId: undefined,
      resultRepairs: 0, repairInstruction: undefined, error: undefined, compressionId: undefined, admissionAttempted: false,
      stepAttempt: (row.value.stepAttempt ?? 0) + 1 }
    if (value.stage === 'discuss') {
      value.discussions = value.discussions?.map((discussion) => discussion.error
        ? { ...discussion, error: undefined, turnId: undefined, response: undefined, attempt: (discussion.attempt ?? 0) + 1 }
        : discussion)
    }
    return this.deps.store.commit({ requestId: key, fingerprint,
      checks: [{ kind: 'request', id, expectedRevision }],
      puts: [{ kind: 'request', id, roomId, value }],
      events: [{ roomId, kind: 'request.updated', payload: { id } }], result: { id } })
  }
  recovery(roomId: string, taskId: string) { return inspectRoomRecovery(this.deps, roomId, taskId) }
  recover(roomId: string, taskId: string, input: unknown) { return recoverRoomTask(this.deps, roomId, taskId, input) }
  async deliveries(roomId: string, taskId: string) { return (await this.deliveryPage(roomId, taskId)).deliveries }
  async deliveryPage(roomId: string, taskId: string, page?: RoomHistoryPage, summaryOnly = false) {
    const result = await roomHistoryPage<RoomDelivery>(this.service.store, 'delivery', { roomId, taskId, summaryOnly }, page)
    return { deliveries: result.items, nextCursor: result.nextCursor }
  }
  async delivery(roomId: string, taskId: string, id: string, includeDiff = true) {
    const row = await this.deps.store.get<RoomDelivery>('delivery', id)
    if (!row || row.roomId !== roomId || row.taskId !== taskId) throw new Error('delivery not found')
    const reviews = await roomHistoryPage<RoomReview>(this.service.store, 'review', { roomId, taskId, deliveryId: id })
    return { delivery: row.value, diff: includeDiff ? (await this.deps.store.get<string>('artifact', row.value.diffArtifactId))?.value ?? '' : undefined,
      reviews: reviews.items, reviewsNextCursor: reviews.nextCursor }
  }
  async read(roomId: string, seq: number, clientRequestId: string) {
    await this.service.get(roomId)
    const key = 'read-' + roomFingerprint({ roomId, clientRequestId })
    const fingerprint = roomFingerprint({ roomId, seq })
    const replay = await this.service.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('read cursor request identity conflict')
      return replay
    }
    const latest = (await this.service.store.list('message', { roomId, limit: 1 }))[0]?.seq ?? 0
    for (let attempt = 0; attempt < 5; attempt++) {
      const old = await this.service.store.get<{ seq: number }>('read_state', roomId)
      const next = Math.max(old?.value.seq ?? 0, Math.min(latest, seq))
      try {
        return await this.service.store.commit({ requestId: key, fingerprint,
          checks: [{ kind: 'read_state', id: roomId, expectedRevision: old?.revision ?? null }],
          puts: next === old?.value.seq ? [] : [{ kind: 'read_state', id: roomId, roomId, value: { seq: next } }],
          result: { seq: next } })
      } catch (error) {
        if (!(error instanceof RoomStoreConflictError) || attempt === 4) throw error
      }
    }
    throw new Error('read cursor did not settle')
  }
  async summarizeRequests(taskRows: RoomTaskExecution[]) {
    const values: RoomRequestOutcome[] = []
    if (this.deps.store.requestOutcomes) {
      const pending = await this.deps.store.requestOutcomes({ pendingOnly: true, limit: 100 })
      if (pending.initializing) return
      values.push(...pending.outcomes)
    } else {
      const requests = new Map(taskRows.map((row) => [row.task.requestId, row.task.roomId]))
      for (const [id, roomId] of requests) {
        const value = await this.requestOutcome(roomId, id)
        if (value) values.push({ ...value, roomId })
      }
    }
    for (const value of values) {
      const requestId = value.requestId
      const { revision, active, status, summary } = value
      const old = await this.deps.store.get<RoomRequestOutcome>('outcome', requestId)
      if (old?.value.revision === revision) continue
      const roomId = value.roomId!
      const messageId = 'summary-' + roomFingerprint({ requestId, revision })
      const publish = !active && status !== 'needs_attention' && (old?.value.status !== status || old?.value.summary !== summary) && !await this.deps.store.get('message', messageId)
      const message = publish ? RoomMessageSchema.parse({ id: messageId, roomId, messageSeq: 1,
        authorKind: 'system', authorLabelSnapshot: 'Kun', body: ('需求整体状态: ' + status + '\n' + summary).slice(0, 64000),
        bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], createdAt: new Date().toISOString() }) : undefined
      await this.deps.store.commit({ requestId: 'outcome-' + roomFingerprint({ requestId, revision, previous: old?.revision ?? null }),
        checks: [{ kind: 'outcome', id: requestId, expectedRevision: old?.revision ?? null },
          ...(message ? [{ kind: 'message' as const, id: messageId, expectedRevision: null }] : [])],
        puts: [{ kind: 'outcome', id: requestId, roomId, value },
          ...(message ? [{ kind: 'message' as const, id: messageId, roomId, value: message }] : [])],
        events: [{ roomId, kind: 'outcome.updated', payload: { id: requestId } },
          ...(message ? [{ roomId, kind: 'message.created', payload: { id: messageId } }] : [])] })
    }
  }
  async attention() {
    const { attentionCount } = await roomActivitySummary(this.service.store)
    return { attentionCount }
  }
  private async requestOutcome(roomId: string, requestId: string): Promise<RoomRequestOutcome | undefined> {
    if (this.deps.store.requestOutcomes) {
      return (await this.deps.store.requestOutcomes({ roomId, requestIds: [requestId], limit: 1 })).outcomes[0]
    }
    const totals = []
    let afterSeq: number | undefined
    for (;;) {
      const page = await this.deps.store.list<RoomTaskExecution>('task', { roomId, requestId, limit: 1000, order: 'asc', afterSeq })
      totals.push(...page)
      if (page.length < 1000) break
      afterSeq = page.at(-1)!.seq
    }
    const tasks = totals.map((row) => row.value.task)
    if (!tasks.length) return undefined
    const completed = tasks.filter((task) => task.status === 'completed').length
    const delivered = tasks.filter((task) => ['completed', 'awaiting_acceptance'].includes(task.status)).length
    const failed = tasks.filter((task) => ['failed', 'cancelled'].includes(task.status)).length
    const active = tasks.filter((task) => ['queued', 'running', 'waiting_dependency', 'stopping'].includes(task.status)).length
    const attention = tasks.some((task) => ['needs_input', 'needs_approval', 'recovery_required'].includes(task.status))
    const status = active ? 'running' : attention ? 'needs_attention' : completed === tasks.length ? 'completed' :
      delivered === tasks.length ? 'awaiting_acceptance' : delivered && failed ? 'partial' :
        tasks.every((task) => task.status === 'cancelled') ? 'cancelled' : 'failed'
    return { requestId, status, total: tasks.length, completed, delivered, failed, active, taskIds: tasks.map((task) => task.id),
      summary: tasks.map((task) => task.title + ' [' + task.repositoryId + ']: ' + task.status).join('\n'),
      revision: roomFingerprint(tasks.map((task) => [task.id, task.status, task.latestDeliveryId, task.acceptedDeliveryId])) }
  }
}
