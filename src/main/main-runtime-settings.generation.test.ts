import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const harness = vi.hoisted(() => {
  let generation = 0
  let pending = 0
  let latest: unknown
  let tail = Promise.resolve()
  const stopSharedAndWait = vi.fn(async () => undefined)
  const classifyHotApply = vi.fn<() => {
    result: 'applied' | 'failed'
    message: string
  }>(() => ({ result: 'applied', message: '' }))
  const reconcile = vi.fn(async (settings: AppSettingsV1, isCurrent: () => boolean) => ({
    current: isCurrent(),
    ...(settings.agents.kun.browserUse.enabled
      ? {
          binding: {
            url: 'http://127.0.0.1:23456',
            token: 'b'.repeat(43),
            approvalSigningKey: 's'.repeat(43)
          }
        }
      : {})
  }))
  const mainState = {
    settledRuntimeSettings: undefined as AppSettingsV1 | undefined,
    runtimeSettingsSyncStatus: undefined as unknown,
    assertCanonicalRuntimeMigrationReady: vi.fn(),
    store: {
      load: vi.fn(),
      updateIf: vi.fn()
    }
  }
  const runtimeSettingsIntents = {
    reserve: (): number => {
      generation += 1
      return generation
    },
    isCurrent: (candidate: number): boolean => candidate === generation,
    serializePersistence: <Value>(operation: () => Promise<Value>): Promise<Value> => operation()
  }
  const runtimeSupervisor = {
    noteLatest: (settings: unknown): void => { latest = settings },
    latestOr: (fallback: unknown): unknown => latest ?? fallback,
    hasPendingOperation: (): boolean => pending > 0,
    setManagedRuntimeExpected: vi.fn(),
    enqueueSettingsApply: (
      operation: () => Promise<void>,
      onError: (error: unknown) => void
    ): void => {
      pending += 1
      const task = tail.then(operation).catch(onError).finally(() => { pending -= 1 })
      tail = task
    },
    waitForIdle: async (): Promise<void> => { await tail }
  }
  return {
    classifyHotApply,
    mainState,
    reconcile,
    runtimeSettingsIntents,
    runtimeSupervisor,
    stopSharedAndWait
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/kun-runtime-settings-generation-app'
  },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('./main-app-context', () => ({
  getClawScheduleMcpLaunchConfig: () => undefined,
  mainState: harness.mainState,
  runtimeFailure: vi.fn(),
  runtimeSettingsIntents: harness.runtimeSettingsIntents
}))
vi.mock('./main-runtime-health', () => ({
  kunRuntimeHealthMonitor: { waitForHealthy: vi.fn(async () => true) },
  noteRuntimeHealthy: vi.fn(),
  publishRuntimeStatus: vi.fn(),
  runtimeSupervisor: harness.runtimeSupervisor
}))
vi.mock('./runtime/kun-adapter', () => ({
  getRuntimeBaseUrlForSettings: () => 'http://127.0.0.1:18899',
  kunRuntimeAdapter: {
    isChildRunning: () => true,
    stopSharedAndWait: harness.stopSharedAndWait,
    ensureRunning: vi.fn(async () => undefined)
  },
  runtimeAuthHeaders: () => new Headers(),
  runtimeRequestViaHost: vi.fn(),
  runtimeRequestViaLease: vi.fn()
}))
vi.mock('./kun-process', () => ({
  resolveKunDataDir: () => '/tmp/kun-runtime-settings-generation',
  syncGuiManagedKunConfig: vi.fn(async () => ({})),
  waitForKunStartupSettled: vi.fn(async () => undefined)
}))
vi.mock('./managed-runtime-startup-policy', () => ({
  managedKunHostCanAutoStart: () => true
}))
vi.mock('./runtime/managed-runtime-idle', () => ({
  waitForRuntimeTurnsIdle: vi.fn(async () => 'idle')
}))
vi.mock('./runtime/kun-runtime-config-service', () => ({
  buildManagedRuntimeHotApplyBody: (
    settings: AppSettingsV1,
    _config: unknown,
    binding: unknown
  ) => ({
    browserEnabled: settings.agents.kun.browserUse.enabled,
    browserUseHostBinding: binding
  }),
  classifyManagedRuntimeHotApplyResponse: harness.classifyHotApply
}))
vi.mock('./main-runtime-startup', () => ({
  ensureKunRuntime: vi.fn(async () => undefined),
  ensureRuntime: vi.fn(async () => undefined),
  resolveManagedKunLaunchSettings: vi.fn(async (settings: AppSettingsV1) => settings)
}))
vi.mock('./browser-use/browser-use-host', () => ({
  reconcileBrowserUseHostForRuntime: harness.reconcile
}))
vi.mock('./logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn()
}))

import {
  applyManagedRuntimeSettingsHot,
  queueRuntimeSettingsApply,
  reserveRuntimeSettingsApply
} from './main-runtime-settings'

function browserSettings(enabled: boolean): AppSettingsV1 {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return {
    ...base,
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        browserUse: {
          ...defaultKunRuntimeSettings().browserUse,
          enabled
        }
      }
    }
  }
}

describe('Runtime settings generation ownership', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    harness.stopSharedAndWait.mockClear()
    harness.reconcile.mockClear()
    harness.classifyHotApply.mockReset()
    harness.classifyHotApply.mockReturnValue({ result: 'applied', message: '' })
  })

  it('keeps the current runtime running when hot configuration validation fails', async () => {
    const current = browserSettings(false)
    harness.classifyHotApply.mockReturnValue({ result: 'failed', message: 'invalid credentials' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid credentials', { status: 400 })))

    await expect(applyManagedRuntimeSettingsHot(current, 'settings-test')).resolves.toBe('failed')

    expect(harness.stopSharedAndWait).not.toHaveBeenCalled()
  })

  it('reconciles S0 after a rapid S0 to S1 to S0 while the stale hot request fails', async () => {
    const s0 = browserSettings(false)
    const s1 = browserSettings(true)
    harness.mainState.settledRuntimeSettings = s0
    let rejectStale!: (reason: unknown) => void
    const fetchMock = vi.fn<typeof fetch>((_input, _init) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((_resolve, reject) => { rejectStale = reject })
      }
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const s1Reservation = reserveRuntimeSettingsApply(s0, s1)
    queueRuntimeSettingsApply(s0, s1, s1Reservation, async () => undefined)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    const s0Reservation = reserveRuntimeSettingsApply(s1, s0)
    expect(s0Reservation.shouldApply).toBe(true)
    queueRuntimeSettingsApply(s1, s0, s0Reservation, async () => undefined)
    rejectStale(new Error('stale request failed after S0 became current'))
    await harness.runtimeSupervisor.waitForIdle()

    expect(harness.stopSharedAndWait).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      browserEnabled: false,
      browserUseHostBinding: null
    })
    expect(harness.mainState.settledRuntimeSettings).toBe(s0)
  })
})
