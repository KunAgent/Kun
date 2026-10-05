import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import type { KunRuntimeSettingsSyncStatusPayload } from '../shared/kun-gui-api'
import { createStartupSettingsApply } from './main-runtime-startup-flow'

function fixture(result: 'applied' | 'failed' | 'skipped' = 'applied') {
  let status: KunRuntimeSettingsSyncStatusPayload = { state: 'idle', generation: 0, at: '' }
  let operation!: () => Promise<void>
  let onError!: (error: unknown) => void
  const publish = vi.fn((next) => { status = { ...next, at: '' } })
  const apply = vi.fn(async () => ({ result }))
  const pending = createStartupSettingsApply({} as AppSettingsV1, {
    settledRuntimeSettings: null,
    runtimeSupervisor: {
      enqueueSettingsApply: (run, fail) => { operation = run; onError = fail },
      waitForIdle: async () => undefined
    },
    applyManagedRuntimeSettingsHot: apply,
    settingsSync: { current: () => status, publish },
    logWarn: vi.fn()
  })
  return { publish, apply, pending, status: () => status,
    newer: () => { status = { state: 'syncing', generation: 1, at: '' } },
    run: async () => { try { await operation() } catch (error) { onError(error) } } }
}

describe('startup configuration acknowledgment', () => {
  it('moves cold-start idle through syncing to synced only after application', async () => {
    const f = fixture()
    expect(f.status().state).toBe('syncing')
    await f.run(); await f.pending
    expect(f.status()).toMatchObject({ state: 'synced', generation: 0 })
  })
  it('does not acknowledge a newer user save with an older startup result', async () => {
    const f = fixture(); f.newer()
    await f.run(); await f.pending
    expect(f.status()).toMatchObject({ state: 'syncing', generation: 1 })
    expect(f.publish).toHaveBeenCalledTimes(1)
  })
  it.each(['failed', 'skipped'] as const)('reports %s without claiming synced', async (outcome) => {
    const f = fixture(outcome); await f.run(); await f.pending
    expect(f.status().state).toBe(outcome === 'skipped' ? 'unavailable' : 'failed')
  })
  it('settles and reports a failed startup application', async () => {
    const f = fixture(); f.apply.mockRejectedValue(new Error('fixture failure'))
    await f.run(); await f.pending
    expect(f.status().state).toBe('failed')
  })
})
