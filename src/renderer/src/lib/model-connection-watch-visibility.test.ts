/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
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

let visibilitySpy: ReturnType<typeof vi.spyOn> | undefined

function setVisibility(state: 'visible' | 'hidden'): void {
  visibilitySpy ??= vi.spyOn(document, 'visibilityState', 'get')
  visibilitySpy.mockReturnValue(state)
}

function setKunGui(value: unknown): void {
  ;(window as unknown as { kunGui: unknown }).kunGui = value
}

describe('subscribeModelConnectionWatch visibility parking', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    resetModelConnectionWatchForTests()
    visibilitySpy = undefined
  })

  afterEach(() => {
    resetModelConnectionWatchForTests()
    rendererRuntimeClient.invalidateSettings()
    vi.restoreAllMocks()
    visibilitySpy = undefined
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('keeps polling while hidden on desktop (no isRemoteWeb)', async () => {
    setVisibility('hidden')
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path === '/v1/model-connections') {
        return { ok: true, status: 200, body: snapshotBody(2) }
      }
      // Park the follow-up event poll forever so the loop cannot tight-spin.
      return new Promise<{ ok: boolean; status: number; body: string }>(() => undefined)
    })
    setKunGui({ runtimeRequest, cancelRuntimeRequest: vi.fn(async () => true) })

    const stop = subscribeModelConnectionWatch(() => undefined)
    await vi.waitFor(() => {
      expect(runtimeRequest).toHaveBeenCalledWith('/v1/model-connections', 'GET', undefined,
        expect.objectContaining({}))
    })
    stop()
  })

  it('parks while hidden on Remote Web and resumes on visible', async () => {
    setVisibility('hidden')
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path === '/v1/model-connections') {
        return { ok: true, status: 200, body: snapshotBody(2) }
      }
      return new Promise<{ ok: boolean; status: number; body: string }>(() => undefined)
    })
    setKunGui({ isRemoteWeb: true, runtimeRequest, cancelRuntimeRequest: vi.fn(async () => true) })

    const stop = subscribeModelConnectionWatch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(runtimeRequest).not.toHaveBeenCalled()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(runtimeRequest).toHaveBeenCalled()
    })
    stop()
  })
})
