// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
const f = vi.hoisted(() => ({ nativeModels: vi.fn(), providerGroups: vi.fn(), enable: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/harness-store', () => ({
  useHarnessStore: (select: (state: unknown) => unknown) => select({ providerGroups: {}, models: {} }),
  loadHarnessModels: f.nativeModels, loadHarnessProviderGroups: f.providerGroups
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (state: unknown) => unknown) => select({ composerModelGroups: [] }) }))
vi.mock('./use-agent-enablement', () => ({ useAgentEnablement: () => ({
  profile: { harnessId: 'aider', credentialMode: 'native-login' }, enabled: false,
  error: '', checking: false, cancel: vi.fn(), enable: f.enable, disable: vi.fn()
}) }))
import { AgentEnablementPanel } from './AgentEnablementPanel'
it('offers the existing explicit enablement flow without a fabricated native terminal model picker', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const row: AdeHarnessRow = {
    definition: { id: 'aider', displayName: 'Aider', transport: 'terminal', credentialModes: ['native-login'],
      permissionModes: [], modelSource: 'static', staticModels: ['not-a-real-native-catalog'], builtin: true },
    status: { harnessId: 'aider', installed: 'yes', login: 'not-required', checkedAt: '' }
  }
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(createElement(AgentEnablementPanel, { row, settings: defaultKunHarnessSettings(), patch: vi.fn() })))
    expect(container.querySelector('[data-agent-profile-model]')).toBeNull()
    expect(container.textContent).toContain('agentIntegrations.terminalModelManaged')
    expect(container.textContent).not.toContain('not-a-real-native-catalog')
    expect(f.nativeModels).not.toHaveBeenCalled()
    expect(f.providerGroups).not.toHaveBeenCalled()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-enable]')!.click())
    expect(f.enable).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
