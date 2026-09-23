import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  MODEL_CONNECTION_WATCH_FAILURE_RETRY_MAX_MS,
  MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS,
  MODEL_CONNECTION_WATCH_INITIAL_RETRY_MS,
  nextModelConnectionWatchDelayMs,
  resetModelConnectionWatchForTests,
  subscribeModelConnectionWatch
} from './model-connection-watch'

function snapshotBody(revision: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision,
    providers: [],
    defaultProviderId: 'deepseek',
    defaultModel: 'deepseek-v4-pro'
  })
}

describe('nextModelConnectionWatchDelayMs', () => {
  it('retries the first snapshot after a pause, not immediately', () => {
    expect(nextModelConnectionWatchDelayMs({
      failed: true,
      hasRevision: false,
      failureDelayMs: MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS
    })).toEqual({
      delayMs: MODEL_CONNECTION_WATCH_INITIAL_RETRY_MS,
      nextFailureDelayMs: MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS * 2
    })
  })

  it('backs off failed event polls instead of using a zero delay', () => {
    expect(nextModelConnectionWatchDelayMs({
      failed: true,
      hasRevision: true,
      failureDelayMs: 4_000
    })).toEqual({
      delayMs: 4_000,
      nextFailureDelayMs: 8_000
    })
  })

  it('caps the failure backoff', () => {
    expect(nextModelConnectionWatchDelayMs({
      failed: true,
      hasRevision: true,
      failureDelayMs: MODEL_CONNECTION_WATCH_FAILURE_RETRY_MAX_MS
    }).nextFailureDelayMs).toBe(MODEL_CONNECTION_WATCH_FAILURE_RETRY_MAX_MS)
  })

  it('continues a healthy event long-poll without waiting', () => {
    expect(nextModelConnectionWatchDelayMs({
      failed: false,
      hasRevision: true,
      failureDelayMs: 8_000
    })).toEqual({
      delayMs: 0,
      nextFailureDelayMs: MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS
    })
  })
})

describe('subscribeModelConnectionWatch', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    resetModelConnectionWatchForTests()
  })

  afterEach(() => {
    resetModelConnectionWatchForTests()
    rendererRuntimeClient.invalidateSettings()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shares one poll across subscribers and aborts when the last listener leaves', async () => {
    let abortCount = 0
    const runtimeRequest = vi.fn((_path: string, _method?: string, _body?: string, options?: {
      requestId?: string
    }) => new Promise<{ ok: boolean; status: number; body: string }>((resolve, reject) => {
      if (!options?.requestId) {
        resolve({ ok: true, status: 200, body: snapshotBody(1) })
        return
      }
      const timer = setTimeout(() => {
        resolve({ ok: true, status: 200, body: snapshotBody(1) })
      }, 30_000)
      const fail = (): void => {
        clearTimeout(timer)
        abortCount += 1
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }
      pendingCancels.set(options.requestId, fail)
    }))
    const pendingCancels = new Map<string, () => void>()
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest,
        cancelRuntimeRequest: vi.fn(async (requestId: string) => {
          pendingCancels.get(requestId)?.()
          return true
        })
      }
    })

    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeModelConnectionWatch(first)
    const stopSecond = subscribeModelConnectionWatch(second)
    await vi.waitFor(() => {
      expect(runtimeRequest).toHaveBeenCalledTimes(1)
    })
    expect(runtimeRequest.mock.calls[0]?.[0]).toBe('/v1/model-connections')

    stopFirst()
    stopSecond()
    await vi.waitFor(() => {
      expect(abortCount).toBe(1)
    })
  })

  it('is the only renderer long-poll for model connection events', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const appSource = readFileSync(join(dir, '../App.tsx'), 'utf8')
    const settingsSource = readFileSync(
      join(dir, '../components/use-provider-shared-synchronization.ts'),
      'utf8'
    )
    expect(appSource).toContain('subscribeModelConnectionWatch')
    expect(appSource).not.toContain('/v1/model-connections/events')
    expect(settingsSource).toContain('subscribeModelConnectionWatch')
    expect(settingsSource).not.toContain('/v1/model-connections/events')
  })

  it('notifies every subscriber from the shared snapshot', async () => {
    const runtimeRequest = vi.fn((path: string) => {
      if (path === '/v1/model-connections') {
        return Promise.resolve({ ok: true, status: 200, body: snapshotBody(3) })
      }
      // Keep the follow-up long-poll outstanding so delay 0 cannot tight-loop.
      return new Promise(() => undefined)
    })
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest,
        cancelRuntimeRequest: vi.fn(async () => true)
      }
    })

    const seen: number[] = []
    const stop = subscribeModelConnectionWatch((snapshot) => {
      seen.push(snapshot.revision)
    })
    await vi.waitFor(() => {
      expect(seen).toEqual([3])
    })
    stop()
  })

  it('does not immediately retry a failed snapshot', async () => {
    vi.useFakeTimers()
    const runtimeRequest = vi.fn(async () => ({
      ok: false,
      status: 503,
      body: '{}'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest,
        cancelRuntimeRequest: vi.fn(async () => true)
      }
    })

    const stop = subscribeModelConnectionWatch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(runtimeRequest).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(MODEL_CONNECTION_WATCH_INITIAL_RETRY_MS - 1)
    expect(runtimeRequest).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    stop()
  })
})
