import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const harness = vi.hoisted(() => {
  let latest: unknown
  const stopSharedAndWait = vi.fn(async () => undefined)
  const stopSharedForReplacementAndWait = vi.fn(async () => undefined)
  const ensureRunning = vi.fn(async () => undefined)
  const ensureReplacementRunning = vi.fn(async () => undefined)
  const resolveConnection = vi.fn(async () => false)
  const probeBundledBuildReplacement = vi.fn<() => Promise<
    | { state: 'matched'; ownership: 'none' | 'current' }
    | { state: 'mismatched' }
    | { state: 'unknown'; error: Error }
  >>(async () => ({ state: 'matched', ownership: 'none' }))
  const waitForHealthy = vi.fn(async () => true)
  const probeRuntimeApi = vi.fn(async () => ({ ok: true as const }))
  const noteRuntimeHealthy = vi.fn()
  const waitForKunStartupSettled = vi.fn(async () => undefined)
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
  const mainState = {
    assertCanonicalRuntimeMigrationReady: vi.fn()
  }
  const runtimeSupervisor = {
    latestOr: <Settings>(fallback: Settings): Settings => (latest ?? fallback) as Settings,
    setManagedRuntimeExpected: vi.fn(),
    restart: vi.fn(async (operation: () => Promise<void>) => operation()),
    replace: vi.fn(async (operation: () => Promise<void>) => operation()),
    ensure: vi.fn(async (_fingerprint: string, operation: () => Promise<unknown>) => operation())
  }

  return {
    clearHistoricalKunServeProcesses,
    ensureReplacementRunning,
    ensureRunning,
    resolveConnection,
    mainState,
    noteRuntimeHealthy,
    probeRuntimeApi,
    probeBundledBuildReplacement,
    runtimeSupervisor,
    setLatest: (settings: unknown): void => { latest = settings },
    stopSharedAndWait,
    stopSharedForReplacementAndWait,
    waitForHealthy,
    waitForKunStartupSettled
  }
})

vi.mock('./runtime/kun-adapter', () => ({
  kunRuntimeAdapter: {
    ensureRunning: harness.ensureRunning,
    ensureReplacementRunning: harness.ensureReplacementRunning,
    isChildRunning: () => false,
    probeBundledBuildReplacement: harness.probeBundledBuildReplacement,
    resolveConnection: harness.resolveConnection,
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
  ensureKunServeFreshOnStartup,
  reconcileBundledRuntimeAfterInstall,
  replaceKunServe,
  restartAllKunServeProcesses
} from './main-runtime-startup'

function settings(): AppSettingsV1 {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return {
    ...base,
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        autoStart: true
      }
    }
  }
}

beforeEach(() => {
  harness.setLatest(undefined)
  harness.stopSharedAndWait.mockClear()
  harness.stopSharedForReplacementAndWait.mockClear()
  harness.ensureRunning.mockClear()
  harness.ensureReplacementRunning.mockClear()
  harness.resolveConnection.mockReset()
  harness.resolveConnection.mockResolvedValue(false)
  harness.probeBundledBuildReplacement.mockReset()
  harness.probeBundledBuildReplacement.mockResolvedValue({ state: 'matched', ownership: 'none' })
  harness.waitForHealthy.mockClear()
  harness.probeRuntimeApi.mockClear()
  harness.noteRuntimeHealthy.mockClear()
  harness.waitForKunStartupSettled.mockClear()
  harness.clearHistoricalKunServeProcesses.mockReset()
  harness.clearHistoricalKunServeProcesses.mockResolvedValue({
    matchedPids: [],
    terminatedPids: [],
    alreadyExitedPids: [],
    failedPids: []
  })
  harness.mainState.assertCanonicalRuntimeMigrationReady.mockClear()
  harness.runtimeSupervisor.restart.mockClear()
  harness.runtimeSupervisor.replace.mockClear()
  harness.runtimeSupervisor.ensure.mockClear()
  harness.runtimeSupervisor.ensure.mockImplementation(async (_fingerprint: string, operation: () => Promise<unknown>) => operation())
  harness.runtimeSupervisor.setManagedRuntimeExpected.mockClear()
})

describe('explicit Kun serve replacement', () => {
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
  })

  it('hands a packaged build mismatch to the same explicit replacement path before startup attach', async () => {
    const current = settings()
    harness.probeBundledBuildReplacement.mockResolvedValue({ state: 'mismatched' })

    await expect(reconcileBundledRuntimeAfterInstall(current)).resolves.toBeUndefined()

    expect(harness.probeBundledBuildReplacement).toHaveBeenCalledWith(current)
    expect(harness.runtimeSupervisor.replace).toHaveBeenCalledOnce()
    expect(harness.stopSharedForReplacementAndWait).toHaveBeenCalledWith(current)
    expect(harness.ensureReplacementRunning).toHaveBeenCalledWith(current)
    expect(harness.ensureRunning).not.toHaveBeenCalled()
  })

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
