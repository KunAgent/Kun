import { reconcileRecordedRoomRuns } from './room-run-recording.js'
import { join } from 'node:path'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import { RoomReviewSchema } from '../contracts/room-deliveries.js'
import { RoomIntegrationActionSchema, type RoomIntegration } from '../contracts/rooms-product.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import { assertRoomAncestor, serializeRoomGitMutation } from './room-git.js'
import { observeRoomRepository, assertRoomApplyPreflight } from './task-workspace-service.js'
import { assertRoomDeliveryPin, prepareRoomReviewWorktree, applyRoomDelivery } from './room-delivery-service.js'
import { ensureRoomThread, enqueueRoomTurn, observeRoomTurn } from './room-execution.js'
import { roomFingerprint, putRoomDocument } from './room-service.js'
import { RoomStoreConflictError, type RoomStoredDocument } from './room-store.js'
import { roomTaskActivity, stopRoomTaskTurn } from './room-task-activity.js'
import { RoomReviewResultSchema } from './room-result-tools.js'
import { parseRoomJson } from './room-coordination-plan.js'
import { captureRoomVerification } from './room-verification.js'
import { roomTaskContext } from './room-context.js'
import { assertIntegrationWorkspace, freezeIntegrationCandidate, integrationDelivery,
  prepareIntegrationGit } from './room-integration-git.js'

type Action = ReturnType<typeof RoomIntegrationActionSchema.parse>
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export async function assertNoActiveRoomIntegration(deps: RoomRuntimeDeps, roomId: string, taskId: string) {
  const service = new RoomIntegrationService(deps)
  let afterSeq: number | undefined
  for (;;) {
    const rows = await deps.store.list<RoomIntegration>('integration', { roomId, taskId, order: 'asc', limit: 1000, afterSeq })
    for (const row of rows) if (['preparing', 'validating'].includes(row.value.status) || row.value.applyIntent ||
      await service.activity(row.value) !== 'idle') throw new RoomStoreConflictError('integration must stop or reconcile before changing this task')
    if (rows.length < 1000) break
    afterSeq = rows.at(-1)!.seq
  }
  if ((await deps.store.list('cleanup', { roomId, taskId, status: 'removing', limit: 1 })).length) {
    throw new RoomStoreConflictError('finish the pending workspace cleanup before continuing this task')
  }
}

export class RoomIntegrationService {
  constructor(private readonly deps: RoomRuntimeDeps) {}
  async get(roomId: string, taskId: string, id: string) {
    const row = await this.deps.store.get<RoomIntegration>('integration', id)
    if (!row || row.roomId !== roomId || row.taskId !== taskId) throw new Error('integration not found')
    return row
  }
  private async task(roomId: string, taskId: string) {
    const row = await this.deps.store.get<RoomTaskExecution>('task', taskId)
    if (!row || row.roomId !== roomId) throw new Error('task not found')
    const workspace = (await this.deps.store.get<RoomWorkspace>('workspace', row.value.task.workspaceId))?.value
    if (!workspace || workspace.taskId !== taskId || workspace.roomId !== roomId) throw new Error('workspace ownership mismatch')
    return { row, workspace }
  }
  async prepare(roomId: string, taskId: string, input: unknown) {
    const body = RoomIntegrationActionSchema.parse(input)
    const id = 'integration-' + roomFingerprint({ roomId, taskId, requestId: body.clientRequestId }).slice(0, 48)
    return serializeRoomGitMutation('integration:' + id, async () => {
      await this.deps.assertOwnership()
      let existing = await this.deps.store.get<RoomIntegration>('integration', id)
      const fingerprint = roomFingerprint({ roomId, taskId, body })
      if (existing && existing.value.requestFingerprint !== fingerprint) throw new RoomStoreConflictError('integration request identity conflict')
      if (existing && existing.value.status !== 'preparing') return { ...existing.value, revision: existing.revision }
      const { row, workspace } = await this.task(roomId, taskId)
      if (!existing && row.revision !== body.expectedRevision) throw new RoomStoreConflictError('task changed', row.revision)
      if ((await roomTaskActivity(this.deps, row.value)).state !== 'idle') throw new RoomStoreConflictError('task must stop before integration')
      if (row.value.task.applicationStatus === 'applying') throw new RoomStoreConflictError('application requires reconciliation first')
      for (const entry of await this.all(taskId)) if (entry.id !== id &&
        (['preparing', 'validating'].includes(entry.value.status) || entry.value.applyIntent || await this.activity(entry.value) !== 'idle')) {
        throw new RoomStoreConflictError('another integration is still active')
      }
      const delivery = (await this.deps.store.get<RoomDelivery>('delivery', existing?.value.deliveryId ?? row.value.task.latestDeliveryId ?? ''))?.value
      if (!delivery || delivery.taskId !== taskId) throw new Error('delivery not found')
      await assertRoomDeliveryPin(workspace.repository, delivery)
      const target = await observeRoomRepository(workspace.repository.root)
      if (target.branch !== workspace.repository.branch || target.commonDir !== workspace.repository.commonDir) {
        throw new RoomStoreConflictError('target repository or branch changed')
      }
      if (!existing) {
        const value: RoomIntegration = { id, roomId, taskId, deliveryId: delivery.id, requestFingerprint: fingerprint,
          sourceSha: delivery.versionHash, targetSha: target.head, path: join(this.deps.dataDir, 'rooms', 'integrations', id),
          branch: 'codex/room-integration/' + id, status: 'preparing', conflicts: [], diff: '', validation: [],
          validationCommands: body.validationCommands ?? [...new Set(delivery.verification.map((item) => item.command))],
          createdAt: new Date().toISOString() }
        await this.deps.store.commit({ requestId: 'reserve-' + id, fingerprint,
          checks: [{ kind: 'integration', id, expectedRevision: null }, { kind: 'task', id: taskId, expectedRevision: row.revision }],
          puts: [{ kind: 'integration', id, roomId, taskId, value }],
          events: [{ roomId, kind: 'integration.updated', payload: { id, taskId, status: value.status } }] })
        existing = await this.get(roomId, taskId, id)
      }
      await this.finishPreparation(existing, workspace, row.value)
      const result = await this.get(roomId, taskId, id)
      return { ...result.value, revision: result.revision }
    })
  }
  private async finishPreparation(row: RoomStoredDocument<RoomIntegration>, workspace: RoomWorkspace, execution: RoomTaskExecution) {
    const value = structuredClone(row.value)
    try {
      const delivery = (await this.deps.store.get<RoomDelivery>('delivery', value.deliveryId))?.value
      if (!delivery || delivery.taskId !== value.taskId || delivery.versionHash !== value.sourceSha) throw new Error('integration delivery identity changed')
      await assertRoomDeliveryPin(workspace.repository, delivery)
      const source = await observeRoomRepository(workspace.repository.root)
      if (source.root !== workspace.repository.root || source.commonDir !== workspace.repository.commonDir ||
        source.branch !== workspace.repository.branch || source.operationInProgress) throw new Error('source repository changed or has an unfinished Git operation')
      await prepareIntegrationGit(this.deps, value, workspace)
      if (value.conflicts.length) value.status = 'conflict'
      else {
        await freezeIntegrationCandidate(this.deps, value, workspace)
        this.nextStage(value, value.validationCommands?.length ? 'validate' : execution.reviewer ? 'review' : undefined)
      }
    } catch (error) { value.status = 'failed'; value.error = errorText(error); value.attention = undefined }
    await this.save(row, value)
  }
  async action(roomId: string, taskId: string, id: string, action: string, input: unknown) {
    const body = RoomIntegrationActionSchema.parse(input)
    return serializeRoomGitMutation('integration:' + id, async () => {
      await this.deps.assertOwnership()
      const key = 'integration-action-' + roomFingerprint({ roomId, id, requestId: body.clientRequestId })
      const fingerprint = roomFingerprint({ action, body })
      const replay = await this.deps.store.getRequest(key)
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('integration action identity conflict')
        return replay.result
      }
      const row = await this.get(roomId, taskId, id)
      const resuming = action === 'apply' && row.value.applyIntent?.clientRequestId === body.clientRequestId &&
        row.value.applyIntent.fingerprint === fingerprint
      if (row.revision !== body.expectedRevision && !resuming) throw new RoomStoreConflictError('integration changed', row.revision)
      const value = structuredClone(row.value)
      const { row: taskRow, workspace } = await this.task(roomId, taskId)
      if (action === 'apply') return this.apply(row, taskRow, workspace, body, key, fingerprint)
      if (action === 'cancel' && value.applyIntent) return this.cancelApplication(row, taskRow, workspace, key, fingerprint)
      if (value.applyIntent) throw new RoomStoreConflictError('apply again to reconcile the pending exact candidate')
      if (action === 'open') {
        if (!['conflict', 'failed', 'ready', 'recovery_required'].includes(value.status)) throw new RoomStoreConflictError('integration is busy')
        if (await this.activity(value) !== 'idle') throw new RoomStoreConflictError('integration execution must stop first')
        await assertIntegrationWorkspace(this.deps, value, workspace)
        value.threadId = 'room-integration-open-' + roomFingerprint({ id, requestId: body.clientRequestId }).slice(0, 48)
        value.turnId = undefined
        value.attention = undefined
        await ensureRoomThread(this.deps, { id: value.threadId, roomId, taskId,
          member: taskRow.value.task.memberSnapshot, kind: 'execution', workspace: value.path, profile: taskRow.value.configuration })
      } else if (action === 'validate') {
        if (!['conflict', 'failed', 'ready', 'recovery_required'].includes(value.status)) throw new RoomStoreConflictError('integration is busy')
        if (await this.activity(value) !== 'idle' || (await roomTaskActivity(this.deps, taskRow.value)).state !== 'idle') {
          throw new RoomStoreConflictError('execution must stop before freezing a new candidate')
        }
        if (body.validationCommands) value.validationCommands = body.validationCommands
        await freezeIntegrationCandidate(this.deps, value, workspace)
        value.cancelRequested = false
        value.error = undefined
        value.stepRepairs = 0
        this.nextStage(value, value.validationCommands?.length ? 'validate' : taskRow.value.reviewer ? 'review' : undefined)
      } else if (action === 'resolve') {
        if (!['conflict', 'failed', 'recovery_required'].includes(value.status)) throw new RoomStoreConflictError('integration has no pending work')
        if ((await this.activity(value)) !== 'idle') throw new RoomStoreConflictError('prior integration execution must stop before retrying')
        if ((await roomTaskActivity(this.deps, taskRow.value)).state !== 'idle') throw new RoomStoreConflictError('task execution must stop first')
        value.cancelRequested = false
        value.error = undefined
        value.stepRepairs = 0
        if (body.validationCommands) value.validationCommands = body.validationCommands
        // A failed preparation is retried as preparation; it cannot become a target-only candidate.
        if (!value.candidateSha && !value.conflicts.length && value.runKind !== 'resolve') {
          value.status = 'preparing'
          value.threadId = undefined
          value.turnId = undefined
        } else this.nextStage(value, value.status === 'conflict' || value.runKind === 'resolve' || value.runKind === 'validate' ? 'resolve' :
          value.runKind === 'review' ? 'review' : 'validate')
      } else if (action === 'cancel') {
        if (value.status === 'applied') throw new RoomStoreConflictError('applied integrations cannot be cancelled')
        value.cancelRequested = true
        if (!value.turnId && value.threadId) {
          const thread = await this.deps.threads.getMetadata(value.threadId)
          value.turnId = thread?.turns.find((turn) => turn.clientRequestId === value.threadId)?.id
        }
        if ((await this.activity(value)) === 'idle') {
          value.status = 'failed'
          value.error = 'Integration cancelled; candidate and workspace preserved.'
        }
      } else throw new Error('unknown integration action')
      const result = { ...value, revision: row.revision + 1 }
      await this.deps.store.commit({ requestId: key, fingerprint,
        checks: [{ kind: 'integration', id, expectedRevision: row.revision }],
        puts: [{ kind: 'integration', id, roomId, taskId, value }],
        events: [{ roomId, kind: 'integration.updated', payload: { id, taskId, status: value.status } }], result })
      if (value.cancelRequested && value.threadId) {
        await this.deps.stopBackgroundExecution?.(value.threadId)
        await reconcileRecordedRoomRuns(this.deps, { roomId: value.roomId, threadId: value.threadId })
      }
      if (value.cancelRequested && value.threadId && value.turnId && await this.activity(value) === 'active') {
        await stopRoomTaskTurn(this.deps, value.threadId, value.turnId)
      }
      return result
    })
  }
  private async cancelApplication(row: RoomStoredDocument<RoomIntegration>, taskRow: RoomStoredDocument<RoomTaskExecution>,
    workspace: RoomWorkspace, key: string, fingerprint: string) {
    const value = structuredClone(row.value)
    return serializeRoomGitMutation(workspace.repository.commonDir, async () => {
      await this.deps.assertOwnership()
      const original = (await this.deps.store.get<RoomDelivery>('delivery', value.deliveryId))!.value
      await assertRoomDeliveryPin(workspace.repository, integrationDelivery(value, original))
      const target = await observeRoomRepository(workspace.repository.root)
      if (target.root !== workspace.repository.root || target.commonDir !== workspace.repository.commonDir ||
        target.branch !== workspace.repository.branch || target.operationInProgress) {
        throw new RoomStoreConflictError('application target identity or Git operation requires inspection')
      }
      if (value.applyIntent!.expectedTaskRevision !== taskRow.revision) throw new RoomStoreConflictError('application task changed; preserve for recovery')
      let applied = false
      try { await assertRoomAncestor(target.root, value.candidateSha!, target.head); applied = true } catch { /* Preserve unapplied candidate. */ }
      value.applyIntent = undefined
      value.status = applied ? 'applied' : 'failed'
      value.attention = undefined
      value.cancelRequested = !applied
      value.error = applied ? undefined : 'Application cancelled after Git inspection; candidate preserved.'
      const result = { ...value, revision: row.revision + 1 }
      await this.deps.store.commit({ requestId: key, fingerprint,
        checks: [{ kind: 'integration', id: row.id, expectedRevision: row.revision },
          { kind: 'task', id: value.taskId, expectedRevision: taskRow.revision }],
        puts: [{ kind: 'integration', id: row.id, roomId: value.roomId, taskId: value.taskId, value },
          { kind: 'task', id: value.taskId, roomId: value.roomId, taskId: value.taskId,
            value: { ...taskRow.value, task: { ...taskRow.value.task, applicationStatus: applied ? 'applied' : 'conflict', revision: taskRow.revision + 1 } } }],
        events: [{ roomId: value.roomId, kind: 'integration.updated', payload: { id: value.id, taskId: value.taskId, status: value.status } },
          { roomId: value.roomId, kind: 'task.updated', payload: { id: value.taskId } }], result })
      return result
    })
  }
  private async apply(row: RoomStoredDocument<RoomIntegration>, taskRow: RoomStoredDocument<RoomTaskExecution>,
    workspace: RoomWorkspace, body: Action, key: string, fingerprint: string) {
    let value = structuredClone(row.value)
    if (taskRow.value.task.latestDeliveryId !== value.deliveryId) throw new RoomStoreConflictError('task delivery changed; prepare a new integration')
    if (value.status !== 'ready' || !value.candidateSha) throw new RoomStoreConflictError('integration is not ready')
    if ((await roomTaskActivity(this.deps, taskRow.value)).state !== 'idle' || await this.activity(value) !== 'idle') {
      throw new RoomStoreConflictError('execution must stop before application')
    }
    if (value.validationCommands?.some((command) => !value.validation.some((check) => check.command === command && check.exitCode === 0)) ||
      value.validation.some((check) => check.exitCode !== 0) || (value.validation.length && value.validationVersionHash !== value.candidateSha)) {
      throw new RoomStoreConflictError('candidate validation is incomplete, failed, or stale')
    }
    if (!value.validation.length && !body.confirmUnverified) throw new RoomStoreConflictError('explicitly confirm this unverified candidate before application')
    if (taskRow.value.reviewer && (value.review?.verdict !== 'passed' || value.review.versionHash !== value.candidateSha)) {
      throw new RoomStoreConflictError('candidate review is not satisfied')
    }
    const original = (await this.deps.store.get<RoomDelivery>('delivery', value.deliveryId))!.value
    const delivery = integrationDelivery(value, original)
    await assertRoomDeliveryPin(workspace.repository, delivery)
    const current = await assertIntegrationWorkspace(this.deps, value, workspace)
    if (current.head !== value.candidateSha || current.dirty || current.operationInProgress) throw new RoomStoreConflictError('candidate changed after preview')
    const target = await observeRoomRepository(workspace.repository.root)
    let alreadyIntegrated = false
    if (value.applyIntent && target.root === workspace.repository.root && target.commonDir === workspace.repository.commonDir &&
      target.branch === workspace.repository.branch) {
      try { await assertRoomAncestor(target.root, value.candidateSha, target.head); alreadyIntegrated = true }
      catch { /* Only the exact pinned candidate's ancestry can acknowledge an uncertain application. */ }
    }
    if (!alreadyIntegrated) assertRoomApplyPreflight(target, { ...workspace.repository,
      head: target.head === value.candidateSha ? value.candidateSha : value.targetSha })
    if (!value.applyIntent) {
      value.applyIntent = { clientRequestId: body.clientRequestId, fingerprint, expectedTaskRevision: taskRow.revision + 1,
        candidateSha: value.candidateSha, targetSha: value.targetSha }
      await this.deps.store.commit({ requestId: 'reserve-' + key, fingerprint,
        checks: [{ kind: 'integration', id: value.id, expectedRevision: row.revision },
          { kind: 'task', id: value.taskId, expectedRevision: taskRow.revision }],
        puts: [{ kind: 'integration', id: value.id, roomId: value.roomId, taskId: value.taskId, value },
          { kind: 'task', id: value.taskId, roomId: value.roomId, taskId: value.taskId,
            value: { ...taskRow.value, task: { ...taskRow.value.task, applicationStatus: 'applying', revision: taskRow.revision + 1 } } }] })
      row = await this.get(value.roomId, value.taskId, value.id)
      taskRow = (await this.deps.store.get<RoomTaskExecution>('task', value.taskId))!
    } else if ((value.applyIntent.clientRequestId === body.clientRequestId && value.applyIntent.fingerprint !== fingerprint) ||
      value.applyIntent.candidateSha !== value.candidateSha || value.applyIntent.targetSha !== value.targetSha ||
      value.applyIntent.expectedTaskRevision !== taskRow.revision) throw new RoomStoreConflictError('application identity changed; preserve for recovery')
    // The persisted exact intent above survives both a lost Git response and a lost database receipt.
    if (!alreadyIntegrated) await applyRoomDelivery({ repository: workspace.repository, delivery,
      expectedTarget: { ...workspace.repository, head: value.targetSha }, assertOwnership: this.deps.assertOwnership })
    value = { ...value, status: 'applied', applyIntent: undefined, attention: undefined }
    const result = { ...value, revision: row.revision + 1 }
    await this.deps.assertOwnership()
    await this.deps.store.commit({ requestId: key, fingerprint,
      checks: [{ kind: 'integration', id: value.id, expectedRevision: row.revision },
        { kind: 'task', id: value.taskId, expectedRevision: taskRow.revision }],
      puts: [{ kind: 'integration', id: value.id, roomId: value.roomId, taskId: value.taskId, value },
        { kind: 'task', id: value.taskId, roomId: value.roomId, taskId: value.taskId,
          value: { ...taskRow.value, task: { ...taskRow.value.task, applicationStatus: 'applied', revision: taskRow.revision + 1 } } }],
      events: [{ roomId: value.roomId, kind: 'integration.updated', payload: { id: value.id, taskId: value.taskId, status: value.status } },
        { roomId: value.roomId, kind: 'task.updated', payload: { id: value.taskId } }], result })
    return result
  }
  private async all(taskId?: string) {
    const rows: RoomStoredDocument<RoomIntegration>[] = []
    for (;;) {
      const page = await this.deps.store.list<RoomIntegration>('integration', { taskId, order: 'asc', limit: 1000, afterSeq: rows.at(-1)?.seq })
      rows.push(...page)
      if (page.length < 1000) return rows
    }
  }
  async activity(value: RoomIntegration): Promise<'idle' | 'active' | 'unknown'> {
    if (!value.threadId) return value.turnId ? 'unknown' : 'idle'
    try {
      if (this.deps.backgroundExecutionActive?.(value.threadId)) return 'active'
      const thread = await this.deps.threads.getMetadata(value.threadId)
      const turn = value.turnId ? thread?.turns.find((turn) => turn.id === value.turnId) :
        thread?.turns.find((turn) => turn.clientRequestId === value.threadId)
      if (thread?.turns.some((turn) => ['running', 'queued'].includes(turn.status))) return 'active'
      if (value.turnId && !turn) return await this.deps.proveStopped?.(value.threadId, value.turnId) ? 'idle' : 'unknown'
      return 'idle'
    } catch { return 'unknown' }
  }
  async active() {
    const rows: RoomStoredDocument<RoomIntegration>[] = []
    for (;;) {
      const page = await this.deps.store.list<RoomIntegration>('integration', {
        status: ['preparing', 'validating', 'recovery_required'], order: 'asc', limit: 1000, afterSeq: rows.at(-1)?.seq })
      rows.push(...page)
      if (page.length < 1000) return rows
    }
  }
  async tick(supplied: RoomStoredDocument<RoomIntegration>, allowStart: boolean) {
    return serializeRoomGitMutation('integration:' + supplied.id, async () => {
      const row = await this.get(supplied.value.roomId, supplied.value.taskId, supplied.id)
      if (row.revision !== supplied.revision) return
      const value = structuredClone(row.value)
      const { row: taskRow, workspace } = await this.task(value.roomId, value.taskId)
      const attention = this.gateAttention(value)
      if (attention?.signature !== value.attention?.signature) {
        value.attention = attention
        await this.save(row, value)
        return
      }
      if (value.cancelRequested) {
        if (value.threadId) await this.deps.stopBackgroundExecution?.(value.threadId)
        if (!value.turnId && value.threadId) {
          const thread = await this.deps.threads.getMetadata(value.threadId)
          value.turnId = thread?.turns.find((turn) => turn.clientRequestId === value.threadId)?.id
        }
        const state = await this.activity(value)
        if (state === 'unknown') return
        if (state === 'active') {
          if (value.threadId && value.turnId) await stopRoomTaskTurn(this.deps, value.threadId, value.turnId)
          return
        }
        if (value.threadId) await reconcileRecordedRoomRuns(this.deps, { roomId: value.roomId, threadId: value.threadId })
        value.status = 'failed'
        value.error = 'Integration cancelled; candidate and workspace preserved.'
        value.attention = undefined
        await this.save(row, value)
        return
      }
      if (value.status === 'preparing') {
        if ((await roomTaskActivity(this.deps, taskRow.value)).state === 'idle') await this.finishPreparation(row, workspace, taskRow.value)
        return
      }
      if (value.status === 'recovery_required') {
        const state = await this.activity(value)
        if (state === 'unknown') return
        if (!value.turnId && value.threadId) {
          const thread = await this.deps.threads.getMetadata(value.threadId)
          value.turnId = thread?.turns.find((turn) => turn.clientRequestId === value.threadId)?.id
        }
        const observed = value.threadId && value.turnId ? await observeRoomTurn(this.deps, value.threadId, value.turnId) : undefined
        if (state === 'active' && (!observed || !['queued', 'running', 'completed'].includes(observed.status))) return
        value.status = observed && ['queued', 'running', 'completed'].includes(observed.status) ? 'validating' : 'failed'
        await this.save(row, value)
        return
      }
      if (value.status !== 'validating') return
      try {
        if (!value.turnId) {
          const thread = value.threadId ? await this.deps.threads.getMetadata(value.threadId) : null
          const turn = thread?.turns.find((turn) => turn.clientRequestId === value.threadId)
          if (turn) value.turnId = turn.id
          else {
            if (!allowStart) return
            if ((await roomTaskActivity(this.deps, taskRow.value)).state !== 'idle') return
            // Persist admission identity first. Prompt must remain stable on an admission retry.
            if (!value.threadId) {
              value.threadId = 'room-integration-' + roomFingerprint({ id: value.id, kind: value.runKind, attempt: value.stepAttempt ?? 0 }).slice(0, 48)
              await this.save(row, value)
              return
            }
            await this.start(value, taskRow.value, workspace)
          }
        } else {
          const observed = await observeRoomTurn(this.deps, value.threadId!, value.turnId)
          if (observed.status === 'running' || observed.status === 'queued') return
          if (observed.status !== 'completed') throw new Error(observed.error ?? 'integration execution interrupted or identity missing')
          if (await this.activity(value) !== 'idle') return
          if (value.runKind === 'review') {
            try {
              const parsed = RoomReviewResultSchema.parse(observed.structured ?? parseRoomJson(observed.text))
              const review = RoomReviewSchema.parse({ ...parsed, id: value.threadId, taskId: value.taskId,
                deliveryId: value.candidatePinId, versionHash: value.candidateSha, reviewerMemberId: taskRow.value.reviewer!.id })
              value.review = { verdict: review.verdict, versionHash: review.versionHash, findings: review.findings, limitations: review.limitations }
              value.status = review.verdict === 'passed' ? 'ready' : 'conflict'
              this.recordEvidence(value)
            } catch (error) {
              if ((value.stepRepairs ?? 0) >= 2) throw error
              value.stepRepairs = (value.stepRepairs ?? 0) + 1
              value.error = 'Invalid review result: ' + errorText(error)
              this.nextStage(value, 'review')
            }
          } else {
            const current = await assertIntegrationWorkspace(this.deps, value, workspace)
            if (value.runKind === 'validate' && (current.head !== value.candidateSha || current.dirty || current.operationInProgress)) {
              throw new Error('validation changed candidate source; preserve workspace and resolve before creating a new candidate')
            }
            await freezeIntegrationCandidate(this.deps, value, workspace)
            const evidence = await captureRoomVerification(this.deps, { roomId: value.roomId, taskId: value.taskId,
              threadId: value.threadId!, turnId: value.turnId, workspace: value.path, deliveryId: value.id + '-' + row.revision })
            value.validation = evidence.verification.map((check) => ({ command: check.command, exitCode: check.exitCode, output: check.logArtifactId ?? '' }))
            value.validationVersionHash = value.candidateSha
            this.recordEvidence(value)
            if (value.validationCommands?.some((command) => !value.validation.some((check) => check.command === command && check.exitCode === 0)) ||
              value.validation.some((check) => check.exitCode !== 0)) throw new Error('required integration validation is incomplete or failed')
            this.nextStage(value, taskRow.value.reviewer ? 'review' : undefined)
          }
        }
      } catch (error) {
        value.status = await this.activity(value) === 'idle' ? 'failed' : 'recovery_required'
        if (value.status === 'failed') value.attention = undefined
        value.error = errorText(error)
      }
      await this.save(row, value)
    })
  }
  private async start(value: RoomIntegration, execution: RoomTaskExecution, workspace: RoomWorkspace) {
    const reviewing = value.runKind === 'review'
    const member = reviewing ? execution.reviewer : execution.task.memberSnapshot
    if (!member) throw new Error('integration reviewer unavailable')
    let path = value.path
    if (reviewing) {
      const original = (await this.deps.store.get<RoomDelivery>('delivery', value.deliveryId))!.value
      path = (await prepareRoomReviewWorktree({ repository: workspace.repository, delivery: integrationDelivery(value, original),
        destination: join(this.deps.dataDir, 'rooms', 'reviews', value.candidatePinId!), assertOwnership: this.deps.assertOwnership })).path
    }
    await ensureRoomThread(this.deps, { id: value.threadId!, roomId: value.roomId, taskId: value.taskId,
      member, kind: reviewing ? 'review' : 'execution', workspace: path,
      profile: reviewing ? execution.reviewerConfiguration : execution.configuration })
    const instruction = reviewing ? 'Review this immutable integrated candidate. Submit submit_room_review with verdict, findings and limitations.' :
      value.runKind === 'resolve' ? 'Resolve merge conflicts and listed review findings only inside this integration worktree. Preserve original requirements and target behavior. Do not merge into the source checkout. Declare and run every validation command with declare_room_checks.' :
        'Run exactly the declared verification commands without changing candidate source code. Declare checks with declare_room_checks first.'
    value.turnId = await enqueueRoomTurn(this.deps, value.threadId!, value.threadId!, instruction + '\n' +
      JSON.stringify({ requirement: execution.prompt, sourceSha: value.sourceSha, targetSha: value.targetSha,
        candidateSha: value.candidateSha, conflicts: value.conflicts, findings: value.review?.findings,
        diffExcerpt: value.diff.slice(0, 64000), diffTruncated: value.diff.length > 64000,
        commands: value.validationCommands, projectContext: roomTaskContext(execution), priorError: value.error }), [],
      { phase: 'integration', integrationId: value.id, integrationStage: value.runKind, attempt: (value.stepAttempt ?? 0) + 1 })
  }
  private nextStage(value: RoomIntegration, kind: RoomIntegration['runKind']) {
    value.runKind = kind
    value.status = kind ? 'validating' : 'ready'
    value.stepAttempt = (value.stepAttempt ?? 0) + 1
    value.threadId = undefined
    value.turnId = undefined
    value.attention = undefined
  }
  private gateAttention(value: RoomIntegration): RoomIntegration['attention'] {
    if (!value.threadId || !value.turnId) return undefined
    const approvalIds = [...new Set(this.deps.approvals.pending(value.threadId)
      .filter((gate) => gate.turnId === value.turnId).map((gate) => gate.id))].sort()
    const userInputIds = [...new Set(this.deps.inputs.pending(value.threadId)
      .filter((gate) => gate.turnId === value.turnId).map((gate) => gate.id))].sort()
    return approvalIds.length || userInputIds.length ?
      { signature: roomFingerprint({ approvalIds, userInputIds }), approvalIds, userInputIds } : undefined
  }
  private recordEvidence(value: RoomIntegration) {
    value.candidates = value.candidates?.map((candidate) => candidate.sha === value.candidateSha ?
      { ...candidate, validation: structuredClone(value.validation), review: structuredClone(value.review) } : candidate)
  }
  private async save(row: RoomStoredDocument<RoomIntegration>, value: RoomIntegration) {
    await this.deps.assertOwnership()
    await putRoomDocument(this.deps.store, 'integration', value.id, value.roomId, value, row, value.taskId)
  }
}
