import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  marker: vi.fn(),
  needsInventory: vi.fn(() => true),
  logWarn: vi.fn(),
  supervisor: {
    latestOr: <T>(value: T): T => value,
    setManagedRuntimeExpected: vi.fn(),
    noteHealthy: vi.fn(),
    publish: vi.fn(),
    waitForIdle: vi.fn()
  },
  mainState: {
    canonicalRuntimeMigration: { status: 'completed', authority: 'current' },
    startupState: { isReady: vi.fn(() => true) },
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
  markCanonicalKunRuntimeMigrationRuntimeVerified: harness.marker,
  runtimeMigrationNeedsThreadInventory: harness.needsInventory
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

import { probeRuntimeApi } from './main-runtime-health'

describe('Runtime API readiness', () => {
  it('normalizes every HTTP 401 into the desktop credential error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'unauthorized', message: 'unauthorized' }), { status: 401 })
    )

    await expect(probeRuntimeApi({} as never)).resolves.toEqual({
      ok: false,
      error: 'runtime_auth_required',
      message: 'The local Kun Runtime rejected the desktop access credential.'
    })
    fetchMock.mockRestore()
  })
})

describe('runtime migration health verification', () => {
  it('waits for desktop readiness and skips network I/O for a finished journal', async () => {
    vi.resetModules()
    const { noteRuntimeHealthy } = await import('./main-runtime-health')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      harness.mainState.startupState.isReady.mockReturnValueOnce(false)
      noteRuntimeHealthy('starting')
      expect(harness.needsInventory).not.toHaveBeenCalled()
      harness.needsInventory.mockReturnValueOnce(false)
      noteRuntimeHealthy('started')
      await vi.waitFor(() => expect(harness.needsInventory).toHaveBeenCalled())
      expect(fetchMock).not.toHaveBeenCalled()
      expect(harness.marker).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('stops future inventory checks and WARNs once verification is unresolved', async () => {
    vi.resetModules()
    const { noteRuntimeHealthy } = await import('./main-runtime-health')
    harness.supervisor.noteHealthy.mockClear()
    harness.marker.mockReturnValue({
      status: 'unresolved',
      expectedThreadCount: 1,
      visibleThreadCount: 0,
      missingThreadIds: ['thr_history'],
      attempt: 3,
      maxAttempts: 3
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ threads: [], hasMore: true, nextCursor: 'old+archived' }))
      .mockResolvedValueOnce(Response.json({ threads: [{ id: 'thr_last' }] }))

    noteRuntimeHealthy('final')
    await vi.waitFor(() => expect(harness.marker).toHaveBeenCalledTimes(1))
    noteRuntimeHealthy('after-final')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.marker).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(harness.marker).toHaveBeenCalledWith('/tmp/userData', new Set(['thr_last']), expect.anything())
    expect(harness.logWarn).toHaveBeenCalledTimes(1)
    expect(harness.logWarn.mock.calls[0]?.[1]).toBe(
      'Runtime history verification reached its retry limit; automatic retries stopped without blocking Runtime availability.'
    )
    expect(harness.supervisor.noteHealthy).toHaveBeenCalledTimes(2)
    fetchMock.mockRestore()
  })
})
