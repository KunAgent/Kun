import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { AgentDispatchAssignmentRoute } from '@shared/agent-dispatch'
import type { KunHarnessDefaultsEntryV1 } from '@shared/app-settings-types-kun-runtime'
import { harnessDefaultsSnapshot } from '../../lib/harness-defaults'
import { loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
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
vi.mock('../../lib/harness-defaults', () => ({ harnessDefaultsSnapshot: vi.fn(() => ({})) }))
vi.mock('../../lib/kun-model-provider-groups', () => ({ isKunModelProviderGroup: () => true }))
vi.mock('../../store/harness-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/harness-store')>()
  return { ...actual, loadHarnesses: vi.fn(), loadHarnessModels: vi.fn(), loadHarnessProviderGroups: vi.fn(),
    harnessRowUnavailableCode: () => null }
})
vi.mock('./FloatingComposerHarnessPicker', () => ({
  FloatingComposerHarnessPicker: (props: { harnessId: string; loading: boolean; onSelect: (id: string) => void; onOpen: () => void }) =>
    createElement('button', { 'data-harness': props.harnessId, 'data-loading': props.loading,
      onClick: () => props.onSelect('codex'), onSelect: props.onSelect, onOpen: props.onOpen })
}))
vi.mock('./FloatingComposerModelPicker', () => ({ FloatingComposerModelPicker: mocks.modelPicker }))

function row(id: string): AdeHarnessRow {
  return {
    definition: { id, displayName: id, transport: id === 'kun' ? 'native-loop' : 'acp', credentialModes: id === 'kun' ? ['provider'] : ['native-login'],
      permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true },
    enabled: true,
    enabledProfiles: [{ harnessId: id, credentialMode: id === 'kun' ? 'provider' : 'native-login' }],
    readyProfiles: [{ harnessId: id, credentialMode: id === 'kun' ? 'provider' : 'native-login', expiresAt: '2099-01-01T00:00:00Z' }],
    status: { harnessId: id, installed: 'yes', login: 'signed-in', ready: 'yes', checkedAt: '2026-01-01T00:00:00Z' }
  } as unknown as AdeHarnessRow
}

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.mocked(harnessDefaultsSnapshot).mockReturnValue({} as Record<string, KunHarnessDefaultsEntryV1>)
  vi.mocked(loadHarnessModels).mockReset()
  vi.mocked(loadHarnessProviderGroups).mockReset()
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

  it('shows the pending Agent catalog instead of the previous Agent models', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' }
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('codex') })
    expect(loadHarnessModels).toHaveBeenCalledWith('codex')
    expect(pickerProps().agentHarnessId).toBe('codex')
    expect(pickerProps().composerModel).toBe('')
    expect(pickerProps().composerPickList).toEqual([])
    await act(async () => { useHarnessStore.setState({ models: { codex: { models: [], loading: true } } }) })
    expect(pickerProps().emptyModelState).toBe('loading')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cancels a pending switch when choosing the original Agent and ignores its late catalog', async () => {
    const onChange = vi.fn()
    const onPendingChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' }
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange, onPendingChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('codex') })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('kun') })
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('kun')
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
    expect(pickerProps().composerModel).toBe('deepseek-v4')
    await act(async () => { useHarnessStore.setState({ models: { codex: { models: ['native-model'], loading: false } } }) })
    expect(onChange).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('kun')
  })

  it('restores the original Kun model with several configured providers after an external switch', async () => {
    const onChange = vi.fn()
    const initial = { agentId: 'kun', model: 'gpt-model', providerId: 'openai', credentialMode: 'provider' as const, profileId: 'reviewer' }
    function Card() {
      const [route, setRoute] = useState<AgentDispatchAssignmentRoute>(initial)
      return createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange: (next) => { onChange(next); setRoute(next) } })
    }
    useHarnessStore.setState({ models: { codex: { models: ['native-model'], loading: false } } })
    await act(async () => { renderer = create(createElement(Card)) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('codex') })
    expect(onChange).toHaveBeenLastCalledWith({ agentId: 'codex', model: 'native-model', credentialMode: 'native-login', profileId: 'reviewer' })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('kun') })
    expect(onChange).toHaveBeenLastCalledWith(initial)
    expect(pickerProps().composerModel).toBe('gpt-model')
    expect(renderer!.root.findAll((node) => node.props['data-dispatch-route-dropped'])).toHaveLength(0)
    expect(loadHarnessProviderGroups).not.toHaveBeenCalledWith('kun')
  })

  it('allows an explicit Kun provider/model choice instead of treating provider ambiguity as no models', async () => {
    const onChange = vi.fn()
    const onPendingChange = vi.fn()
    const route = { agentId: 'codex', model: 'native-model', credentialMode: 'native-login' as const }
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange, onPendingChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('kun') })
    expect(onChange).not.toHaveBeenCalled()
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('kun')
    expect(renderer!.root.findAll((node) => node.props['data-dispatch-route-dropped'])).toHaveLength(0)
    expect(pickerProps().composerPickList).toContain('gpt-model')
    await act(async () => pickerProps().onComposerModelChange('gpt-model', 'openai'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'kun', model: 'gpt-model', providerId: 'openai', credentialMode: 'provider' }))
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it('reloads and refreshes the pending catalog after a readiness change invalidates it', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' }
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('codex') })
    vi.mocked(loadHarnessModels).mockClear()
    await act(async () => {
      const changed = row('codex')
      changed.status.version = '2.0.0'
      useHarnessStore.setState({ rows: [row('kun'), changed], models: {} })
    })
    expect(loadHarnessModels).toHaveBeenCalledWith('codex')
    await act(async () => { renderer!.root.findByType('button').props.onOpen() })
    expect(loadHarnessModels).toHaveBeenLastCalledWith('codex', true)
    await act(async () => { useHarnessStore.setState({ models: { codex: { models: ['native-model'], loading: false } } }) })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'codex', model: 'native-model' }))
  })

  it('waits for a retry instead of dropping a new pick on the previous failure snapshot', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' }
    useHarnessStore.setState({ models: { codex: { models: [], loading: false, error: 'temporary failure' } } })
    vi.mocked(loadHarnessModels).mockImplementation(async (harnessId) => {
      useHarnessStore.setState({ models: { [harnessId]: { models: [], loading: true } } })
    })
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('codex') })
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('codex')
    expect(renderer!.root.findAll((node) => node.props['data-dispatch-route-dropped'])).toHaveLength(0)
    await act(async () => { useHarnessStore.setState({ models: { codex: { models: ['native-model'], loading: false } } }) })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'codex', model: 'native-model' }))
  })

  it('waits for the live catalog before replacing a stale saved default model', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' }
    vi.mocked(harnessDefaultsSnapshot).mockReturnValue({ codex: { credentialMode: 'native-login', model: 'removed-model' } } as Record<string, KunHarnessDefaultsEntryV1>)
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('codex') })
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { useHarnessStore.setState({ models: { codex: { models: ['first-model', 'reported-default'],
      modelInfo: [{ id: 'reported-default', isDefault: true }], loading: false } } }) })
    expect(onChange).toHaveBeenLastCalledWith({ agentId: 'codex', model: 'reported-default', credentialMode: 'native-login' })
  })

  it('does not commit a late native model after its ready credential profile is revoked', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' }
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('codex') })
    await act(async () => {
      const revoked = row('codex')
      revoked.readyProfiles = []
      useHarnessStore.setState({ rows: [row('kun'), revoked], models: { codex: { models: ['native-model'], loading: false } } })
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('button').props['data-harness']).toBe('kun')
  })

  it('allows a provider model on the pending Agent while its native catalog is unavailable', async () => {
    const onChange = vi.fn()
    const route = { agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek', profileId: 'reviewer' }
    const providerRow = row('cursor')
    providerRow.definition.credentialModes = ['native-login', 'provider']
    providerRow.enabledProfiles = [{ harnessId: 'cursor', credentialMode: 'native-login' },
      ...['provider-a', 'provider-b'].map((providerId) => ({ harnessId: 'cursor', credentialMode: 'provider' as const, providerId }))]
    providerRow.readyProfiles = providerRow.enabledProfiles.map((profile) => ({ ...profile, expiresAt: '2099-01-01T00:00:00Z' }))
    useHarnessStore.setState({ rows: [row('kun'), providerRow], providerGroups: { cursor: { loading: false, groups: [
      { providerId: 'provider-a', label: 'A', models: ['a-model'] }, { providerId: 'provider-b', label: 'B', models: ['b-model'] }
    ] } } })
    await act(async () => { renderer = create(createElement(AgentDispatchRoutePicker, { route, disabled: false, onChange })) })
    await act(async () => { renderer!.root.findByType('button').props.onSelect('cursor') })
    expect(loadHarnessProviderGroups).toHaveBeenCalledWith('cursor')
    expect(onChange).not.toHaveBeenCalled()
    expect(pickerProps().composerModelGroups?.flatMap((group) => group.modelIds)).toContain('b-model')
    await act(async () => pickerProps().onComposerModelChange('b-model', 'ade-cred:provider:provider-b'))
    expect(onChange).toHaveBeenLastCalledWith({ agentId: 'cursor', model: 'b-model', providerId: 'provider-b', credentialMode: 'provider', profileId: 'reviewer' })
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
