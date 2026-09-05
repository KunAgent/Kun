import { describe, expect, it, vi } from 'vitest'
import type { ThreadService } from '../../services/thread-service.js'
import { syncThreadTodosFromPlan } from './thread-todos-sync-plan.js'

function request(body: unknown): Request {
  return new Request('http://localhost/v1/threads/thr_1/todos/sync-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('syncThreadTodosFromPlan', () => {
  it('validates input and uses document_edit mode', async () => {
    const syncTodosFromPlan = vi.fn(async () => ({
      threadId: 'thr_1', items: [], updatedAt: '2026-08-31T00:00:00.000Z'
    }))
    const service = { syncTodosFromPlan } as unknown as ThreadService
    const body = { planId: 'plan_1', relativePath: '.kunsdd/plan/demo.md', markdown: '- [ ] task' }

    const response = await syncThreadTodosFromPlan(service, 'thr_1', request(body))

    expect(response.status).toBe(200)
    expect(syncTodosFromPlan).toHaveBeenCalledWith('thr_1', { ...body, mode: 'document_edit' })
  })

  it('rejects an invalid request before calling the service', async () => {
    const syncTodosFromPlan = vi.fn()
    const service = { syncTodosFromPlan } as unknown as ThreadService

    const response = await syncThreadTodosFromPlan(service, 'thr_1', request({ markdown: 1 }))

    expect(response.status).toBe(400)
    expect(syncTodosFromPlan).not.toHaveBeenCalled()
  })
})
