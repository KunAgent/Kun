import { describe, expect, it, vi } from 'vitest'
import { ExecutionTaskSchema } from '../contracts/execution-tasks.js'
import { executionTaskCommand } from './execution-task-commands.js'

function client() {
  const task = ExecutionTaskSchema.parse({ id: 'task', title: 'Task', status: 'pending', revision: 2,
    ownerThreadId: 'thread', createdAt: 'now', updatedAt: 'now' })
  return { listExecutionTasks: vi.fn(async () => ({ tasks: [task], revision: 3, runnable: ['task'] })),
    createExecutionTask: vi.fn(async () => ({ task, replayed: false })),
    updateExecutionTask: vi.fn(async () => ({ task, replayed: false })) }
}
describe('TUI canonical execution task commands', () => {
  it('creates one task and never writes a replacement list', async () => {
    const api = client()
    await executionTaskCommand(api, 'thread', 'add Verify build')
    expect(api.createExecutionTask).toHaveBeenCalledWith('thread', { title: 'Verify build', clientRequestId: expect.any(String) })
    expect(api.listExecutionTasks).not.toHaveBeenCalled()
  })
  it('uses the read revision and explicit user evidence for completion', async () => {
    const api = client()
    await executionTaskCommand(api, 'thread', 'done 1')
    expect(api.updateExecutionTask).toHaveBeenCalledWith('thread', 'task', expect.objectContaining({
      expectedRevision: 2, clientRequestId: expect.any(String), status: 'succeeded', evidence: expect.any(Array)
    }))
  })
  it('preserves history on delete and does not fabricate running state', async () => {
    const api = client()
    await executionTaskCommand(api, 'thread', 'delete task')
    expect(api.updateExecutionTask).toHaveBeenCalledWith('thread', 'task', expect.objectContaining({ status: 'cancelled' }))
    await expect(executionTaskCommand(api, 'thread', 'start task')).rejects.toThrow(/Execution owns running/)
    await expect(executionTaskCommand(api, 'thread', 'clear')).rejects.toThrow(/atomic records/)
  })
})
