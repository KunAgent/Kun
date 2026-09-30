import { describe, expect, it, vi, beforeEach } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../../shared/app-settings'

const harness = vi.hoisted(() => ({
  isChildRunning: vi.fn(() => true),
  updateIf: vi.fn(),
  currentGeneration: 9
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('./kun-adapter', () => ({
  getRuntimeBaseUrlForSettings: () => 'http://127.0.0.1:18899',
  kunRuntimeAdapter: { isChildRunning: harness.isChildRunning },
  runtimeAuthHeaders: () => new Headers({ authorization: 'Bearer test' })
}))
vi.mock('../main-app-context', () => ({
  mainState: { store: { updateIf: harness.updateIf }, runtimeSettingsSyncStatus: {} },
  runtimeSettingsIntents: { currentGeneration: harness.currentGeneration }
}))
vi.mock('../logger', () => ({ logInfo: vi.fn(), logWarn: vi.fn() }))

import { reconcileLocalGatewayCredential } from './local-gateway-credential'

function settingsWithGateway(enabled: boolean): AppSettingsV1 {
  const settings = normalizeAppSettings({} as AppSettingsV1)
  settings.provider.localGateway.enabled = enabled
  return settings
}

beforeEach(() => {
  vi.restoreAllMocks()
  harness.isChildRunning.mockReturnValue(true)
  harness.updateIf.mockReset()
})

describe('reconcileLocalGatewayCredential', () => {
  it('does nothing when the gateway is disabled or the runtime is stopped', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    expect(await reconcileLocalGatewayCredential(settingsWithGateway(false), 'test')).toEqual({ outcome: 'unchanged' })
    harness.isChildRunning.mockReturnValue(false)
    expect(await reconcileLocalGatewayCredential(settingsWithGateway(true), 'test')).toEqual({ outcome: 'unchanged' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves settings untouched when the key already exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ credential: { configured: true } }), { status: 200 })
    )
    expect(await reconcileLocalGatewayCredential(settingsWithGateway(true), 'test'))
      .toEqual({ outcome: 'unchanged' })
    expect(harness.updateIf).not.toHaveBeenCalled()
  })

  it('ensures the missing key without touching settings', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ credential: { configured: false } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'kun_local_x' }), { status: 200 }))
    expect(await reconcileLocalGatewayCredential(settingsWithGateway(true), 'test'))
      .toEqual({ outcome: 'key_ensured' })
    expect(harness.updateIf).not.toHaveBeenCalled()
  })

  it('disables the gateway in durable settings when key creation fails', async () => {
    const current = settingsWithGateway(true)
    harness.updateIf.mockImplementation(
      async (predicate: (s: AppSettingsV1) => boolean, mutation: (s: AppSettingsV1) => AppSettingsV1) => {
        if (!predicate(current)) return { settings: current, applied: false }
        return { settings: await mutation(current), applied: true }
      }
    )
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))

    const result = await reconcileLocalGatewayCredential(current, 'test')

    expect(result.outcome).toBe('disabled')
    if (result.outcome === 'disabled') {
      expect(result.settings.provider.localGateway.enabled).toBe(false)
      expect(result.message).toContain('turned off')
    }
  })

  it('does not overwrite settings when the user already disabled the gateway', async () => {
    harness.updateIf.mockResolvedValue({ settings: settingsWithGateway(false), applied: false })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    expect(await reconcileLocalGatewayCredential(settingsWithGateway(true), 'test'))
      .toEqual({ outcome: 'unchanged' })
  })
})
