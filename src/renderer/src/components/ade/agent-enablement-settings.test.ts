import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import { AGENT_SETTINGS_TIMEOUT_MS, waitForAgentSettings } from './agent-enablement-settings'
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
    await expect(waitForAgentSettings(runtime.harnesses, new AbortController().signal)).rejects.toThrow('settingsApplyFailed')
  })
  it('never proceeds using an old binary while saving', async () => {
    vi.useFakeTimers(); const runtime = setup()
    const next = { ...runtime.harnesses, binaryPaths: { pi: '/new/pi' } }
    const pending = waitForAgentSettings(next, new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('settingsTimeout')
    await vi.advanceTimersByTimeAsync(AGENT_SETTINGS_TIMEOUT_MS + 250)
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

it('waits for startup acknowledgment instead of accepting idle as applied', async () => {
  vi.useFakeTimers(); const runtime = setup()
  mocks.sync.mockResolvedValue({ state: 'idle' })
  let done = false
  const pending = waitForAgentSettings(runtime.harnesses, new AbortController().signal).then(() => { done = true })
  await vi.advanceTimersByTimeAsync(15_000)
  expect(done).toBe(false)
  mocks.sync.mockResolvedValue({ state: 'synced' })
  await vi.advanceTimersByTimeAsync(250); await pending
  expect(done).toBe(true)
})
it('normalizes equivalent defaults and record order before comparison', async () => {
  const runtime = setup()
  runtime.harnesses.defaults = { devin: { credentialMode: 'native-login', permissionMode: 'bypass' } }
  await expect(waitForAgentSettings({ ...runtime.harnesses, defaults: {
    devin: { permissionMode: 'bypass', credentialMode: 'native-login' }
  } }, new AbortController().signal)).resolves.toBeUndefined()
})
it('requires the actual opted-in profile after activation', async () => {
  vi.useFakeTimers(); const runtime = setup()
  const profile = { harnessId: 'devin', credentialMode: 'native-login' as const }
  let done = false
  const pending = waitForAgentSettings(runtime.harnesses, new AbortController().signal,
    { enabledProfile: profile, harnessId: 'devin' }).then(() => { done = true })
  await vi.advanceTimersByTimeAsync(250); expect(done).toBe(false)
  runtime.harnesses.enabledProfiles = [profile]
  await vi.advanceTimersByTimeAsync(250); await pending
  expect(done).toBe(true)
})
it('retains an apply failure detail and cancels a stalled IPC read', async () => {
  const runtime = setup()
  mocks.sync.mockResolvedValue({ state: 'failed', message: 'A configuration section was rejected' })
  await expect(waitForAgentSettings(runtime.harnesses, new AbortController().signal))
    .rejects.toMatchObject({ message: 'agentEnablement.settingsApplyFailed', detail: 'A configuration section was rejected' })
  mocks.getSettings.mockReturnValue(new Promise(() => undefined))
  const controller = new AbortController()
  const pending = waitForAgentSettings(runtime.harnesses, controller.signal)
  controller.abort(new Error('cancelled'))
  await expect(pending).rejects.toThrow('cancelled')
})
