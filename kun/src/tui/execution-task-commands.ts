import { randomUUID } from 'node:crypto'
import type { ExecutionTask } from '../contracts/execution-tasks.js'
import type { KunTuiClient } from './client.js'
import { splitWords } from './controller-utils.js'

type Client = Pick<KunTuiClient, 'listExecutionTasks' | 'createExecutionTask' | 'updateExecutionTask'>
export async function executionTaskCommand(client: Client, threadId: string, input: string): Promise<{ lines?: string[]; message?: string }> {
  const [verb = 'list', target = '', ...rest] = splitWords(input || 'list')
  if (verb === 'add') {
    const title = [target, ...rest].join(' ').trim()
    if (!title) throw new Error('Usage: /tasks add <task>')
    await client.createExecutionTask(threadId, { title, clientRequestId: randomUUID() })
    return { message: 'Execution task created.' }
  }
  if (['start', 'clear', 'move'].includes(verb)) {
    throw new Error('Tasks are atomic records. Execution owns running state; use /tasks cancel <id> to cancel a pending task or /tasks priority <id> <number> to order work.')
  }
  const tasks: ExecutionTask[] = []
  let cursor: string | undefined
  do {
    const page = await client.listExecutionTasks(threadId, cursor)
    tasks.push(...page.tasks); cursor = page.nextCursor
  } while (cursor)
  if (verb === 'list') return { lines: tasks.length ? tasks.map((task, index) =>
    `${index + 1}. [${task.status}] ${task.title}\n   ${task.id} · revision ${task.revision} · owner ${task.ownerThreadId}${task.reason ? `\n   ${task.reason}` : ''}`)
    : ['No execution tasks. Usage: /tasks add <task>'] }
  const task = tasks.find((task) => task.id === target) ?? tasks[Number(target) - 1]
  if (!task) throw new Error(`Unknown task: ${target}`)
  const base = { clientRequestId: randomUUID(), expectedRevision: task.revision }
  if (verb === 'edit') {
    const title = rest.join(' ').trim()
    if (!title) throw new Error('Usage: /tasks edit <number|id> <text>')
    await client.updateExecutionTask(threadId, task.id, { ...base, title })
  } else if (verb === 'done') {
    await client.updateExecutionTask(threadId, task.id, { ...base, status: 'succeeded',
      evidence: [{ summary: 'Marked complete by the user through /tasks done.' }] })
  } else if (verb === 'cancel' || verb === 'delete') {
    await client.updateExecutionTask(threadId, task.id, { ...base, status: 'cancelled' })
  } else if (verb === 'pending') {
    await client.updateExecutionTask(threadId, task.id, { ...base, status: 'pending' })
  } else if (verb === 'priority') {
    await client.updateExecutionTask(threadId, task.id, { ...base, priority: Number(rest[0]) })
  } else throw new Error('Usage: /tasks [list|add|edit|done|pending|cancel|priority]')
  return { message: 'Execution task updated.' }
}
