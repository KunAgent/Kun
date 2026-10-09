// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
import { SETTINGS_CHANGED_EVENT } from './keyboard-shortcut-settings'
const fixture = vi.hoisted(() => ({ getSettings: vi.fn(), invalidate: vi.fn(), load: vi.fn() }))
vi.mock('../agent/runtime-client', () => ({ rendererRuntimeClient: { getSettings: fixture.getSettings } }))
vi.mock('../store/harness-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../store/harness-store')>(),
  applyHarnessEnablementSettings: fixture.invalidate, loadHarnesses: fixture.load
}))
import { useHarnessDefaults } from './harness-defaults'
afterEach(() => { vi.clearAllMocks() })

it('does not discard ready Agents for theme/workspace updates, but invalidates changed Agent settings', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const settings = { theme: 'light', agents: { kun: { harnesses: defaultKunHarnessSettings() } } } as unknown as AppSettingsV1
  fixture.getSettings.mockResolvedValue(settings)
  function Probe() { useHarnessDefaults(); return null }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(createElement(Probe)))
    await act(async () => window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, {
      detail: { ...settings, theme: 'dark', workspaceRoot: '/another-project' }
    })))
    expect(fixture.invalidate).not.toHaveBeenCalled()
    expect(fixture.load).not.toHaveBeenCalled()
    const harnesses = { ...settings.agents.kun.harnesses, disabledIds: ['devin'] }
    await act(async () => window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, {
      detail: { ...settings, agents: { kun: { ...settings.agents.kun, harnesses } } }
    })))
    expect(fixture.invalidate).toHaveBeenCalledExactlyOnceWith(harnesses, [])
    expect(fixture.load).toHaveBeenCalledExactlyOnceWith(true)
    vi.clearAllMocks()
    const changedLaunch = { ...harnesses, binaryPaths: { pi: '/another/pi' } }
    await act(async () => window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, {
      detail: { ...settings, agents: { kun: { ...settings.agents.kun, harnesses: changedLaunch } } }
    })))
    expect(fixture.invalidate).toHaveBeenCalledExactlyOnceWith(changedLaunch, ['pi'])
    expect(fixture.load).toHaveBeenCalledExactlyOnceWith(true)
  } finally {
    await act(async () => root.unmount())
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  }
})
