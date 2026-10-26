import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { useHarnessStore } from '../../store/harness-store'
import { AgentDispatchRoutePicker } from './AgentDispatchRoutePicker'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }), initReactI18next: { type: '3rdParty', init: () => undefined } }))
vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (value: unknown) => unknown) =>
  select({ composerModelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-v4'] }] }) }))
vi.mock('../../store/agent-roster-store', () => ({ useAgentRoster: () => ({ entries: [] }) }))
vi.mock('../../lib/harness-defaults', () => ({ harnessDefaultsSnapshot: () => ({}) }))
vi.mock('../../lib/kun-model-provider-groups', () => ({ isKunModelProviderGroup: () => true }))
vi.mock('../../store/harness-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/harness-store')>()
  return { ...actual, loadHarnesses: vi.fn(), loadHarnessModels: vi.fn(), loadHarnessProviderGroups: vi.fn(),
    harnessRowUnavailableCode: () => null }
})
vi.mock('./FloatingComposerHarnessPicker', () => ({
  FloatingComposerHarnessPicker: (props: { harnessId: string; loading: boolean; onSelect: (id: string) => void }) =>
    createElement('button', { 'data-harness': props.harnessId, 'data-loading': props.loading, onClick: () => props.onSelect('codex') })
}))
vi.mock('./FloatingComposerModelPicker', () => ({ FloatingComposerModelPicker: () => null }))

function row(id: string): AdeHarnessRow {
  return {
    definition: { id, displayName: id, transport: id === 'kun' ? 'native-loop' : 'acp', credentialModes: ['native-login'],
      permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true },
    status: { harnessId: id, installed: 'yes', login: 'signed-in', ready: 'yes', checkedAt: '2026-01-01T00:00:00Z' }
  } as unknown as AdeHarnessRow
}

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useHarnessStore.setState({ rows: [row('kun'), row('codex')], models: {}, providerGroups: {} })
})
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('AgentDispatchRoutePicker', () => {
  it('finishes an Agent switch once the new Agent\'s catalog arrives', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek', credentialMode: 'provider' as const }
    await act(async () => {
      renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange }))
    })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    // No catalog yet: the pick shows at once and waits instead of being dropped.
    expect(onChange).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('codex')
    expect(renderer!.root.findByType('button').props['data-loading']).toBe(true)

    await act(async () => {
      useHarnessStore.setState({ models: { codex: { models: ['gpt-6.1-codex'], loading: false } } })
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'codex', model: 'gpt-6.1-codex' }))
  })

  it('drops a pick whose catalog settles empty instead of hanging on it', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4' }
    await act(async () => {
      renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange }))
    })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    await act(async () => { useHarnessStore.setState({ models: { codex: { models: [], loading: false, error: 'boom' } } }) })
    expect(onChange).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('kun')
  })
})
