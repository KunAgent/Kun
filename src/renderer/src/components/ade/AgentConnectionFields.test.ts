// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
const f = vi.hoisted(() => ({ nativeModels: vi.fn(), providerGroups: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/harness-store', () => ({
  useHarnessStore: (select: (state: unknown) => unknown) => select({ providerGroups: {}, models: {} }),
  loadHarnessModels: f.nativeModels, loadHarnessProviderGroups: f.providerGroups
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (state: unknown) => unknown) => select({ composerModelGroups: [] }) }))
import { AgentConnectionFields } from './AgentConnectionFields'

const row = (transport: AdeHarnessRow['definition']['transport'], modes: AdeHarnessRow['definition']['credentialModes']): AdeHarnessRow => ({
  definition: { id: 'aider', displayName: 'Aider', transport, credentialModes: modes, permissionModes: [],
    modelSource: 'static', staticModels: ['not-a-real-native-catalog'], builtin: true },
  status: { harnessId: 'aider', installed: 'yes', login: 'not-required', checkedAt: '' }
})

it('does not fabricate a native model picker for a terminal Agent', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(createElement(AgentConnectionFields, { row: row('terminal', ['native-login']),
      value: {}, profile: { harnessId: 'aider', credentialMode: 'native-login' }, modelsEnabled: false, onChange: vi.fn() })))
    expect(container.querySelector('[data-agent-profile-model]')).toBeNull()
    expect(container.textContent).toContain('agentIntegrations.terminalModelManaged')
    expect(container.textContent).not.toContain('not-a-real-native-catalog')
    expect(f.nativeModels).not.toHaveBeenCalled()
    expect(f.providerGroups).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})

it('offers one card per supported connection mode and reports a change that resets the route', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onChange = vi.fn()
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(createElement(AgentConnectionFields, { row: row('acp', ['native-login', 'provider']),
      value: { model: 'old' }, profile: { harnessId: 'aider', credentialMode: 'native-login' }, modelsEnabled: true, onChange })))
    const cards = [...container.querySelectorAll<HTMLButtonElement>('[data-agent-profile-mode-option]')]
    expect(cards.map((card) => card.getAttribute('data-agent-profile-mode-option'))).toEqual(['native-login', 'provider'])
    expect(cards.map((card) => card.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    await act(async () => cards[0]!.click())
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => cards[1]!.click())
    expect(onChange).toHaveBeenCalledWith({ credentialMode: 'provider', providerId: undefined, gatewayBinding: undefined, model: undefined })
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
