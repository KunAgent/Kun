import { randomUUID } from 'node:crypto'
import {
  HumanCollaborationCommandSchema,
  LocalCollaborationSnapshotSchema,
  transitionHumanTask,
  type HumanCollaborationCommand,
  type LocalCollaborationSnapshot
} from '../../shared/collaboration/contracts'
import { LocalCollaborationStore } from './local-collaboration-store'
import type {
  ReceptionInvocationInspection,
  ReceptionInvocationStart
} from './reception-invocation-gateway'

export type ReceptionInvocationPort = {
  invoke(input: {
    publication: LocalCollaborationSnapshot['employees'][number]
    prompt: string
  }): Promise<ReceptionInvocationStart>
  interrupt(input: { threadId: string; turnId: string }): Promise<void>
  inspect(input: { threadId: string; turnId: string }): Promise<ReceptionInvocationInspection>
}

export class LocalCollaborationService {
  constructor(
    private readonly store: LocalCollaborationStore,
    private readonly receptionGateway?: ReceptionInvocationPort
  ) {}

  async getSnapshot(): Promise<LocalCollaborationSnapshot> {
    const snapshot = LocalCollaborationSnapshotSchema.parse(await this.store.load())
    if (!this.receptionGateway) return snapshot
    let changed = false
    await Promise.all(snapshot.invocations.map(async (invocation) => {
      if (invocation.status !== 'running' || !invocation.threadId || !invocation.turnId) return
      try {
        const result = await this.receptionGateway?.inspect({
          threadId: invocation.threadId,
          turnId: invocation.turnId
        })
        if (!result || result.status === 'running') return
        applyInspection(invocation, result)
        const employee = snapshot.employees.find((item) => item.employeeId === invocation.employeeId)
        if (employee) {
          employee.status = 'available'
          employee.updatedAt = invocation.updatedAt
        }
        changed = true
      } catch {
        // Keep the durable invocation running so a later refresh can recover.
      }
    }))
    if (changed) await this.store.save(snapshot)
    return snapshot
  }

  async dispatch(input: HumanCollaborationCommand): Promise<unknown> {
    const command = HumanCollaborationCommandSchema.parse(input)
    const snapshot = await this.store.load()
    if (Object.hasOwn(snapshot.commandResults, command.commandId)) {
      return snapshot.commandResults[command.commandId]
    }
    if (command.kind === 'employee_invoke') {
      return this.invokeEmployee(snapshot, command)
    }
    if (command.kind === 'employee_interrupt') {
      const invocation = snapshot.invocations.find((item) => item.id === command.invocationId)
      if (!invocation) throw new Error('Employee invocation not found')
      if (this.receptionGateway && invocation.threadId && invocation.turnId && invocation.status === 'running') {
        await this.receptionGateway.interrupt({ threadId: invocation.threadId, turnId: invocation.turnId })
      }
    }
    const result = this.apply(snapshot, command)
    snapshot.commandResults[command.commandId] = result
    await this.store.save(snapshot)
    return result
  }

  async applyRemoteInvocationResponse(input: {
    invocationId: string
    status: 'running' | 'completed' | 'failed' | 'interrupted'
    threadId?: string
    turnId?: string
    resultSummary?: string
    error?: string
  }): Promise<void> {
    const snapshot = await this.store.load()
    const invocation = snapshot.invocations.find((item) => item.id === input.invocationId)
    if (!invocation) throw new Error('Remote employee invocation was not found')
    invocation.status = input.status
    invocation.updatedAt = new Date().toISOString()
    if (input.threadId) invocation.threadId = input.threadId
    if (input.turnId) invocation.turnId = input.turnId
    if (input.resultSummary) invocation.resultSummary = input.resultSummary
    if (input.error) invocation.error = input.error
    await this.store.save(snapshot)
  }

  private async invokeEmployee(
    snapshot: LocalCollaborationSnapshot,
    command: Extract<HumanCollaborationCommand, { kind: 'employee_invoke' }>
  ): Promise<LocalCollaborationSnapshot['invocations'][number]> {
    const invocation = this.apply(snapshot, command) as LocalCollaborationSnapshot['invocations'][number]
    await this.store.save(snapshot)

    if (this.receptionGateway) {
      const publication = snapshot.employees.find((item) => item.employeeId === command.employeeId)
      if (!publication) throw new Error('Reception employee not found')
      if (publication.ownerDeviceId !== 'local') {
        snapshot.commandResults[command.commandId] = invocation
        await this.store.save(snapshot)
        return invocation
      }
      try {
        const started = await this.receptionGateway.invoke({ publication, prompt: command.prompt })
        Object.assign(invocation, started, { updatedAt: new Date().toISOString() })
        publication.status = 'busy'
        publication.updatedAt = invocation.updatedAt
      } catch (cause) {
        invocation.status = 'failed'
        invocation.error = cause instanceof Error ? cause.message : String(cause)
        invocation.updatedAt = new Date().toISOString()
      }
    }

    snapshot.commandResults[command.commandId] = invocation
    await this.store.save(snapshot)
    return invocation
  }

  private apply(snapshot: LocalCollaborationSnapshot, command: HumanCollaborationCommand): unknown {
    const now = new Date().toISOString()
    if (command.kind === 'meeting_create') {
      const meeting = {
        id: randomUUID(), title: command.title, description: command.description, status: 'active' as const,
        members: [{ id: 'local-user', displayName: '本机用户', role: 'owner', status: 'online' as const }],
        tasks: [], timeline: [{ id: randomUUID(), kind: 'meeting_created', actorId: 'local-user', summary: `创建会议：${command.title}`, createdAt: now }],
        createdAt: now, updatedAt: now, version: 1
      }
      snapshot.meetings.push(meeting)
      return meeting
    }
    if (command.kind === 'meeting_close') {
      const meeting = requireMeeting(snapshot, command.meetingId)
      meeting.status = 'closed'; meeting.updatedAt = now; meeting.version += 1
      meeting.timeline.push({ id: randomUUID(), kind: 'meeting_closed', actorId: 'local-user', summary: '会议已关闭', createdAt: now })
      return meeting
    }
    if (command.kind === 'meeting_member_upsert') {
      const meeting = requireMeeting(snapshot, command.meetingId)
      const member = {
        id: command.memberId,
        displayName: command.displayName,
        role: command.role,
        status: command.status
      }
      const index = meeting.members.findIndex((item) => item.id === command.memberId)
      if (index >= 0) meeting.members[index] = member
      else meeting.members.push(member)
      meeting.updatedAt = now; meeting.version += 1
      meeting.timeline.push({
        id: randomUUID(), kind: 'meeting_member_upserted', actorId: command.memberId,
        summary: `${command.displayName} 加入会议`, createdAt: now
      })
      return member
    }
    if (command.kind === 'meeting_member_remove') {
      const meeting = requireMeeting(snapshot, command.meetingId)
      const index = meeting.members.findIndex((item) => item.id === command.memberId)
      if (index < 0) return null
      const [member] = meeting.members.splice(index, 1)
      meeting.updatedAt = now; meeting.version += 1
      meeting.timeline.push({
        id: randomUUID(), kind: 'meeting_member_removed', actorId: command.memberId,
        summary: `${member.displayName} 已移出会议`, createdAt: now
      })
      return member
    }
    if (command.kind === 'human_task_create') {
      const meeting = requireMeeting(snapshot, command.meetingId)
      const task = {
        id: randomUUID(), meetingId: meeting.id, title: command.title, description: command.description,
        creatorId: 'local-user', targetMemberIds: command.targetMemberIds, status: 'proposed' as const,
        participants: command.targetMemberIds.map((memberId) => ({ memberId, decision: 'pending' as const, executionStatus: 'idle' as const })),
        progress: [], deliveries: [], createdAt: now, updatedAt: now, version: 1
      }
      meeting.tasks.push(task); meeting.updatedAt = now; meeting.version += 1
      meeting.timeline.push({ id: randomUUID(), kind: 'human_task_created', actorId: 'local-user', summary: `创建任务：${task.title}`, createdAt: now })
      return task
    }
    if (command.kind === 'human_task_transition') {
      const meeting = requireMeeting(snapshot, command.meetingId)
      const index = meeting.tasks.findIndex((task) => task.id === command.taskId)
      if (index < 0) throw new Error('Human collaboration task not found')
      const task = transitionHumanTask(meeting.tasks[index], command.action)
      meeting.tasks[index] = task; meeting.updatedAt = now; meeting.version += 1
      meeting.timeline.push({ id: randomUUID(), kind: `human_task_${command.action}`, actorId: 'local-user', summary: `${command.action}: ${task.title}`, createdAt: now })
      return task
    }
    if (command.kind === 'human_task_progress') {
      const meeting = requireMeeting(snapshot, command.meetingId)
      const task = meeting.tasks.find((item) => item.id === command.taskId)
      if (!task) throw new Error('Human collaboration task not found')
      const progress = { id: randomUUID(), memberId: 'local-user', summary: command.summary, percent: command.percent, createdAt: now }
      task.progress.push(progress); task.updatedAt = now; task.version += 1
      return progress
    }
    if (command.kind === 'employee_publish') {
      const publication = {
        id: randomUUID(), employeeId: command.employeeId, displayName: command.displayName,
        description: command.description, ownerDeviceId: command.ownerDeviceId ?? 'local',
        ...(command.ownerEncryptionPublicKey ? { ownerEncryptionPublicKey: command.ownerEncryptionPublicKey } : {}),
        allowedToolNames: command.allowedToolNames,
        status: 'available' as const, meetingIds: command.meetingIds, taskIds: command.taskIds, updatedAt: now
      }
      const index = snapshot.employees.findIndex((item) => item.employeeId === command.employeeId)
      if (index >= 0) snapshot.employees[index] = publication; else snapshot.employees.push(publication)
      return publication
    }
    if (command.kind === 'employee_invoke') {
      const employee = snapshot.employees.find((item) => item.employeeId === command.employeeId)
      if (!employee) throw new Error('Reception employee not found')
      const invocation = {
        id: randomUUID(), employeeId: employee.employeeId, requesterId: 'local-user', ownerDeviceId: employee.ownerDeviceId,
        status: 'awaiting_owner' as const, prompt: command.prompt, allowedToolNames: employee.allowedToolNames,
        ...(command.meetingId ? { meetingId: command.meetingId } : {}),
        createdAt: now, updatedAt: now
      }
      snapshot.invocations.push(invocation)
      return invocation
    }
    const invocation = snapshot.invocations.find((item) => item.id === command.invocationId)
    if (!invocation) throw new Error('Employee invocation not found')
    if (invocation.status !== 'interrupted') {
      invocation.status = 'interrupted'; invocation.updatedAt = now
      const employee = snapshot.employees.find((item) => item.employeeId === invocation.employeeId)
      if (employee) { employee.status = 'available'; employee.updatedAt = now }
    }
    return invocation
  }
}

function applyInspection(
  invocation: LocalCollaborationSnapshot['invocations'][number],
  result: Exclude<ReceptionInvocationInspection, { status: 'running' }>
): void {
  invocation.status = result.status
  invocation.updatedAt = new Date().toISOString()
  if ('resultSummary' in result && result.resultSummary) invocation.resultSummary = result.resultSummary
  if ('error' in result && result.error) invocation.error = result.error
}

function requireMeeting(snapshot: LocalCollaborationSnapshot, id: string) {
  const meeting = snapshot.meetings.find((item) => item.id === id)
  if (!meeting) throw new Error('Meeting not found')
  return meeting
}
