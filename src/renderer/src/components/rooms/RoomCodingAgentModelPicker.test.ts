import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentIdentity, Room } from '@shared/rooms-api'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import i18n from '../../i18n'
import { useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposerModelPicker } from '../chat/FloatingComposerModelPicker'
import { RoomCodingAgentModelPicker } from './RoomCodingAgentModelPicker'
import { RoomDirectModelPicker } from './RoomDirectModelPicker'

const api = vi.hoisted(() => ({ request: vi.fn(), rows: vi.fn(), native: vi.fn(), providers: vi.fn() }))
vi.mock('./rooms-client', async (load) => ({ ...await load<typeof import('./rooms-client')>(), roomsRequest: api.request }))
vi.mock('../../store/harness-store', async (load) => ({ ...await load<typeof import('../../store/harness-store')>(),
  loadHarnesses: api.rows, loadHarnessModels: api.native, loadHarnessProviderGroups: api.providers }))
const agent = { id: 'codex-agent', revision: 2,
  executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'old-model' } } as AgentIdentity
const row: AdeHarnessRow = { definition: { id: 'codex', displayName: 'Codex', transport: 'codex-app-server',
  credentialModes: ['native-login', 'kun-gateway'], permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true },
  status: { harnessId: 'codex', installed: 'yes', login: 'signed-in', checkedAt: '2026-10-08T00:00:00Z' } }
const room = { id: 'private', revision: 4, conversationKind: 'user_agent', members: [{ participantAgentId: agent.id }] } as Room

describe('coding Agent conversation model selection', () => {
  let renderer: ReactTestRenderer
  const changed = vi.fn(), saved = vi.fn(async () => undefined), busy = vi.fn()
  const picker = () => renderer.root.findByType(FloatingComposerModelPicker).props
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    useChatStore.setState({ composerModelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-model'] }] })
    useHarnessStore.setState({ rows: [withHarnessReadiness(row)], rowsLoading: false, rowsError: undefined,
      models: { codex: { loading: false, models: ['old-model', 'new-model'], modelInfo: [
        { id: 'old-model', reasoningEfforts: ['low', 'high'] }, { id: 'new-model', reasoningEfforts: ['low'] }
      ] } }, providerGroups: {} })
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
  const mount = async (value = agent) => {
    await act(async () => { renderer = create(createElement(RoomCodingAgentModelPicker, { agent: value, onChange: changed })) })
  }

  it('loads the native catalog, excludes Kun models and changes only to a listed model', async () => {
    await mount()
    expect(api.native).toHaveBeenCalledWith('codex')
    expect(api.providers).not.toHaveBeenCalled()
    expect(picker().composerPickList).toEqual(['old-model', 'new-model'])
    expect(picker().composerProviderId).toBe('ade-cred:native-login')
    expect(picker().onComposerReasoningEffortChange).toBeUndefined()
    await act(async () => picker().onComposerModelChange('deepseek-model', 'deepseek'))
    await act(async () => picker().onComposerModelChange('new-model', 'ade-cred:native-login'))
    expect(changed).toHaveBeenCalledExactlyOnceWith('new-model', 'auto')
    expect(useChatStore.getState().composerModelGroups[0].providerId).toBe('deepseek')
  })

  it('keeps a gateway identity in its configured provider instead of switching account or engine', async () => {
    useHarnessStore.setState({ providerGroups: { codex: { loading: false, groups: [
      { providerId: 'deepseek', label: 'DeepSeek', models: ['provider-model', 'new-provider-model'] },
      { providerId: 'stepfun', label: 'StepFun', models: ['other-account-model'] }
    ] } } })
    await mount({ ...agent, executor: { ...agent.executor!, credentialMode: 'kun-gateway', providerId: 'deepseek', model: 'kun/deepseek/provider-model' } })
    expect(api.native).not.toHaveBeenCalled()
    expect(api.providers).toHaveBeenCalledWith('codex')
    expect(picker().composerModel).toBe('provider-model')
    expect(picker().composerPickList).toEqual(['provider-model', 'new-provider-model'])
    await act(async () => picker().onComposerModelChange('other-account-model', 'ade-cred:kun-gateway:stepfun'))
    expect(changed).not.toHaveBeenCalled()
  })

  it('shows discovery failure without substituting the Kun list', async () => {
    useHarnessStore.setState({ models: { codex: { models: [], loading: false, error: 'offline', errorCode: 'unavailable' } } })
    await mount()
    expect(picker().composerPickList).toEqual([])
    expect(picker().emptyModelState).toBe('agent-failed')
    await act(async () => renderer.root.findByProps({ role: 'alert' }).findByType('button').props.onClick())
    expect(api.native).toHaveBeenLastCalledWith('codex', true)
  })

  it('never saves merely because the native metadata normalizes an unsupported effort', async () => {
    const effort = vi.fn()
    await act(async () => { renderer = create(createElement(RoomCodingAgentModelPicker, {
      agent, reasoningEffort: 'max', onChange: changed, onReasoningEffortChange: effort
    })) })
    expect(picker().composerReasoningEffort).toBe('auto')
    expect(effort).not.toHaveBeenCalled()
    await act(async () => picker().onComposerReasoningEffortChange('high'))
    expect(effort).toHaveBeenCalledExactlyOnceWith('high')
  })

  it('persists the conversation override before displaying it and keeps the Agent default', async () => {
    let resolve!: (value: unknown) => void
    let committed = false
    api.request.mockImplementation((_path, method) => method === 'PUT' ? new Promise((yes) => { resolve = yes })
      : Promise.resolve({ agent, options: [], main: { model: 'old-model' },
        ...(committed ? { roomOverride: { model: 'new-model' } } : {}) }))
    await act(async () => { renderer = create(createElement(RoomDirectModelPicker, { room, onSaved: saved, onBusyChange: busy })) })
    await act(async () => picker().onComposerModelChange('new-model', 'ade-cred:native-login'))
    const put = api.request.mock.calls.find(([, method]) => method === 'PUT')
    expect(put).toEqual(['/v1/rooms/private/direct/model', 'PUT', { clientRequestId: expect.any(String), expectedRevision: 4, executorModel: 'new-model' }])
    expect(picker().composerModel).toBe('old-model')
    expect(picker().canChangeModel).toBe(false)
    committed = true
    await act(async () => resolve({ room: { ...room, revision: 5 } }))
    expect(picker().composerModel).toBe('new-model')
    expect(picker().canChangeModel).toBe(true)
    expect(agent.executor!.model).toBe('old-model')
    expect(saved).toHaveBeenCalledOnce()
    expect(busy).toHaveBeenLastCalledWith(false)
  })

  it.each(['missing-details', 'stale-model'])('does not persist an inferred reasoning effort for %s', async (scenario) => {
    if (scenario === 'missing-details') useHarnessStore.setState({ models: { codex: { loading: false, models: ['old-model', 'new-model'] } } })
    const value = scenario === 'stale-model' ? { ...agent, executor: { ...agent.executor!, model: 'deepseek-flash' } } : agent
    api.request.mockResolvedValue({ agent: value, options: [], main: { model: value.executor!.model } })
    await act(async () => { renderer = create(createElement(RoomDirectModelPicker, { room, onSaved: saved, onBusyChange: busy })) })
    expect(picker().onComposerReasoningEffortChange).toBeUndefined()
    expect(api.request.mock.calls.filter(([, method]) => method === 'PUT')).toEqual([])
    expect(picker().composerPickList).toEqual(['old-model', 'new-model'])
  })
})
