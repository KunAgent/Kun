import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { RoomMember, RoomMessage } from '../contracts/rooms.js'
import { RoomTaskSchema } from '../contracts/room-tasks.js'
import { RoomCoordinationPlanSchema, parseRoomJson, roomCoordinationPrompt } from './room-coordination-plan.js'
import { ensureRoomThread, enqueueRoomTurn, observeRoomTurn } from './room-execution.js'
import { putRoomDocument, RoomService } from './room-service.js'
import { resolveRoomRecipients, resolveRoomRepository } from './room-router.js'
import type { RoomRuntimeDeps, RoomRequestState, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import type { RoomStoredDocument } from './room-store.js'
import { observeRoomRepository } from './task-workspace-service.js'

export class RoomRequestRunner {
  constructor(private readonly deps: RoomRuntimeDeps, private readonly service: RoomService) {}

  async tick(row: RoomStoredDocument<RoomRequestState>): Promise<void> {
    const request = structuredClone(row.value)
    const room = request.roomSnapshot
    const route = resolveRoomRecipients({ room, message: request.message,
      ...(request.message.taskId ? { referencedTask: await this.referenced(request) } : {}) })
    if (route.kind === 'clarify') return this.finish(row, 'needs_input', route.reason)
    if (request.message.taskId) return this.amend(row)
    if (request.stage === 'discuss') return this.discuss(row)
    const coordinator = room.members.find((member) => member.id === room.defaultMemberId)!
    const recent = await this.deps.store.list<RoomMessage>('message', { roomId: room.id, limit: 30,
      beforeSeq: (await this.deps.store.get('message', request.sourceMessageId))?.seq })
    const rules = await this.deps.store.list('rule', { roomId: room.id, limit: 100 })
    await ensureRoomThread(this.deps, { id: request.threadId, roomId: room.id,
      member: coordinator, kind: 'coordination' })
    if (!request.turnId) {
      request.turnId = await enqueueRoomTurn(this.deps, request.threadId,
        'coordinate-' + request.id + '-' + (request.round ?? 0),
        roomCoordinationPrompt(request, recent.reverse().map((entry) => entry.value), rules.map((entry) => entry.value)),
        request.message.attachmentIds)
      request.status = 'running'
      return this.save(row, request)
    }
    const observed = await observeRoomTurn(this.deps, request.threadId, request.turnId)
    if (observed.status === 'queued' || observed.status === 'running') return
    if (observed.status !== 'completed') {
      return this.finish(row, 'failed', observed.error ?? '协调未完成，请重发或补充要求。')
    }
    const plan = RoomCoordinationPlanSchema.parse(parseRoomJson(observed.text))
    if (plan.kind === 'execute') {
      if (request.message.executionIntent === 'discussion') throw new Error('discussion cannot authorize execution')
      if (!plan.assignments.length) throw new Error('execution plan has no assignments')
      const seen = new Set<string>()
      const prepared: Array<{ execution: RoomTaskExecution; workspace: RoomWorkspace }> = []
      for (const assignment of plan.assignments) {
        if (seen.has(assignment.key) || assignment.dependsOn.some((key) => !seen.has(key))) {
          throw new Error('task dependencies must refer to unique earlier assignments')
        }
        seen.add(assignment.key)
        if (room.collaborationMode === 'directed' && !route.memberIds.includes(assignment.memberId)) {
          throw new Error('directed request cannot assign an unaddressed member')
        }
        const member = room.members.find((member) => member.id === assignment.memberId &&
          member.enabled && !member.removedAt)
        if (!member || member.role === 'reviewer' || member.role === 'coordinator') {
          throw new Error('execution needs an enabled developer or diagnostician')
        }
        const task = await this.prepareTask(request, assignment, member)
        if (task) prepared.push(task)
      }
      if (prepared.length) {
        await this.deps.store.commit({ requestId: 'plan-' + request.id,
          checks: prepared.flatMap(({ execution }) => [
            { kind: 'task' as const, id: execution.task.id, expectedRevision: null },
            { kind: 'workspace' as const, id: execution.task.id, expectedRevision: null }]),
          puts: prepared.flatMap(({ execution, workspace }) => [
            { kind: 'task' as const, id: execution.task.id, roomId: room.id, taskId: execution.task.id, value: execution },
            { kind: 'workspace' as const, id: workspace.id, roomId: room.id, taskId: workspace.id, value: workspace }]),
          events: prepared.map(({ execution }) => ({ roomId: room.id, kind: 'task.created', payload: { id: execution.task.id } })),
          result: { taskIds: prepared.map(({ execution }) => execution.task.id) } })
      }
      for (const { execution } of prepared) {
        await this.service.append(room.id, 'created-' + execution.task.id,
          execution.task.title + ' · 排队中', execution.task.ownerMemberId, execution.task.id)
      }
      return this.finish(row, 'completed', plan.response)
    }
    const addressedAnswer = plan.kind === 'answer' && (request.round ?? 0) === 0 &&
      request.message.mentionMemberIds.length > 0
    if ((plan.kind === 'discussion' || addressedAnswer) && (request.round ?? 0) < room.maxDiscussionRounds) {
      const participants = room.collaborationMode === 'directed' || addressedAnswer ? route.memberIds : plan.participants
      if (!participants.length || participants.some((id) => !room.members.some((member) =>
        member.id === id && member.enabled && !member.removedAt))) throw new Error('invalid discussion participants')
      request.discussions = [...new Set(participants)].map((memberId) => ({
        memberId, threadId: 'room-member-' + request.id + '-' + (request.round ?? 0) + '-' + memberId
      }))
      request.stage = 'discuss'
      return this.save(row, request)
    }
    return this.finish(row, plan.kind === 'clarify' ? 'needs_input' : 'completed',
      plan.response + (plan.kind === 'discussion' ? '\n已达到本次讨论轮数上限，等待你继续。' : ''))
  }

  private async discuss(row: RoomStoredDocument<RoomRequestState>) {
    const request = structuredClone(row.value)
    for (const discussion of request.discussions ?? []) {
      if (discussion.response !== undefined) continue
      const member = request.roomSnapshot.members.find((member) => member.id === discussion.memberId)!
      const repository = request.roomSnapshot.repositories.find((repo) => repo.id === member.defaultRepositoryId &&
        member.allowedRepositoryIds.includes(repo.id))
      await ensureRoomThread(this.deps, { id: discussion.threadId, roomId: request.roomId, member,
        kind: 'discussion', workspace: repository?.canonicalRoot })
      if (!discussion.turnId) {
        discussion.turnId = await enqueueRoomTurn(this.deps, discussion.threadId,
          'discussion-' + request.id + '-' + (request.round ?? 0) + '-' + member.id,
          ['Participate as this room member. Discuss or inspect read-only. Do not implement or run commands.',
            JSON.stringify({ member, request: request.message, priorResponses: request.discussions })].join('\n'),
          request.message.attachmentIds)
        return this.save(row, request)
      }
      const observed = await observeRoomTurn(this.deps, discussion.threadId, discussion.turnId)
      if (observed.status === 'running' || observed.status === 'queued') {
        if (observed.text) await this.service.publish(request.roomId, 'reply-' + discussion.threadId, observed.text, member.id)
        return
      }
      discussion.response = observed.status === 'completed' ? observed.text : observed.error ?? '成员本轮未完成。'
      await this.service.publish(request.roomId, 'reply-' + discussion.threadId, discussion.response, member.id)
      return this.save(row, request)
    }
    request.round = (request.round ?? 0) + 1
    if (request.roomSnapshot.collaborationMode === 'directed') {
      request.status = 'completed'
      return this.save(row, request)
    }
    request.stage = 'coordinate'
    request.turnId = undefined
    // Each round has a distinct immutable input and idempotency key.
    await this.save(row, request)
  }

  private async prepareTask(request: RoomRequestState,
    assignment: ReturnType<typeof RoomCoordinationPlanSchema.parse>['assignments'][number], member: RoomMember) {
    const id = 'task-' + request.id + '-' + assignment.key
    if (await this.deps.store.get('task', id)) return
    const room = request.roomSnapshot
    const resolved = resolveRoomRepository({ room, memberId: member.id,
      explicitRepositoryId: request.message.repositoryId ?? assignment.repositoryId })
    if (!resolved.ok) throw new Error(resolved.reason)
    const repo = room.repositories.find((repo) => repo.id === resolved.repositoryId)!
    const observed = await observeRoomRepository(repo.canonicalRoot)
    if (observed.root !== repo.canonicalRoot || observed.commonDir !== repo.gitCommonDir ||
      observed.operationInProgress) throw new Error('repository changed or has an unfinished operation')
    if (repo.defaultBaseRef && repo.defaultBaseRef !== observed.branch) {
      throw new Error('repository branch changed; update room repository configuration')
    }
    const reviewerId = assignment.reviewerMemberId ?? member.reviewPolicy?.reviewerMemberId
    const reviewerSource = reviewerId ? room.members.find((candidate) => candidate.id === reviewerId &&
      candidate.enabled && !candidate.removedAt && candidate.allowedRepositoryIds.includes(repo.id)) : undefined
    if (reviewerId && (!reviewerSource || reviewerSource.id === member.id)) throw new Error('reviewer unavailable or unauthorized')
    const freeze = (source: RoomMember): RoomMember => {
      const profile = this.deps.profiles()[source.presetId]
      const binding = source.modelRef ?? (profile?.model && profile.providerId
        ? { model: profile.model, providerId: profile.providerId } : this.deps.model())
      return { ...source, modelRef: { ...binding, providerId: binding.providerId ?? 'default' } }
    }
    const reviewer = reviewerSource ? freeze(reviewerSource) : undefined
    const task = RoomTaskSchema.parse({ id, roomId: room.id, requestId: request.id,
      sourceMessageId: request.sourceMessageId, title: assignment.title,
      ownerMemberId: member.id, memberSnapshot: freeze(member), repositoryId: repo.id, workspaceId: id,
      executionThreadId: 'room-execution-' + id,
      status: assignment.dependsOn.length ? 'waiting_dependency' : 'queued',
      stage: 'develop', requirementRevision: 0, revision: 0, updatedAt: new Date().toISOString() })
    const execution: RoomTaskExecution = { task, prompt: assignment.prompt,
      attachmentIds: request.message.attachmentIds,
      dependencyTaskIds: assignment.dependsOn.map((key) => 'task-' + request.id + '-' + key),
      attempt: 1, reworkRounds: 0, reviewer, configuration: this.deps.profiles()[member.presetId] ?? null,
      reviewerConfiguration: reviewer ? this.deps.profiles()[reviewer.presetId] ?? null : null,
      rulesSnapshot: (await this.deps.store.list('rule', { roomId: room.id, limit: 100 })).map((row) => row.value) }
    const workspace: RoomWorkspace = { id, taskId: id, roomId: room.id,
      path: join(this.deps.dataDir, 'rooms', 'worktrees', id), branch: 'codex/rooms/' + id,
      baseRevision: observed.head, repository: observed, state: 'reserved' }
    return { execution, workspace }
  }

  private async referenced(request: RoomRequestState) {
    const found = await this.deps.store.get<RoomTaskExecution>('task', request.message.taskId!)
    return found?.roomId === request.roomId ? found.value.task : undefined
  }

  private async amend(row: RoomStoredDocument<RoomRequestState>) {
    const request = row.value
    const taskRow = await this.deps.store.get<RoomTaskExecution>('task', request.message.taskId!)
    if (!taskRow || taskRow.roomId !== request.roomId) throw new Error('task not found')
    const execution = structuredClone(taskRow.value)
    if (execution.task.status === 'stopping') {
      return this.finish(row, 'needs_input', '任务正在停止，请等待执行器确认后补充要求。')
    }
    if (request.message.mentionMemberIds.some((id) => id !== execution.task.ownerMemberId)) {
      const reviewer = request.roomSnapshot.members.find((member) =>
        request.message.mentionMemberIds.includes(member.id) && member.role === 'reviewer')
      if (!reviewer || !reviewer.allowedRepositoryIds.includes(execution.task.repositoryId)) {
        return this.finish(row, 'needs_input', '请选择任务负责人补充要求，或指定有仓库权限的评审成员。')
      }
      if (execution.reviewThreadId && (await this.deps.threads.getMetadata(execution.reviewThreadId))?.turns
        .some((turn) => turn.id === execution.reviewTurnId && ['running', 'queued'].includes(turn.status))) {
        return this.finish(row, 'needs_input', '当前评审仍在执行，请等待完成或先取消。')
      }
      const config = this.deps.profiles()[reviewer.presetId]
      const binding = reviewer.modelRef ?? (config?.model && config.providerId ?
        { model: config.model, providerId: config.providerId } : this.deps.model())
      execution.reviewer = { ...reviewer, modelRef: { ...binding, providerId: binding.providerId ?? 'default' } }
      execution.reviewerConfiguration = config ?? null
      if (execution.task.latestDeliveryId && !['queued', 'running', 'stopping', 'needs_approval'].includes(execution.task.status)) {
        execution.task.stage = 'review'
        execution.task.status = 'running'
        execution.task.acceptedDeliveryId = undefined
        execution.reviewThreadId = 'room-review-' + createHash('sha256').update(request.id).digest('hex').slice(0, 32)
        execution.reviewTurnId = undefined
      }
    } else if (execution.turnId && (await this.deps.threads.getMetadata(execution.task.executionThreadId))?.turns
      .some((turn) => turn.id === execution.turnId && turn.status === 'running')) {
      await this.deps.turns.steerTurn({ operationId: request.id, threadId: execution.task.executionThreadId,
        turnId: execution.turnId, text: request.message.body, attachmentIds: request.message.attachmentIds })
    } else {
      if (execution.turnId && (await this.deps.threads.getMetadata(execution.task.executionThreadId))?.turns
        .some((turn) => turn.id === execution.turnId && turn.status === 'queued')) {
        await this.deps.turns.cancelQueuedTurn({ threadId: execution.task.executionThreadId, turnId: execution.turnId })
      }
      if (execution.reviewThreadId && execution.reviewTurnId) {
        const reviewTurn = (await this.deps.threads.getMetadata(execution.reviewThreadId))?.turns
          .find((turn) => turn.id === execution.reviewTurnId)
        if (reviewTurn?.status === 'running' || reviewTurn?.status === 'queued') {
          return this.finish(row, 'needs_input', '评审尚未停止，请先取消或等待完成再开始修复。')
        }
      }
      execution.prompt += '\nAdditional user requirement:\n' + request.message.body
      execution.attachmentIds = [...new Set([...execution.attachmentIds, ...request.message.attachmentIds])]
      execution.attempt += 1
      execution.turnId = undefined
      execution.reviewThreadId = undefined
      execution.reviewTurnId = undefined
      execution.task.status = 'queued'
      execution.task.stage = 'fix'
      execution.task.acceptedDeliveryId = undefined
      execution.task.latestDeliveryId = undefined
      execution.task.applicationStatus = 'not_applied'
      execution.task.verificationStatus = 'not_run'
    }
    execution.task.requirementRevision += 1
    execution.task.latestProgress = '补充已接收；执行中的补充在下一个可接收点生效。'
    execution.task.revision = taskRow.revision + 1
    await this.deps.store.commit({ requestId: 'amend-' + request.id,
      checks: [{ kind: 'task', id: taskRow.id, expectedRevision: taskRow.revision },
        { kind: 'request', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'task', id: taskRow.id, roomId: request.roomId, taskId: taskRow.id, value: execution },
        { kind: 'request', id: row.id, roomId: request.roomId, value: { ...request, status: 'completed' } }],
      events: [{ roomId: request.roomId, kind: 'task.amended', payload: { id: taskRow.id, requestId: request.id } }],
      result: { taskId: taskRow.id } })
    await this.service.append(request.roomId, 'result-' + request.id, '补充已关联到任务。',
      request.roomSnapshot.defaultMemberId, taskRow.id)
  }

  private async finish(row: RoomStoredDocument<RoomRequestState>, status: RoomRequestState['status'], body: string) {
    await this.service.append(row.roomId!, 'result-' + row.id, body || '本次讨论已结束。',
      row.value.roomSnapshot.defaultMemberId, row.value.message.taskId)
    await this.save(row, { ...row.value, status })
  }
  private async save(row: RoomStoredDocument<RoomRequestState>, value: RoomRequestState) {
    await putRoomDocument(this.deps.store, 'request', row.id, row.roomId!, value, row)
  }
}
