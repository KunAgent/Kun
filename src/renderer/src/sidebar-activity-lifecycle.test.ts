/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState } from './store/chat-store-types'
import { installSidebarActivityLifecycle } from './sidebar-activity-lifecycle'

type StoreOverrides = Partial<ChatState>

function buildStore(overrides: StoreOverrides = {}): {
  getState(): ChatState
  subscribe(listener: (state: ChatState) => void): () => void
} {
  const state = {
    runtimeConnection: 'ready',
    threadListStatus: 'ready',
    threads: [],
    watchTurnCompletion: {},
    scheduledThreadActivities: {},
    syncSidebarActivity: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined)
  } as unknown as ChatState
  Object.assign(state, overrides)
  return {
    getState: () => state,
    subscribe: () => () => undefined
  }
}

function setKunGui(value: unknown): void {
  ;(window as unknown as { kunGui: unknown }).kunGui = value
}

let visibilitySpy: ReturnType<typeof vi.spyOn> | undefined

function setVisibility(state: 'visible' | 'hidden'): void {
  visibilitySpy ??= vi.spyOn(document, 'visibilityState', 'get')
  visibilitySpy.mockReturnValue(state)
}

function flushVisibility(): void {
  document.dispatchEvent(new Event('visibilitychange'))
}

function activityRequest(maxResponses = 3): ReturnType<typeof vi.fn> {
  let calls = 0
  return vi.fn(() => {
    calls += 1
    if (calls > maxResponses) {
      // Leave the long-poll outstanding so the observe loop cannot tight-spin.
      return new Promise<{ ok: boolean; status: number; body: string }>(() => undefined)
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      body: JSON.stringify({ type: 'activity', cursor: 'c1', changes: [] })
    })
  })
}

describe('installSidebarActivityLifecycle visibility parking', () => {
  beforeEach(() => {
    visibilitySpy = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    visibilitySpy = undefined
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('keeps long-polling while hidden on desktop (no isRemoteWeb)', async () => {
    setVisibility('hidden')
    const runtimeRequest = activityRequest()
    setKunGui({ runtimeRequest })

    const dispose = installSidebarActivityLifecycle(buildStore())
    await vi.waitFor(() => {
      expect(runtimeRequest).toHaveBeenCalled()
    })
    expect(runtimeRequest.mock.calls[0]?.[0]).toContain('/v1/thread-activity/events')
    dispose()
  })

  it('parks while hidden on Remote Web without active work, then resumes on visible', async () => {
    setVisibility('hidden')
    const runtimeRequest = activityRequest()
    setKunGui({ isRemoteWeb: true, runtimeRequest })

    const dispose = installSidebarActivityLifecycle(buildStore())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(runtimeRequest).not.toHaveBeenCalled()

    setVisibility('visible')
    flushVisibility()
    await vi.waitFor(() => {
      expect(runtimeRequest).toHaveBeenCalled()
    })
    dispose()
  })

  it('keeps polling while hidden on Remote Web when work is running', async () => {
    setVisibility('hidden')
    const runtimeRequest = activityRequest()
    setKunGui({ isRemoteWeb: true, runtimeRequest })

    const running = { id: 'thread-run', status: 'running' }
    const dispose = installSidebarActivityLifecycle(buildStore({
      threads: [running] as unknown as ChatState['threads']
    }))
    await vi.waitFor(() => {
      expect(runtimeRequest).toHaveBeenCalled()
    })
    dispose()
  })
})
