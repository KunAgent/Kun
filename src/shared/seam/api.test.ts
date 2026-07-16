import { afterEach, describe, expect, it, vi } from 'vitest'
import { collaborationApi, expertsApi, moaApi } from './api'

describe('extension seam renderer API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the kunGui bridge and returns the parsed response body', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ experts: [{ id: 'reviewer' }], teams: [] })
    }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    await expect(expertsApi.list()).resolves.toEqual({
      experts: [{ id: 'reviewer' }],
      teams: []
    })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/experts', 'GET')
  })

  it('surfaces the runtime error body instead of returning an empty payload', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({
          ok: false,
          status: 503,
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }))
      }
    })

    await expect(expertsApi.list()).rejects.toThrow('Expert service unavailable')
  })

  it('activates and deactivates experts through explicit queue endpoints', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ activeExpertIds: ['reviewer'], activeTeamIds: [] })
    }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    await expertsApi.activate('reviewer')
    await expertsApi.deactivate('reviewer')

    expect(runtimeRequest).toHaveBeenNthCalledWith(1, '/v1/experts/reviewer/activate', 'POST')
    expect(runtimeRequest).toHaveBeenNthCalledWith(2, '/v1/experts/reviewer/deactivate', 'POST')
  })

  it('uses typed task control endpoints with the owning plan id', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ task: { id: 'task-1', status: 'interrupted' } })
    }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    await collaborationApi.interruptTask('task-1', 'plan-1')
    await collaborationApi.retryTask('task-1', 'plan-1')

    expect(runtimeRequest).toHaveBeenNthCalledWith(
      1,
      '/v1/collaboration/tasks/task-1/interrupt?planId=plan-1',
      'POST'
    )
    expect(runtimeRequest).toHaveBeenNthCalledWith(
      2,
      '/v1/collaboration/tasks/task-1/retry?planId=plan-1',
      'POST'
    )
  })

  it('saves and deletes MoA presets through the runtime seam', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    const draft = { id: 'review-board' }

    await moaApi.savePreset(draft)
    await moaApi.deletePreset('review-board')

    expect(runtimeRequest).toHaveBeenNthCalledWith(1, '/v1/moa/presets', 'POST', JSON.stringify(draft))
    expect(runtimeRequest).toHaveBeenNthCalledWith(2, '/v1/moa/presets/review-board', 'DELETE')
  })
})
