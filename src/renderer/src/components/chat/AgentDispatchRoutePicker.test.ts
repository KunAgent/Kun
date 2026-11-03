import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { useHarnessStore } from '../../store/harness-store'
import { AgentDispatchRoutePicker } from './AgentDispatchRoutePicker'
import type { FloatingComposerModelPicker } from './FloatingComposerModelPicker'
const mocks = vi.hoisted(() => ({ modelPicker: vi.fn((_props: Record<string, unknown>) => null) }))
type PickerProps = Parameters<typeof FloatingComposerModelPicker>[0]
const pickerProps = (): PickerProps => mocks.modelPicker.mock.calls.at(-1)![0] as unknown as PickerProps

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }), initReactI18next: { type: '3rdParty', init: () => undefined } }))
vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (value: unknown) => unknown) =>
  select({ composerModelGroups: [
    { providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-v4'], modelProfiles: { 'deepseek-v4': {
      reasoning: { supportedEfforts: ['off', 'high', 'max'], defaultEffort: 'max', requestProtocol: 'deepseek-chat-completions' } } } },
    { providerId: 'openai', label: 'OpenAI', modelIds: ['gpt-model'], modelProfiles: { 'gpt-model': {
      reasoning: { supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', requestProtocol: 'openai-responses' } } } },
    { providerId: 'plain', label: 'Plain', modelIds: ['plain-model'], modelProfiles: { 'plain-model': { supportsReasoning: false } } }
  ] }) }))
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
vi.mock('./FloatingComposerModelPicker', () => ({ FloatingComposerModelPicker: mocks.modelPicker }))

function row(id: string): AdeHarnessRow {
  return {
    definition: { id, displayName: id, transport: id === 'kun' ? 'native-loop' : 'acp', credentialModes: ['native-login'],
      permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true },
    status: { harnessId: id, installed: 'yes', login: 'signed-in', ready: 'yes', checkedAt: '2026-01-01T00:00:00Z' }
  } as unknown as AdeHarnessRow
}

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  mocks.modelPicker.mockClear()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useHarnessStore.setState({ rows: [row('kun'), row('codex')], models: {}, providerGroups: {} })
})
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('AgentDispatchRoutePicker', () => {
  it('edits only supported reasoning levels and preserves the worker role', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek', profileId: 'reviewer', reasoningEffort: 'off' as const }
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange })) })
    expect(pickerProps().reasoningScope).toBe('task')
    expect(pickerProps().composerReasoningEffort).toBe('off')
    await act(async () => pickerProps().onComposerReasoningEffortChange?.('low'))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => pickerProps().onComposerReasoningEffortChange?.('high'))
    expect(onChange).toHaveBeenLastCalledWith({ ...route, reasoningEffort: 'high' })
    await act(async () => pickerProps().onComposerModelChange('gpt-model', 'openai'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'gpt-model', providerId: 'openai', profileId: 'reviewer', reasoningEffort: 'high' }))
    await act(async () => pickerProps().onComposerModelChange('plain-model', 'plain'))
    expect(onChange.mock.calls.at(-1)![0]).not.toHaveProperty('reasoningEffort')
  })

  it('holds the dispatch while the model menu is open without changing a route on mount', async () => {
    const onChange = vi.fn()
    const onPendingChange = vi.fn()
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, {
      route: { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' }, disabled: false, onChange, onPendingChange })) })
    await act(async () => pickerProps().onOpenChange?.(true))
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => pickerProps().onOpenChange?.(false))
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it('does not offer card reasoning controls for advisory preference routes', async () => {
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, {
      route: { agentId: 'kun' }, disabled: false, onChange: vi.fn(), preference: true })) })
    expect(pickerProps().reasoningScope).toBeUndefined()
    expect(pickerProps().onComposerReasoningEffortChange).toBeUndefined()
  })

  it('says so when a picked Agent turns out to have no usable model', async () => {
    const onChange = vi.fn()
    const onPendingChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek', credentialMode: 'provider' as const }
    await act(async () => {
      renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange, onPendingChange }))
    })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    await act(async () => {
      useHarnessStore.setState({ models: { codex: { models: [], loading: false } } })
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
    expect(renderer!.root.findAll((node) => node.props['data-dispatch-route-dropped'])).toHaveLength(1)
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('kun')
  })

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
