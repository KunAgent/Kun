import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'

afterEach(() => vi.unstubAllGlobals())
describe('atomic execution-task runtime client', () => {
  it('sends only one CAS patch and loads the canonical projection', async () => {
    const todos = { threadId: 'thread', revision: 3, updatedAt: 'now', items: [{ id: 'task', content: 'Task',
      status: 'completed', taskStatus: 'succeeded', taskRevision: 2, createdAt: 'now', updatedAt: 'now' }] }
    const runtimeRequest = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ task: { id: 'task' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ todos }) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    const provider = new KunRuntimeProvider()
    expect(await provider.updateThreadExecutionTask('thread', 'task', { expectedRevision: 1, clientRequestId: 'finish', status: 'completed' })).toEqual(todos)
    expect(runtimeRequest).toHaveBeenNthCalledWith(1, '/v1/threads/thread/tasks/task', 'PATCH', JSON.stringify({
      expectedRevision: 1, clientRequestId: 'finish', status: 'succeeded', evidence: [{ summary: 'Marked complete by the user in the task controls.' }]
    }))
    expect(runtimeRequest).toHaveBeenNthCalledWith(2, '/v1/threads/thread/todos', 'GET')
  })
  it('surfaces version conflicts without a full-list write or automatic overwrite', async () => {
    const runtimeRequest = vi.fn().mockResolvedValue({ ok: false, status: 409,
      body: JSON.stringify({ code: 'conflict', message: 'Task changed; refresh it.' }) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    await expect(new KunRuntimeProvider().updateThreadExecutionTask('thread', 'task', {
      expectedRevision: 1, clientRequestId: 'finish', status: 'completed'
    })).rejects.toThrow(/changed/)
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })
})
