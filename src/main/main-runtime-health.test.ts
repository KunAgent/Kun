import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  marker: vi.fn(),
  logWarn: vi.fn(),
  supervisor: {
    latestOr: <T>(value: T): T => value,
    setManagedRuntimeExpected: vi.fn(),
    noteHealthy: vi.fn(),
    publish: vi.fn(),
    waitForIdle: vi.fn()
  },
  mainState: {
    store: { load: vi.fn(async () => ({ agents: { kun: {} } })) },
    ensureRuntime: vi.fn(),
    restartRuntime: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/tmp/${name}` },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('./runtime-data-dir-migration', () => ({
  markCanonicalKunRuntimeMigrationRuntimeVerified: harness.marker
}))
vi.mock('./logger', () => ({ logError: vi.fn(), logWarn: harness.logWarn }))
vi.mock('./runtime/kun-adapter', () => ({
  getRuntimeBaseUrlForSettings: () => 'http://127.0.0.1:18899',
  kunRuntimeAdapter: { isChildRunning: () => false },
  runtimeAuthHeaders: () => new Headers()
}))
vi.mock('./kun-runtime-supervisor', () => ({
  KunRuntimeSupervisor: class { constructor() { return harness.supervisor } }
}))
vi.mock('./main-app-context', () => ({ mainState: harness.mainState }))
vi.mock('./managed-runtime-startup-policy', () => ({ managedKunHostCanAutoStart: () => false }))
vi.mock('./main-lifecycle', () => ({ isAppQuitInProgress: () => false, runtimeShutdown: { isStoppedForQuit: false } }))
vi.mock('./browser-use/browser-use-host', () => ({ stopBrowserUseHost: vi.fn() }))
vi.mock('./computer-use/computer-use-host', () => ({ stopComputerUseHost: vi.fn() }))

import { noteRuntimeHealthy } from './main-runtime-health'

describe('runtime migration health verification', () => {
  it('stops future inventory checks and WARNs once verification is unresolved', async () => {
    harness.marker.mockReturnValue({
      status: 'unresolved',
      expectedThreadCount: 1,
      visibleThreadCount: 0,
      missingThreadIds: ['thr_history'],
      attempt: 3,
      maxAttempts: 3
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ threads: [] })))

    noteRuntimeHealthy('final')
    await vi.waitFor(() => expect(harness.marker).toHaveBeenCalledTimes(1))
    noteRuntimeHealthy('after-final')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.marker).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(harness.logWarn).toHaveBeenCalledTimes(1)
    expect(harness.logWarn.mock.calls[0]?.[1]).toBe(
      'Runtime history verification reached its retry limit; automatic retries stopped without blocking Runtime availability.'
    )
    expect(harness.supervisor.noteHealthy).toHaveBeenCalledTimes(2)
    fetchMock.mockRestore()
  })
})
