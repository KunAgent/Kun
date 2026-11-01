import { taskRevision } from './task-revision'
// What the Kun tools may do with the assistant mailbox. Inputs come from the model, so every
// field is checked here before it reaches the service; results are compact projections.
import { wakeMessage } from '@kun/assistant-agent'
import type { AssistantMailboxStatus, AssistantTaskSource, AssistantTaskView, AssistantView } from '../../shared/assistant-mailbox'
import { AssistantMailboxError, type AssistantMailboxService } from './service'

export const ASSISTANT_TOOL_ROUTES = new Set(['/assistants', '/tasks/assign', '/tasks/cancel', '/tasks/results', '/tasks/wait', '/tasks/continuation-authority'])

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined

function unavailable(status: AssistantMailboxStatus): never {
  const reasons: Record<string, string> = {
    disabled: 'Personal assistants are turned off. Ask the user to enable them in Settings > Lab.',
    unavailable: 'The Kun server does not offer the assistant mailbox yet.',
    login_required: 'The user must sign in to their Kun account first.'
  }
  throw new AssistantMailboxError('UNAVAILABLE', reasons[status.availability] ?? `Assistants are unavailable (${status.error ?? status.availability}).`)
}

function pickAssistant(assistants: AssistantView[], wanted: unknown): AssistantView {
  const key = text(wanted, 120)?.trim().toLowerCase()
  if (!key) throw new AssistantMailboxError('ASSISTANT_REQUIRED', 'Name the assistant (its name or id from list_assistants).')
  const matches = assistants.filter((item) => item.id === key || item.name.toLowerCase() === key)
  if (matches.length === 1) return matches[0]
  throw new AssistantMailboxError(matches.length ? 'ASSISTANT_AMBIGUOUS' : 'ASSISTANT_NOT_FOUND',
    matches.length ? `More than one assistant is called "${wanted}"; use its id.` : `No connected assistant matches "${wanted}". Call list_assistants.`)
}

function taskSummary(task: AssistantTaskView) {
  return {
    updateToken: taskRevision(task), taskId: task.id, assistant: task.assistantName, assistantId: task.assistantId, title: task.title, status: task.status,
    createdAt: task.createdAt, updatedAt: task.updatedAt, ...(task.deadline ? { deadline: task.deadline } : {}),
    updates: task.updates
  }
}

export function assistantToolHandler(service: AssistantMailboxService) {
  return async (route: string, body: Record<string, unknown>): Promise<unknown> => {
    if (route === '/tasks/continuation-authority') {
      const source = body.source as Record<string, unknown> | undefined
      if (!source || !['threadId', 'turnId', 'callId'].every(k => typeof source[k] === 'string' && (source[k] as string).length <= 256)
        || typeof body.taskId !== 'string' || typeof body.resultId !== 'string' || typeof body.owner !== 'string' || typeof body.goalCreatedAt !== 'string' || typeof body.sourceFingerprint !== 'string') throw new AssistantMailboxError('INVALID_REQUEST')
      return service.continuationAuthority({ taskId: body.taskId, resultId: body.resultId, owner: body.owner, goalCreatedAt: body.goalCreatedAt, sourceFingerprint: body.sourceFingerprint,
        source: { threadId: source.threadId as string, turnId: source.turnId as string, callId: source.callId as string } })
    }
    if (route === '/tasks/wait') {
      const id = text(body.taskId, 64)
      if (!id) throw new AssistantMailboxError('TASK_REQUIRED')
      const result = await service.waitForTask(id, text(body.after, 64), typeof body.timeoutMs === 'number' ? body.timeoutMs : 30000)
      return { ...result, task: taskSummary(result.task) }
    }
    const status = await service.refresh()
    if (status.availability !== 'available') unavailable(status)
    if (route === '/assistants') {
      return {
        assistants: status.assistants.map((item) => ({
          id: item.id, name: item.name, kind: item.kind, ...(item.product ? { product: item.product } : {}), lastSeenAt: item.lastSeenAt,
          waitingForAssistant: item.pendingToAssistant, canReceiveTasks: item.keyAvailable
        })),
        pendingEnrollments: status.enrollments.map((item) => ({ name: item.name, kind: item.kind, expiresAt: item.expiresAt }))
      }
    }
    if (route === '/tasks/assign') {
      const assistant = pickAssistant(status.assistants, body.assistant)
      const instructions = text(body.instructions, 40_000)
      if (!instructions) throw new AssistantMailboxError('INSTRUCTIONS_REQUIRED', 'instructions must describe the task.')
      const candidate = body.__kunSource
      const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null
      const validSource: AssistantTaskSource | undefined = source && Object.keys(source).length === 3 && ['threadId', 'turnId', 'callId'].every(key => typeof source[key] === 'string' && (source[key] as string).length > 0 && (source[key] as string).length <= 256)
        ? { threadId: source.threadId as string, turnId: source.turnId as string, callId: source.callId as string } : undefined
      const task = await service.assign({
        assistantId: assistant.id, body: instructions,
        ...(text(body.title, 200) ? { title: text(body.title, 200)!.replace(/[\r\n]+/g, ' ') } : {}),
        ...(text(body.deadline, 64) ? { deadline: text(body.deadline, 64) } : {})
      }, validSource)
      return { task: taskSummary(task), wakeMessage: wakeMessage({ kind: assistant.kind, locale: 'en' }) }
    }
    if (route === '/tasks/cancel') {
      const taskId = text(body.taskId, 64)
      if (!taskId) throw new AssistantMailboxError('TASK_REQUIRED', 'taskId is required.')
      return { task: taskSummary(await service.cancel(taskId, text(body.reason, 2000) ?? '')) }
    }
    const limit = Math.min(20, Math.max(1, Number.isInteger(body.limit) ? Number(body.limit) : 10))
    const assistant = body.assistant === undefined ? undefined : pickAssistant(status.assistants, body.assistant)
    const taskId = text(body.taskId, 64)
    const lookup = taskId ? await service.taskById(taskId) : undefined
    const tasks = (taskId ? lookup ? [lookup] : [] : status.tasks)
      .filter((task) => (!taskId || task.id === taskId || task.id.startsWith(taskId)) && (!assistant || task.assistantId === assistant.id))
      .slice(0, limit)
    if (taskId && !tasks.length) throw new AssistantMailboxError('TASK_NOT_FOUND', `No task ${taskId}.`)
    const notes = taskId ? [] : status.notes.filter((note) => !assistant || note.assistantId === assistant.id).slice(0, limit)
    return { tasks: tasks.map(taskSummary), notes, lastSyncAt: status.lastSyncAt }
  }
}
