import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '@shared/rooms-api'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { ModelReasoningEffort } from '@shared/app-settings'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposerModelPicker } from '../chat/FloatingComposerModelPicker'
import { RoomDirectModelPicker } from './RoomDirectModelPicker'
import { directModelGroups, directReasoningEffort } from './room-direct-model-groups'
const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', async (original) => ({ ...(await original<typeof import('./rooms-client')>()), roomsRequest: api.request }))
const first = { providerId: 'api', providerLabel: 'API', accountId: 'personal', model: 'model', label: 'model', available: true,
  groupAvailable: true, fastAvailable: true, reason: undefined as string | undefined }
const second = { ...first, accountId: 'work' }
const unavailable = { ...first, model: 'unsupported', available: false, reason: 'agent_scope_unsupported' }
const options = [first, second, unavailable]
const room = { id: 'private-1', revision: 7, conversationKind: 'user_agent', members: [{ participantAgentId: 'agent-1' }] } as Room
const puts = () => api.request.mock.calls.filter(([, method]) => method === 'PUT')
const reasoning = (supportedEfforts: ModelReasoningEffort[], defaultEffort: ModelReasoningEffort): NonNullable<ModelProviderModelGroup['modelProfiles']>[string] =>
  ({ inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'],
    reasoning: { supportedEfforts, defaultEffort, requestProtocol: 'openai-chat-completions' } })

describe('direct composer model pill', () => {
  let renderer: ReactTestRenderer
  const saved = vi.fn(async () => undefined), onBusyChange = vi.fn()
  const mount = async (value: Room = room) => {
    await act(async () => { renderer = create(createElement(RoomDirectModelPicker, { room: value, onSaved: saved, onBusyChange })) })
  }
  const picker = () => renderer.root.findByType(FloatingComposerModelPicker).props
  const pickModel = async (group: string, model = 'model') => { await act(async () => picker().onComposerModelChange(model, group)) }
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('en')
    useChatStore.setState({ composerModelGroups: [] })
    api.request.mockImplementation(async (_path, method) => method === 'PUT' ? { room: { ...room, revision: 8 } } : { options, main: first })
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

  it('shows the exact room override and keeps accounts of one provider apart', async () => {
    api.request.mockResolvedValue({ options, main: first, roomOverride: second })
    await mount()
    expect(api.request.mock.calls[0][0]).toBe('/v1/agents/agent-1/models?room_id=private-1')
    expect(picker().composerProviderId).toBe('api::work')
    expect(picker().composerModelGroups.map((group: ModelProviderModelGroup) => group.label)).toEqual(['API · personal', 'API · work'])
    expect(picker().composerPickList).not.toContain('unsupported')
    expect(renderer.root.findAllByType('select')).toHaveLength(0)
    expect(renderer.root.findAllByType('small')).toHaveLength(0)
    expect(puts()).toHaveLength(0)
  })

  it('commits a model to this room and waits for the server before showing it', async () => {
    let resolve!: (value: unknown) => void
    let committed = false
    api.request.mockImplementation((_path, method) => method === 'PUT' ? new Promise((yes) => { resolve = yes })
      : Promise.resolve({ options, main: committed ? second : first }))
    await mount(); await pickModel('api::work')
    expect(picker().composerProviderId).toBe('api::personal')
    expect(picker().canChangeModel).toBe(false)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(puts()[0]).toEqual(['/v1/rooms/private-1/direct/model', 'PUT', { clientRequestId: expect.any(String), expectedRevision: 7,
      modelRef: { providerId: 'api', accountId: 'work', model: 'model' } }])
    committed = true
    await act(async () => resolve({ room: { ...room, revision: 8 } }))
    expect(picker().composerProviderId).toBe('api::work')
    expect(saved).toHaveBeenCalledOnce(); expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('deduplicates rapid picks and retries a failed request with the same id', async () => {
    let reject!: (value: unknown) => void
    api.request.mockImplementation((_path, method) => method === 'PUT' ? new Promise((_yes, no) => { reject = no }) : Promise.resolve({ options, main: first }))
    await mount()
    act(() => { picker().onComposerModelChange('model', 'api::work'); picker().onComposerModelChange('model', 'api::work') })
    expect(puts()).toHaveLength(1)
    await act(async () => reject(new Error('temporary failure')))
    expect(renderer.root.findByProps({ role: 'alert' })).toBeTruthy()
    await pickModel('api::work')
    expect(puts()[1][2].clientRequestId).toBe(puts()[0][2].clientRequestId)
    await act(async () => reject(new Error('temporary failure')))
  })

  it('stays locked while discovery fails and recovers through refresh', async () => {
    api.request.mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect(picker().canChangeModel).toBe(false)
    await act(async () => renderer.root.findByProps({ role: 'alert' }).findByType('button').props.onClick())
    expect(picker().canChangeModel).toBe(true)
    await pickModel('api::personal', 'unsupported'); expect(puts()).toHaveLength(0)
  })

  it('saves effort on its own, ignores the current effort and never writes for an unset room', async () => {
    useChatStore.setState({ composerModelGroups: [{ providerId: 'api', label: 'API', modelIds: ['model'],
      modelProfiles: { model: reasoning(['low', 'medium', 'high'], 'medium') } }] })
    await mount()
    expect(picker().composerReasoningEffort).toBe('medium')
    await act(async () => picker().onComposerReasoningEffortChange('medium'))
    expect(puts()).toHaveLength(0)
    await act(async () => picker().onComposerReasoningEffortChange('high'))
    expect(puts()[0][2]).toEqual({ clientRequestId: expect.any(String), expectedRevision: 7, reasoningEffort: 'high' })
  })

  it('refreshes inherited role changes without a conversation revision', async () => {
    await mount()
    api.request.mockResolvedValue({ options, main: second })
    await act(async () => renderer.update(createElement(RoomDirectModelPicker, { room, agentRevision: 1, onSaved: saved, onBusyChange })))
    expect(picker().composerProviderId).toBe('api::work')
    expect(puts()).toHaveLength(0)
  })

  it('ignores a late save after unmount and releases the composer lock', async () => {
    let resolve!: (value: unknown) => void
    api.request.mockImplementation((_path, method) => method === 'PUT' ? new Promise((yes) => { resolve = yes }) : Promise.resolve({ options, main: first }))
    await mount(); await pickModel('api::work'); act(() => renderer.unmount())
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    await act(async () => resolve({ room: { ...room, revision: 8 } }))
    expect(saved).not.toHaveBeenCalled()
  })
})

describe('direct model groups', () => {
  it('reuses Code labels, icons and order and adapts a stored effort to the next model', () => {
    const code: ModelProviderModelGroup[] = [{ providerId: 'deepseek', label: 'DeepSeek', presetSource: 'deepseek', modelIds: ['pro', 'flash'],
      modelProfiles: { pro: reasoning(['low', 'high', 'max'], 'high'), flash: reasoning(['low', 'medium'], 'low') } }]
    const result = directModelGroups([{ ...first, providerId: 'deepseek', model: 'flash' }, { ...first, providerId: 'deepseek', model: 'pro' }], code)
    expect(result.groups).toEqual([expect.objectContaining({ providerId: 'deepseek', label: 'DeepSeek', presetSource: 'deepseek', modelIds: ['pro', 'flash'] })])
    expect(directReasoningEffort('max', result.groups[0], 'pro')).toBe('max')
    expect(directReasoningEffort('max', result.groups[0], 'flash')).toBe('low')
    expect(directReasoningEffort(undefined, result.groups[0], 'pro')).toBe('high')
  })
})
