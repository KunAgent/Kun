import { roomTurnRunId } from './room-run-recording.js'
import { roomRunSegmentMessageId } from './room-run-segments.js'
import { access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RoomReviewSchema, type RoomDelivery, type RoomReview } from '../contracts/room-deliveries.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import type { RoomStoredDocument } from './room-store.js'
import { ensureRoomThread, enqueueRoomTurn, observeRoomTurn } from './room-execution.js'
import { putRoomDocument, RoomService } from './room-service.js'
import { createRoomTaskWorktree } from './task-workspace-service.js'
import { createRoomDelivery, prepareRoomReviewWorktree, assertRoomTaskWorkspace } from './room-delivery-service.js'
import { parseRoomJson } from './room-coordination-plan.js'
import { roomTaskContext } from './room-context.js'
import { roomReviewFeedback } from './room-feedback.js'
import { RoomReviewResultSchema } from './room-result-tools.js'
import { roomGit } from './room-git.js'
import { captureRoomVerification } from './room-verification.js'
import { resolveRoomDependencies, materializeRoomDependencies } from './room-task-dependencies.js'
import { roomTaskActivity, stopRoomTaskTurn } from './room-task-activity.js'

export class RoomTaskRunner {
  constructor(private readonly deps: RoomRuntimeDeps, private readonly service: RoomService) {}

  async tick(row: RoomStoredDocument<RoomTaskExecution>, allowStart: boolean): Promise<void> {
    const execution = structuredClone(row.value)
    const { task } = execution
    if (['completed', 'awaiting_acceptance', 'cancelled', 'failed'].includes(task.status)) return
    if (task.status === 'recovery_required') {
      const activity = await roomTaskActivity(this.deps, execution)
      // Only resume observing an identified live turn. An unknown or terminal
      // execution stays available for explicit recovery, never fresh admission.
      if (activity.state !== 'active') return
      if (task.stage === 'review') execution.reviewTurnId = activity.turnId
      else execution.turnId = activity.turnId
      task.status = activity.status!
      return this.save(row, execution)
    }
    if (task.status === 'waiting_dependency') {
      const dependencies = await resolveRoomDependencies(this.deps, execution)
      if (!dependencies) return
      execution.dependencyDeliveries = dependencies
      task.status = 'queued'
      return this.save(row, execution)
    }
    if (task.stage === 'review' && execution.reviewThreadId) return this.review(row, allowStart)
    if (task.status === 'stopping' && !execution.turnId) {
      const thread = await this.deps.threads.getMetadata(task.executionThreadId)
      execution.turnId = thread?.turns.find((turn) =>
        turn.clientRequestId === task.id + '-attempt-' + execution.attempt)?.id
      if (!execution.turnId) {
        if (thread?.turns.some((turn) => ['running', 'queued'].includes(turn.status))) {
          throw new Error('unidentified live task execution; preserve and reconcile before cancellation')
        }
        task.status = 'cancelled'
        task.latestProgress = '已取消未派发任务。'
      }
      return this.save(row, execution)
    }
    if (task.status === 'queued' && !execution.turnId) {
      if (!allowStart) return
      const workspaceRow = await this.deps.store.get<RoomWorkspace>('workspace', task.workspaceId)
      if (!workspaceRow) throw new Error('task workspace reservation missing')
      let workspace = workspaceRow.value
      if (workspace.state === 'ready') {
        try { await access(workspace.path) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await this.deps.assertOwnership()
          await mkdir(dirname(workspace.path), { recursive: true })
          await roomGit(workspace.repository.root, ['worktree', 'add', '--', workspace.path, workspace.branch])
        }
      }
      if (workspace.state === 'reserved') {
        await mkdir(dirname(workspace.path), { recursive: true })
        let exists = false
        try { await access(workspace.path); exists = true } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (exists) {
          await assertRoomTaskWorkspace({ taskId: task.id, workspacePath: workspace.path,
            workspaceBranch: workspace.branch, repository: workspace.repository, baseRevision: workspace.baseRevision })
        } else {
          await createRoomTaskWorktree({ repository: workspace.repository, taskId: task.id,
            destination: workspace.path, assertOwnership: this.deps.assertOwnership })
        }
        await materializeRoomDependencies(this.deps, execution, workspace)
        workspace = { ...workspace, state: 'ready' }
        await putRoomDocument(this.deps.store, 'workspace', workspace.id, task.roomId, workspace, workspaceRow, task.id)
      }
      await ensureRoomThread(this.deps, { id: task.executionThreadId, roomId: task.roomId,
        taskId: task.id, member: task.memberSnapshot, kind: 'execution', workspace: workspace.path,
        profile: execution.configuration })
      const prompt = [
        'Complete this authorized room task in this worktree. Preserve the source checkout.',
        'Report actual changes, checks with results, and remaining limitations. Do not merge or delete worktrees.',
        'Before running validation, declare exact checks with declare_room_checks. Only matched completed executions count as verified.',
        'Do not create independent subagents or new goals; collaboration is owned by the room coordinator.',
        JSON.stringify({ goal: execution.prompt, member: task.memberSnapshot, workspace: workspace.path,
          baseRevision: workspace.baseRevision, dependencies: execution.dependencyDeliveries ?? [],
          context: roomTaskContext(execution) })
      ].join('\n')
      execution.turnId = await enqueueRoomTurn(this.deps, task.executionThreadId,
        task.id + '-attempt-' + execution.attempt, prompt, execution.attachmentIds)
      task.latestProgress = '已提交到 Runtime 队列。'
      return this.save(row, execution)
    }
    if (!execution.turnId) return
    const observed = await observeRoomTurn(this.deps, task.executionThreadId, execution.turnId)
    if (observed.status === 'queued') {
      if (task.status === 'stopping') await stopRoomTaskTurn(this.deps, task.executionThreadId, execution.turnId)
      return
    }
    if (observed.status === 'running') {
      if (observed.segments?.length) {
        const originRunId = await roomTurnRunId(this.deps, task.roomId, task.executionThreadId, execution.turnId)
        if (originRunId) for (const segment of observed.segments) {
          await this.service.publishSegment(task.roomId, { messageId: roomRunSegmentMessageId(originRunId, segment.itemId),
            runId: originRunId, itemId: segment.itemId, body: segment.text, memberId: task.ownerMemberId,
            taskId: task.id, createdAt: segment.createdAt, status: 'streaming' })
        }
      }
      if (task.status === 'stopping') {
        await stopRoomTaskTurn(this.deps, task.executionThreadId, execution.turnId)
        return
      }
      const next = this.deps.approvals.pending(task.executionThreadId).length ? 'needs_approval' :
        this.deps.inputs.pending(task.executionThreadId).length ? 'needs_input' : 'running'
      if (task.status !== next) {
        task.status = next
        task.latestProgress = next === 'running' ? 'Runtime 正在执行。' : '请打开任务处理待授权或补充信息。'
        await this.save(row, execution)
      }
      return
    }
    if (task.status === 'stopping' && ['aborted', 'completed', 'failed'].includes(observed.status)) {
      task.status = 'cancelled'
      task.latestProgress = '执行器已确认停止；已有改动保留。'
      return this.save(row, execution)
    }
    if (observed.status !== 'completed') {
      task.status = observed.status === 'aborted' || observed.status === 'missing' ? 'recovery_required' : 'failed'
      task.latestProgress = observed.error ?? '执行中断，已有改动保留；请核对后重试。'
      return this.save(row, execution)
    }
    const currentThread = await this.deps.threads.getMetadata(task.executionThreadId)
    if (currentThread?.turns.some((turn) => turn.id !== execution.turnId && ['running', 'queued'].includes(turn.status))) {
      throw new Error('Another task turn is still active; reconcile it before freezing delivery')
    }
    const workspace = (await this.deps.store.get<RoomWorkspace>('workspace', task.workspaceId))!.value
    const deliveryId = 'delivery-' + task.id + '-' + execution.attempt
    let delivery = (await this.deps.store.get<RoomDelivery>('delivery', deliveryId))?.value
    if (!delivery) {
      const evidence = await captureRoomVerification(this.deps, {
        roomId: task.roomId, taskId: task.id, threadId: task.executionThreadId,
        turnId: execution.turnId, workspace: workspace.path, deliveryId
      })
      if (evidence.activeBackground) throw new Error('Background commands are still active; inspect and stop them before recovering delivery')
      delivery = await createRoomDelivery({ id: deliveryId, taskId: task.id,
        attemptId: 'attempt-' + execution.attempt, version: execution.attempt,
        workspacePath: workspace.path, workspaceBranch: workspace.branch,
        repository: workspace.repository, baseRevision: workspace.baseRevision,
        summary: observed.text.slice(0, 16000) || 'Runtime 已完成本次执行。',
        verification: evidence.verification, incomplete: evidence.incomplete,
        createdAt: task.updatedAt, assertOwnership: this.deps.assertOwnership,
        persistDiff: async (id, diff) => {
          await this.deps.store.commit({ requestId: 'diff-' + id,
            checks: [{ kind: 'artifact', id, expectedRevision: null }],
            puts: [{ kind: 'artifact', id, roomId: task.roomId, taskId: task.id, value: diff }],
            result: { id } })
        } })
      await this.deps.store.commit({ requestId: 'delivery-' + deliveryId,
        checks: [{ kind: 'delivery', id: deliveryId, expectedRevision: null }],
        puts: [{ kind: 'delivery', id: deliveryId, roomId: task.roomId, taskId: task.id, value: delivery }],
        events: [{ roomId: task.roomId, kind: 'delivery.created', payload: { id: deliveryId } }], result: { id: deliveryId } })
    }
    task.latestDeliveryId = delivery.id
    const passed = delivery.verification.filter((item) => item.status === 'passed').length
    task.verificationStatus = !delivery.verification.length ? 'not_run' :
      passed === delivery.verification.length && !delivery.incomplete.length ? 'passed' :
      passed ? 'partial' : 'failed'
    if (execution.reviewer) {
      task.stage = 'review'
      task.status = 'running'
      execution.reviewRepairs = 0
      execution.reviewThreadId = 'room-review-' + task.id + '-' + execution.attempt
      return this.save(row, execution)
    }
    task.status = 'awaiting_acceptance'
    task.latestProgress = '已交付，等待验收。'
    await this.save(row, execution)
    await this.service.append(task.roomId, 'delivered-' + delivery.id, delivery.summary, task.ownerMemberId, task.id)
  }

  private async review(row: RoomStoredDocument<RoomTaskExecution>, allowStart: boolean) {
    const execution = structuredClone(row.value)
    const { task } = execution
    if (execution.completedReviewRunId === execution.reviewThreadId) return
    if (!task.latestDeliveryId || !execution.reviewer) throw new Error('review has no pinned delivery or reviewer')
    const delivery = (await this.deps.store.get<RoomDelivery>('delivery', task.latestDeliveryId!))!.value
    const workspace = (await this.deps.store.get<RoomWorkspace>('workspace', task.workspaceId))!.value
    const reviewer = execution.reviewer!
    if (!execution.reviewTurnId) {
      const thread = await this.deps.threads.getMetadata(execution.reviewThreadId!)
      execution.reviewTurnId = thread?.turns.find((turn) =>
        turn.clientRequestId === 'review-' + execution.reviewThreadId ||
        turn.clientRequestId === 'review-' + delivery.id)?.id
      if (execution.reviewTurnId) return this.save(row, execution)
      if (task.status === 'stopping') {
        if (thread?.turns.some((turn) => ['running', 'queued'].includes(turn.status))) {
          throw new Error('unidentified live review execution; preserve and reconcile before cancellation')
        }
        task.status = 'cancelled'
        return this.save(row, execution)
      }
      if (!allowStart) return
      const reviewPath = join(this.deps.dataDir, 'rooms', 'reviews', delivery.id)
      await mkdir(dirname(reviewPath), { recursive: true })
      await prepareRoomReviewWorktree({ delivery, repository: workspace.repository,
        destination: reviewPath, assertOwnership: this.deps.assertOwnership })
      await ensureRoomThread(this.deps, { id: execution.reviewThreadId!, roomId: task.roomId,
        taskId: task.id, member: reviewer, kind: 'review', workspace: reviewPath,
        profile: execution.reviewerConfiguration })
      execution.reviewTurnId = await enqueueRoomTurn(this.deps, execution.reviewThreadId!,
        'review-' + execution.reviewThreadId, [
          'Review this immutable delivered version read-only. Submit with submit_room_review when available; otherwise return ONE JSON object only:',
          '{"verdict":"passed"|"changes_requested","findings":[{"severity":"blocking"|"major"|"minor","file"?:string,"line"?:number,"description":string}],"limitations":string[]}.',
          'Never claim tests ran if you only inspected code. Identify concrete defects.',
          JSON.stringify({ requirement: execution.prompt, userReviewRequest: execution.reviewRequest?.body, delivery,
            context: roomTaskContext(execution),
            diff: (await this.deps.store.get<string>('artifact', delivery.diffArtifactId))?.value })
        ].join('\n'), execution.reviewRequest?.attachmentIds ?? [])
      task.status = 'running'
      task.latestProgress = '正在评审交付版本 ' + delivery.versionHash.slice(0, 8)
      return this.save(row, execution)
    }
    const observed = await observeRoomTurn(this.deps, execution.reviewThreadId!, execution.reviewTurnId)
    if (observed.status === 'running' || observed.status === 'queued') {
      if (task.status === 'stopping') {
        await stopRoomTaskTurn(this.deps, execution.reviewThreadId!, execution.reviewTurnId)
      } else {
        const next = observed.status === 'queued' ? 'queued' :
          this.deps.approvals.pending(execution.reviewThreadId!).length ? 'needs_approval' :
          this.deps.inputs.pending(execution.reviewThreadId!).length ? 'needs_input' : 'running'
        if (task.status !== next) {
          task.status = next
          task.latestProgress = next === 'needs_approval' || next === 'needs_input' ?
            '请打开评审任务处理待授权或补充信息。' : '正在评审交付版本 ' + delivery.versionHash.slice(0, 8)
          await this.save(row, execution)
        }
      }
      return
    }
    if (task.status === 'stopping' && ['aborted', 'completed', 'failed'].includes(observed.status)) {
      task.status = 'cancelled'
      return this.save(row, execution)
    }
    // An accepted scoped submission is durable; a post-acceptance failure
    // (for example a transport error on the final synthesis round) must not
    // void the already-submitted review.
    const recoveredReview = observed.status !== 'completed' && observed.structured !== undefined
      ? RoomReviewResultSchema.safeParse(observed.structured)
      : undefined
    if (observed.status !== 'completed' && !recoveredReview?.success) {
      throw new Error(observed.error ?? 'review interrupted; preserve delivery')
    }
    let submitted
    try { submitted = recoveredReview?.success ? recoveredReview.data : RoomReviewResultSchema.parse(observed.structured ?? parseRoomJson(observed.text)) }
    catch (error) {
      if ((execution.reviewRepairs ?? 0) >= 2) throw new Error('评审结果格式连续无效；请单独重试评审。')
      execution.reviewRepairs = (execution.reviewRepairs ?? 0) + 1
      execution.reviewTurnId = await enqueueRoomTurn(this.deps, execution.reviewThreadId!,
        'review-repair-' + execution.reviewThreadId + '-' + execution.reviewRepairs,
        'Correct the review format only using submit_room_review. The pinned delivery is unchanged.\n' +
        JSON.stringify({ deliveryId: delivery.id, versionHash: delivery.versionHash,
          issues: String(error).slice(0, 4000), previous: observed.text.slice(-16000) }))
      return this.save(row, execution)
    }
    const reviewId = 'review-' + execution.reviewThreadId
    const existing = await this.deps.store.get<RoomReview>('review', reviewId)
    const review = existing?.value ?? RoomReviewSchema.parse({
      ...submitted,
      id: reviewId, taskId: task.id, deliveryId: delivery.id, versionHash: delivery.versionHash,
      reviewerMemberId: reviewer.id
    })
    if (!existing) await this.deps.store.commit({ requestId: reviewId,
      checks: [{ kind: 'review', id: review.id, expectedRevision: null }],
      puts: [{ kind: 'review', id: review.id, roomId: task.roomId, taskId: task.id, value: review }],
      events: [{ roomId: task.roomId, kind: 'review.created', payload: { id: review.id } }], result: { id: review.id } })
    if (review.deliveryId !== delivery.id || review.versionHash !== delivery.versionHash ||
      review.reviewerMemberId !== reviewer.id) throw new Error('review run identity does not cover this delivery and reviewer')
    execution.completedReviewRunId = execution.reviewThreadId
    if (review.verdict === 'changes_requested') {
      const policy = task.memberSnapshot.reviewPolicy
      if (policy?.allowAutomaticRework && execution.reworkRounds < Math.min(2, policy.maxReworkRounds)) {
        execution.abandoned = false
        execution.reworkRounds += 1
        execution.attempt += 1
        execution.turnId = undefined
        execution.reviewThreadId = undefined
        execution.reviewTurnId = undefined
        execution.reviewRepairs = 0
        execution.prompt += roomReviewFeedback(review)
        task.stage = 'fix'
        task.status = 'queued'
        task.latestDeliveryId = undefined
        task.acceptedDeliveryId = undefined
        task.applicationStatus = 'not_applied'
        task.verificationStatus = 'not_run'
        task.latestProgress = '已按授权进入第 ' + execution.reworkRounds + ' 轮修复。'
      } else {
        task.status = 'needs_input'
        task.latestProgress = '评审要求修改，等待你补充指令或授权返工。'
      }
    } else {
      task.status = 'awaiting_acceptance'
      task.latestProgress = '评审完成，等待验收。'
    }
    await this.save(row, execution)
    await this.service.append(task.roomId, 'review-result-' + reviewId,
      task.latestProgress + '\n' + review.findings.map((finding) => finding.description).join('\n'), reviewer.id, task.id)
  }

  async fail(row: RoomStoredDocument<RoomTaskExecution>, error: unknown) {
    const current = await this.deps.store.get<RoomTaskExecution>('task', row.id)
    if (!current || current.revision !== row.revision) return
    const execution = structuredClone(row.value)
    // A failed cancellation transport does not withdraw the user's stop intent.
    if (execution.task.status !== 'stopping') execution.task.status = 'recovery_required'
    execution.task.latestProgress = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
    await this.save(row, execution)
  }

  private async save(row: RoomStoredDocument<RoomTaskExecution>, execution: RoomTaskExecution) {
    execution.task.revision = row.revision + 1
    execution.task.updatedAt = new Date().toISOString()
    await putRoomDocument(this.deps.store, 'task', row.id, row.roomId!, execution, row, row.id)
  }
}
