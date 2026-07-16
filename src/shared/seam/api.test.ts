import { afterEach, describe, expect, it, vi } from 'vitest'
import { expertsApi } from './api'

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
})
