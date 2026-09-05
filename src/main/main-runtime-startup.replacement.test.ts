import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const harness = vi.hoisted(() => {
  let latest: unknown
  let childRunning = false
  const stopAndWait = vi.fn(async () => undefined)
  const stopSharedAndWait = vi.fn(async () => undefined)
  const stopSharedForReplacementAndWait = vi.fn(async () => undefined)
  const ensureRunning = vi.fn(async () => undefined)
  const ensureReplacementRunning = vi.fn(async () => undefined)
  const resolveConnection = vi.fn(async () => false)
  const resolveAvailablePort = vi.fn<(port: number) => Promise<{
    port: number
    changed: boolean
    message?: string
  }>>(async (port) => ({ port, changed: false }))
  const updateIf = vi.fn(async (
    predicate: (current: AppSettingsV1) => boolean,
    mutation: (current: AppSettingsV1) => AppSettingsV1
  ) => {
    const current = (latest ?? settings()) as AppSettingsV1
    const applied = predicate(current)
    const next = applied ? mutation(current) : current
    latest = next
    return { settings: next, applied }
  })
  const probeBundledBuildReplacement = vi.fn<() => Promise<
    | { state: 'matched'; ownership: 'none' | 'current' }
    | { state: 'mismatched' }
    | { state: 'foreign-owned'; ownerKind: 'gui' | 'tui'; buildMatches: boolean }
    | { state: 'unknown'; error: Error }
  >>(async () => ({ state: 'matched', ownership: 'none' }))
  const waitForHealthy = vi.fn(async () => true)
  const probeRuntimeApi = vi.fn(async () => ({ ok: true as const }))
  const noteRuntimeHealthy = vi.fn()
  const waitForKunStartupSettled = vi.fn(async () => undefined)
  const waitForRuntimeTurnsIdle = vi.fn<() => Promise<'idle' | 'timeout'>>(
    async () => 'idle'
  )
  const clearHistoricalKunServeProcesses = vi.fn(async (): Promise<{
    matchedPids: number[]
    terminatedPids: number[]
    alreadyExitedPids: number[]
    failedPids: number[]
  }> => ({
    matchedPids: [],
    terminatedPids: [],
    alreadyExitedPids: [],
    failedPids: []
  }))
  const drainKunOwnersForHandoff = vi.fn(async () => undefined)
  const activeServiceManager = {
    discovery: {
      dataDir: '/tmp/kun-data',
      settingsPath: '/tmp/kun-settings.json'
    }
  }
  const mainState = {
    activeServiceManager: activeServiceManager as typeof activeServiceManager | null,
    assertCanonicalRuntimeMigrationReady: vi.fn(),
    settledRuntimeSettings: null as AppSettingsV1 | null,
    store: { updateIf }
  }
  const runtimeSupervisor = {
    latestOr: <Settings>(fallback: Settings): Settings => (latest ?? fallback) as Settings,
    noteLatest: vi.fn((settings: unknown) => { latest = settings }),
    setManagedRuntimeExpected: vi.fn(),
    restart: vi.fn(async (operation: () => Promise<void>) => operation()),
    replace: vi.fn(async (operation: () => Promise<void>) => operation()),
    waitForIdle: vi.fn(async () => undefined),
    ensure: vi.fn(async (_fingerprint: string, operation: () => Promise<unknown>) => operation())
  }

  return {
    clearHistoricalKunServeProcesses,
    drainKunOwnersForHandoff,
    childRunning: () => childRunning,
    ensureReplacementRunning,
    ensureRunning,
    resolveAvailablePort,
    resolveConnection,
    mainState,
    activeServiceManager,
    noteRuntimeHealthy,
    probeRuntimeApi,
    probeBundledBuildReplacement,
    runtimeSupervisor,
    setLatest: (settings: unknown): void => { latest = settings },
    setChildRunning: (running: boolean): void => { childRunning = running },
    stopAndWait,
    stopSharedAndWait,
    stopSharedForReplacementAndWait,
    updateIf,
    waitForHealthy,
    waitForKunStartupSettled,
    waitForRuntimeTurnsIdle
  }
})

vi.mock('./runtime/kun-adapter', () => ({
  kunRuntimeAdapter: {
    ensureRunning: harness.ensureRunning,
    ensureReplacementRunning: harness.ensureReplacementRunning,
    isChildRunning: harness.childRunning,
    probeBundledBuildReplacement: harness.probeBundledBuildReplacement,
    resolveAvailablePort: harness.resolveAvailablePort,
    resolveConnection: harness.resolveConnection,
    stopAndWait: harness.stopAndWait,
    stopSharedAndWait: harness.stopSharedAndWait,
    stopSharedForReplacementAndWait: harness.stopSharedForReplacementAndWait
  }
}))
vi.mock('./kun-process', () => ({
  isKunChildRunning: () => false,
  waitForKunStartupSettled: harness.waitForKunStartupSettled
}))
vi.mock('./runtime/kun-serve-process-cleanup', () => ({
  clearHistoricalKunServeProcesses: harness.clearHistoricalKunServeProcesses
}))
vi.mock('./runtime/kun-installed-build-handoff', () => ({
  drainKunOwnersForHandoff: harness.drainKunOwnersForHandoff
}))
vi.mock('./runtime/kun-handoff-logging', () => ({
  logKunHandoffEvent: vi.fn()
}))
vi.mock('../../kun/src/manager/manager-discovery.js', () => ({
  defaultKunControlDir: () => '/tmp/kun-control'
}))
vi.mock('./runtime/managed-runtime-idle', () => ({
  waitForRuntimeTurnsIdle: harness.waitForRuntimeTurnsIdle
}))
vi.mock('./managed-runtime-startup-policy', () => ({
  managedKunHostCanAutoStart: (settings: AppSettingsV1) => settings.agents.kun.autoStart
}))
vi.mock('./logger', () => ({ logWarn: vi.fn() }))
vi.mock('./main-app-context', () => ({
  mainState: harness.mainState,
  runtimeJsonError: (code: string, message: string) => Object.assign(new Error(message), { code })
}))
vi.mock('./main-runtime-health', () => ({
  kunRuntimeHealthMonitor: { waitForHealthy: harness.waitForHealthy },
  noteRuntimeHealthy: harness.noteRuntimeHealthy,
  probeRuntimeApi: harness.probeRuntimeApi,
  RUNTIME_HUNG_CONFIRM_MS: 10_000,
  runtimeFingerprint: () => 'runtime',
  runtimeSupervisor: harness.runtimeSupervisor
}))

import {
  ensureKunRuntime,
  ensureManagedKunRuntimeToken,
  ensureKunServeFreshOnStartup,
  isServiceManagerDataMutexFailure,
  prepareGuiRuntimeForStartupRetry,
  reconcileBundledRuntimeAfterInstall,
  replaceKunServe,
  resolveManagedKunLaunchSettings,
  restartGuiRuntime,
  restartRuntime,
  restartAllKunServeProcesses
} from './main-runtime-startup'

function settings(): AppSettingsV1 {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return {
    ...base,
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        autoStart: true,
        runtimeToken: 'existing-runtime-token'
      }
    }
  }
}

beforeEach(() => {
  harness.setLatest(undefined)
  harness.setChildRunning(false)
  harness.stopAndWait.mockClear()
  harness.stopSharedAndWait.mockClear()
  harness.stopSharedForReplacementAndWait.mockClear()
  harness.ensureRunning.mockClear()
  harness.ensureReplacementRunning.mockClear()
  harness.resolveAvailablePort.mockReset()
  harness.resolveAvailablePort.mockImplementation(async (port: number) => ({ port, changed: false }))
  harness.updateIf.mockClear()
  harness.drainKunOwnersForHandoff.mockReset()
  harness.drainKunOwnersForHandoff.mockResolvedValue(undefined)
  harness.mainState.activeServiceManager = harness.activeServiceManager
  harness.mainState.settledRuntimeSettings = null
  harness.resolveConnection.mockReset()
  harness.resolveConnection.mockResolvedValue(false)
  harness.probeBundledBuildReplacement.mockReset()
  harness.probeBundledBuildReplacement.mockResolvedValue({ state: 'matched', ownership: 'none' })
  harness.waitForHealthy.mockClear()
  harness.probeRuntimeApi.mockClear()
  harness.noteRuntimeHealthy.mockClear()
  harness.waitForKunStartupSettled.mockClear()
  harness.waitForRuntimeTurnsIdle.mockReset()
  harness.waitForRuntimeTurnsIdle.mockResolvedValue('idle')
  harness.clearHistoricalKunServeProcesses.mockReset()
  harness.clearHistoricalKunServeProcesses.mockResolvedValue({
    matchedPids: [],
    terminatedPids: [],
    alreadyExitedPids: [],
    failedPids: []
  })
  harness.mainState.assertCanonicalRuntimeMigrationReady.mockClear()
  harness.runtimeSupervisor.noteLatest.mockClear()
  harness.runtimeSupervisor.restart.mockClear()
  harness.runtimeSupervisor.replace.mockClear()
  harness.runtimeSupervisor.waitForIdle.mockClear()
  harness.runtimeSupervisor.ensure.mockClear()
  harness.runtimeSupervisor.ensure.mockImplementation(async (_fingerprint: string, operation: () => Promise<unknown>) => operation())
  harness.runtimeSupervisor.setManagedRuntimeExpected.mockClear()
})

describe('GUI Runtime startup preparation', () => {
  it('atomically generates and persists a missing runtime token', async () => {
    const current = settings()
    current.agents.kun.runtimeToken = ''
    harness.setLatest(current)

    const result = await ensureManagedKunRuntimeToken(current, 'test')

    expect(result.generated).toBe(true)
    expect(result.settings.agents.kun.runtimeToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(harness.updateIf).toHaveBeenCalledOnce()
  })

  it('persists an available fallback port before launch', async () => {
    const current = settings()
    harness.setLatest(current)
    harness.resolveAvailablePort.mockResolvedValueOnce({
      port: current.agents.kun.port + 1,
      changed: true,
      message: `port ${current.agents.kun.port} is in use`
    })

    const result = await resolveManagedKunLaunchSettings(current, 'test')

    expect(result.agents.kun.port).toBe(current.agents.kun.port + 1)
    expect(harness.updateIf).toHaveBeenCalledOnce()
  })

  it('reselects a port only once after a bind race', async () => {
    const current = settings()
    harness.setLatest(current)
    harness.ensureRunning
      .mockRejectedValueOnce(Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' }))
      .mockResolvedValueOnce(undefined)
    harness.resolveAvailablePort
      .mockResolvedValueOnce({ port: current.agents.kun.port, changed: false })
      .mockResolvedValueOnce({ port: current.agents.kun.port + 1, changed: true })

    const result = await ensureKunRuntime(current)

    expect(harness.ensureRunning).toHaveBeenCalledTimes(2)
    expect(result.agents.kun.port).toBe(current.agents.kun.port + 1)
  })

  it('does not treat an ownership conflict as a port retry', async () => {
    const current = settings()
    harness.setLatest(current)
    const conflict = Object.assign(new Error('Kun Runtime is already owned by tui'), {
      code: 'client_runtime_owner_busy'
    })
    harness.ensureRunning.mockRejectedValueOnce(conflict)

    await expect(ensureKunRuntime(current)).rejects.toBe(conflict)

    expect(harness.ensureRunning).toHaveBeenCalledOnce()
    expect(harness.runtimeSupervisor.setManagedRuntimeExpected).toHaveBeenCalledWith(false)
    expect(harness.stopAndWait).not.toHaveBeenCalled()
  })

  it('fences the watchdog and waits for runtime operations before Retry cleanup', async () => {
    await prepareGuiRuntimeForStartupRetry()

    expect(harness.runtimeSupervisor.setManagedRuntimeExpected).toHaveBeenCalledWith(false)
    expect(harness.runtimeSupervisor.waitForIdle).toHaveBeenCalledOnce()
    expect(harness.stopAndWait).toHaveBeenCalledOnce()
    expect(harness.drainKunOwnersForHandoff).not.toHaveBeenCalled()
  })

  it('replaces the exact Service Manager after a data-mutex HTTP 500', async () => {
    await prepareGuiRuntimeForStartupRetry(new Error(
      'Kun Service Manager data mutex failed with HTTP 500: internal_error'
    ))

    expect(harness.stopAndWait).toHaveBeenCalledOnce()
    expect(harness.drainKunOwnersForHandoff).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'startup-retry',
      dataDirs: ['/tmp/kun-data'],
      settingsPath: '/tmp/kun-settings.json',
      controlDir: '/tmp/kun-control'
    }))
    expect(harness.mainState.activeServiceManager).toBeNull()
  })

  it('keeps the Manager binding when verified replacement fails', async () => {
    harness.drainKunOwnersForHandoff.mockRejectedValueOnce(new Error('another TUI owns the Runtime'))

    await expect(prepareGuiRuntimeForStartupRetry(new Error(
      'Kun Service Manager data mutex failed with HTTP 500: internal_error'
    ))).rejects.toThrow(/another TUI owns the Runtime/)

    expect(harness.mainState.activeServiceManager).toBe(harness.activeServiceManager)
  })

  it('recognizes only the persistent Manager data-mutex failure', () => {
    expect(isServiceManagerDataMutexFailure(
      new Error('Kun Service Manager data mutex failed with HTTP 500: internal_error')
    )).toBe(true)
    expect(isServiceManagerDataMutexFailure(
      new Error('Kun Service Manager request failed with HTTP 500')
    )).toBe(false)
    expect(isServiceManagerDataMutexFailure(
      new Error('Kun Service Manager data mutex failed with HTTP 503')
    )).toBe(false)
  })

  it('stops only the controller-held child when generating a token', async () => {
    const current = settings()
    current.agents.kun.runtimeToken = ''
    harness.setLatest(current)
    harness.setChildRunning(true)

    await ensureKunRuntime(current)

    expect(harness.stopAndWait).toHaveBeenCalledOnce()
    expect(harness.stopSharedAndWait).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
  })
})

describe('explicit Kun serve replacement', () => {
  it('restarts only the GUI-owned child without scanning or replacing foreign serves', async () => {
    const current = settings()

    await expect(restartGuiRuntime(current)).resolves.toBeUndefined()

    expect(harness.runtimeSupervisor.replace).toHaveBeenCalledOnce()
    expect(harness.stopAndWait).toHaveBeenCalledOnce()
    expect(harness.ensureRunning).toHaveBeenCalledWith(current)
    expect(harness.stopSharedAndWait).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
    expect(harness.clearHistoricalKunServeProcesses).not.toHaveBeenCalled()
  })

  it('uses the verified replacement stop and launch path instead of ordinary restart', async () => {
    const current = settings()

    await expect(replaceKunServe(current)).resolves.toBeUndefined()

    expect(harness.runtimeSupervisor.replace).toHaveBeenCalledOnce()
    expect(harness.runtimeSupervisor.restart).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).toHaveBeenCalledWith(current)
    expect(harness.stopSharedAndWait).not.toHaveBeenCalled()
    expect(harness.ensureReplacementRunning).toHaveBeenCalledWith(current)
    expect(harness.ensureRunning).not.toHaveBeenCalled()
    expect(harness.waitForHealthy).toHaveBeenCalledWith(current, 20_000)
    expect(harness.probeRuntimeApi).toHaveBeenCalledWith(current)
    expect(harness.mainState.settledRuntimeSettings).toBe(current)
  })

  it('leaves an ownerless build mismatch for the exact client-owned election path', async () => {
    const current = settings()
    harness.probeBundledBuildReplacement.mockResolvedValue({ state: 'mismatched' })

    await expect(reconcileBundledRuntimeAfterInstall(current)).resolves.toBeUndefined()

    expect(harness.probeBundledBuildReplacement).toHaveBeenCalledWith(current)
    expect(harness.runtimeSupervisor.replace).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
    expect(harness.ensureReplacementRunning).not.toHaveBeenCalled()
    expect(harness.ensureRunning).not.toHaveBeenCalled()
  })

  it.each(['gui', 'tui'] as const)(
    'preserves a mismatched %s-owned Runtime and lets normal ensure report the owner conflict',
    async (ownerKind) => {
      const current = settings()
      const conflict = Object.assign(
        new Error(`Kun Runtime is already owned by ${ownerKind}`),
        { code: 'client_runtime_owner_busy' }
      )
      harness.probeBundledBuildReplacement.mockResolvedValue({
        state: 'foreign-owned',
        ownerKind,
        buildMatches: false
      })

      await expect(reconcileBundledRuntimeAfterInstall(current)).resolves.toBeUndefined()

      expect(harness.runtimeSupervisor.replace).not.toHaveBeenCalled()
      expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
      expect(harness.ensureReplacementRunning).not.toHaveBeenCalled()
      harness.ensureRunning.mockRejectedValueOnce(conflict)
      await expect(ensureKunServeFreshOnStartup(current)).rejects.toBe(conflict)
      expect(harness.ensureRunning).toHaveBeenCalledWith(current)
    }
  )

  it('fails closed when the bundled replacement probe is unknown', async () => {
    const current = settings()
    const probeError = new Error('manager status unavailable')
    harness.probeBundledBuildReplacement.mockResolvedValue({ state: 'unknown', error: probeError })

    await expect(reconcileBundledRuntimeAfterInstall(current)).rejects.toBe(probeError)

    expect(harness.runtimeSupervisor.replace).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
    expect(harness.ensureReplacementRunning).not.toHaveBeenCalled()
  })

  it('clears all historical serves after stopping the current owner and before launching', async () => {
    const order: string[] = []
    harness.stopSharedForReplacementAndWait.mockImplementationOnce(async () => {
      order.push('stop-current')
    })
    harness.clearHistoricalKunServeProcesses.mockImplementationOnce(async () => {
      order.push('clear-history')
      return {
        matchedPids: [101],
        terminatedPids: [101],
        alreadyExitedPids: [],
        failedPids: []
      }
    })
    harness.ensureReplacementRunning.mockImplementationOnce(async () => {
      order.push('launch-replacement')
    })
    const current = settings()

    await expect(restartAllKunServeProcesses(current)).resolves.toBeUndefined()

    expect(order).toEqual(['stop-current', 'clear-history', 'launch-replacement'])
    expect(harness.waitForHealthy).toHaveBeenCalledWith(current, 20_000)
    expect(harness.probeRuntimeApi).toHaveBeenCalledWith(current)
  })

  it('does not launch a replacement when historical cleanup fails', async () => {
    harness.clearHistoricalKunServeProcesses.mockRejectedValueOnce(
      new Error('historical process 101 remained alive')
    )
    const current = settings()

    await expect(restartAllKunServeProcesses(current)).rejects.toThrow(/101 remained alive/)

    expect(harness.stopSharedForReplacementAndWait).toHaveBeenCalledWith(current)
    expect(harness.ensureReplacementRunning).not.toHaveBeenCalled()
    expect(harness.waitForHealthy).not.toHaveBeenCalled()
  })
})

describe('startup Kun serve restart', () => {
  it('defers an ordinary restart without stopping an active runtime', async () => {
    const current = settings()
    harness.setChildRunning(true)
    harness.waitForRuntimeTurnsIdle.mockResolvedValueOnce('timeout')

    await expect(restartRuntime(current)).rejects.toMatchObject({ code: 'runtime_busy' })

    expect(harness.stopSharedAndWait).not.toHaveBeenCalled()
    expect(harness.ensureRunning).not.toHaveBeenCalled()
  })

  it('reuses a healthy shared serve on GUI launch instead of replacing it', async () => {
    const current = settings()
    harness.resolveConnection.mockResolvedValueOnce(true)

    const result = await ensureKunServeFreshOnStartup(current)

    expect(result).toBe(current)
    expect(harness.runtimeSupervisor.setManagedRuntimeExpected).toHaveBeenCalledWith(true)
    expect(harness.runtimeSupervisor.ensure).toHaveBeenCalledOnce()
    expect(harness.clearHistoricalKunServeProcesses).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
    expect(harness.ensureReplacementRunning).not.toHaveBeenCalled()
    expect(harness.ensureRunning).not.toHaveBeenCalled()
    expect(harness.waitForHealthy).toHaveBeenCalledWith(current, 5_000)
    expect(harness.probeRuntimeApi).toHaveBeenCalledWith(current)
  })

  it('starts a missing shared serve without a broad historical-process cleanup', async () => {
    const current = settings()

    await ensureKunServeFreshOnStartup(current)

    expect(harness.clearHistoricalKunServeProcesses).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
    expect(harness.ensureReplacementRunning).not.toHaveBeenCalled()
    expect(harness.ensureRunning).toHaveBeenCalledWith(current)
  })

  it('attaches without replacing when automatic startup is disabled', async () => {
    const current = {
      ...settings(),
      agents: { kun: { ...settings().agents.kun, autoStart: false } }
    }

    const result = await ensureKunServeFreshOnStartup(current)

    expect(result).toBe(current)
    expect(harness.runtimeSupervisor.setManagedRuntimeExpected).not.toHaveBeenCalled()
    expect(harness.runtimeSupervisor.ensure).not.toHaveBeenCalled()
    expect(harness.clearHistoricalKunServeProcesses).not.toHaveBeenCalled()
    expect(harness.stopSharedForReplacementAndWait).not.toHaveBeenCalled()
  })
})
