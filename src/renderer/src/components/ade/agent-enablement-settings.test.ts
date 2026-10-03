import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import { waitForAgentSettings } from './agent-enablement-settings'
const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), sync: vi.fn() }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { getSettings: mocks.getSettings } }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const setup = () => {
  const runtime = defaultKunRuntimeSettings()
  mocks.getSettings.mockReset().mockResolvedValue({ agents: { kun: runtime } })
  mocks.sync.mockReset().mockResolvedValue({ state: 'synced' })
  vi.stubGlobal('window', { kunGui: { getRuntimeSettingsSyncStatus: mocks.sync } })
  return runtime
}
describe('enablement settings synchronization', () => {
  it('requires matching command/profile settings and a synced runtime', async () => {
    const runtime = setup()
    await expect(waitForAgentSettings(runtime.harnesses, new AbortController().signal)).resolves.toBeUndefined()
    mocks.sync.mockResolvedValue({ state: 'failed' })
    await expect(waitForAgentSettings(runtime.harnesses, new AbortController().signal)).rejects.toThrow('settingsUnavailable')
  })
  it('never proceeds using an old binary while saving', async () => {
    vi.useFakeTimers(); const runtime = setup()
    const next = { ...runtime.harnesses, binaryPaths: { pi: '/new/pi' } }
    const pending = waitForAgentSettings(next, new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('settingsUnavailable')
    await vi.advanceTimersByTimeAsync(10_100)
    await rejection
  })
  it('lets opt-in changes proceed without confusing them with configuration changes', async () => {
    const runtime = setup()
    await expect(waitForAgentSettings({ ...runtime.harnesses,
      enabledProfiles: [{ harnessId: 'pi', credentialMode: 'native-login' }] }, new AbortController().signal)).resolves.toBeUndefined()
  })
  it('honors cancellation while synchronization is pending', async () => {
    const runtime = setup(); mocks.sync.mockResolvedValue({ state: 'syncing' })
    const controller = new AbortController()
    const pending = waitForAgentSettings(runtime.harnesses, controller.signal)
    const rejection = expect(pending).rejects.toThrow()
    controller.abort()
    await rejection
  })
})
