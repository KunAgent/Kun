import { describe, expect, it, vi } from 'vitest'
import {
  requestOfficialProviderCliInstall,
  requestOfficialProviderCliModels,
  requestOfficialProviderCliStatus,
  startOfficialProviderCliProgress
} from './runtime-official-provider-cli'

describe('runtime official provider CLI forwarding', () => {
  it('forwards legacy Main calls to the Runtime-owned API', async () => {
    const runtimeRequest = vi.fn(async (path: string, method?: string) => ({
      ok: true,
      status: 200,
      body: JSON.stringify(path.endsWith('/status')
        ? { installed: true, version: '1.1.8', directory: '/runtime/cli', download: null }
        : path.endsWith('/install')
          ? { status: 'done', receivedBytes: 1, totalBytes: 1 }
          : { models: [] })
    }))

    await expect(requestOfficialProviderCliStatus(runtimeRequest)).resolves.toMatchObject({ installed: true })
    await expect(requestOfficialProviderCliInstall(runtimeRequest)).resolves.toMatchObject({ status: 'done' })
    await expect(requestOfficialProviderCliModels(runtimeRequest)).resolves.toEqual({ models: [] })
    expect(runtimeRequest.mock.calls).toEqual([
      ['/v1/model-connections/official-cli/status', 'GET'],
      ['/v1/model-connections/official-cli/install', 'POST'],
      ['/v1/model-connections/official-cli/models', 'GET']
    ])
  })

  it('emits progress states until Runtime reaches a terminal install state', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const states = ['downloading', 'downloading', 'done'] as const
      const runtimeRequest = vi.fn(async () => {
        calls += 1
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            installed: calls >= 3,
            version: '1.1.8',
            directory: '/runtime/cli',
            download: {
              status: states[Math.min(calls - 1, states.length - 1)],
              receivedBytes: calls,
              totalBytes: 3
            }
          })
        }
      })
      const emitted: unknown[] = []
      const stop = startOfficialProviderCliProgress(runtimeRequest, (state) => emitted.push(state), 10)
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(50)
      expect(emitted).toEqual([
        { status: 'downloading', receivedBytes: 1, totalBytes: 3 },
        { status: 'downloading', receivedBytes: 2, totalBytes: 3 },
        { status: 'done', receivedBytes: 3, totalBytes: 3 }
      ])
      expect(calls).toBe(3)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed on malformed or failed Runtime responses', async () => {
    await expect(requestOfficialProviderCliStatus(async () => ({
      ok: true, status: 200, body: 'not-json'
    }))).rejects.toThrow('malformed')
    await expect(requestOfficialProviderCliModels(async () => ({
      ok: false,
      status: 503,
      body: JSON.stringify({ error: { message: 'official provider CLI is unavailable' } })
    }))).rejects.toThrow('official provider CLI is unavailable')
  })
})
