import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomDirectModelPicker } from './RoomDirectModelPicker'
import { modelBindingKey } from './agent-client'
const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', async (original) => ({ ...(await original<typeof import('./rooms-client')>()), roomsRequest: api.request }))
const first = { providerId: 'api', providerLabel: 'API', accountId: 'personal', model: 'model', available: true }
const second = { ...first, accountId: 'work' }
const unavailable = { ...first, model: 'unsupported', available: false, reason: 'agent_scope_unsupported' }
const options = [first, second, unavailable]
const room = { id: 'private-1', revision: 7, conversationKind: 'user_agent', members: [{ participantAgentId: 'agent-1' }] } as Room
const puts = () => api.request.mock.calls.filter(([, method]) => method === 'PUT')

describe('direct composer model switch', () => {
  let renderer: ReactTestRenderer
  const saved = vi.fn(async () => undefined), onBusyChange = vi.fn()
  const mount = async () => { await act(async () => { renderer = create(createElement(RoomDirectModelPicker, { room, onSaved: saved, onBusyChange })) }) }
  const change = async (option = second) => { await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: modelBindingKey(option) } })) }
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('en')
    api.request.mockImplementation(async (_path, method) => method === 'PUT' ? { room: { ...room, revision: 8 } } : { options, main: first })
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
  it('shows exact room override and distinguishes same model on different accounts', async () => {
    api.request.mockResolvedValue({ options, main: first, roomOverride: second })
    await mount()
    const select = renderer.root.findByType('select')
    expect(select.props.value).toBe(modelBindingKey(second))
    expect(select.props.title).toContain('API / work / model')
    expect(renderer.root.findAllByType('option').find((item) => item.props.value === modelBindingKey(second))!.children.join('')).toContain('model / API / work')
    expect(renderer.root.findByType('small').children.join('')).toBe('Applies to your next message in this chat')
    expect(api.request.mock.calls[0][0]).toBe('/v1/agents/agent-1/models?room_id=private-1')
    expect(renderer.root.findAllByType('option').find((item) => item.props.value === modelBindingKey(unavailable))!.props.disabled).toBe(true)
    expect(puts()).toHaveLength(0)
  })
  it('commits to the current room and waits for server confirmation before changing the display', async () => {
    let resolve!: (value: unknown) => void
    let committed = false
    api.request.mockImplementation((_path, method) => method === 'PUT' ? new Promise((yes) => { resolve = yes }) : Promise.resolve({ options, main: committed ? second : first }))
    await mount(); await change()
    expect(renderer.root.findByType('select').props.value).toBe(modelBindingKey(first))
    expect(renderer.root.findByType('select').props.disabled).toBe(true)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(puts()[0]).toEqual(['/v1/rooms/private-1/direct/model', 'PUT', { clientRequestId: expect.any(String), expectedRevision: 7, modelRef: { providerId: 'api', accountId: 'work', model: 'model' } }])
    committed = true
    await act(async () => resolve({ room: { ...room, revision: 8 } }))
    expect(renderer.root.findByType('select').props.value).toBe(modelBindingKey(second))
    expect(saved).toHaveBeenCalledOnce(); expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })
  it('deduplicates rapid selection and retries the same failed request id', async () => {
    let reject!: (value: unknown) => void
    api.request.mockImplementation((_path, method) => method === 'PUT' ? new Promise((_yes, no) => { reject = no }) : Promise.resolve({ options, main: first }))
    await mount()
    const select = renderer.root.findByType('select')
    act(() => { select.props.onChange({ target: { value: modelBindingKey(second) } }); select.props.onChange({ target: { value: modelBindingKey(second) } }) })
    expect(puts()).toHaveLength(1)
    await act(async () => reject(new Error('temporary failure')))
    expect(renderer.root.findByProps({ role: 'alert' })).toBeTruthy()
    expect(renderer.root.findByType('select').props.value).toBe(modelBindingKey(first))
    await change(); expect(puts()[1][2].clientRequestId).toBe(puts()[0][2].clientRequestId)
    await act(async () => reject(new Error('temporary failure')))
  })
  it('rejects disabled choices and recovers discovery errors through refresh', async () => {
    api.request.mockRejectedValueOnce(new Error('offline'))
    await mount(); expect(renderer.root.findByType('select').props.disabled).toBe(true)
    await act(async () => renderer.root.findByType('button').props.onClick())
    await change(unavailable); expect(puts()).toHaveLength(0)
    expect(renderer.root.findByType('select').props.disabled).toBe(false)
  })
  it('refreshes inherited role changes without requiring a conversation revision', async () => {
    await mount()
    api.request.mockResolvedValue({ options, main: second })
    await act(async () => renderer.update(createElement(RoomDirectModelPicker, { room, agentRevision: 1, onSaved: saved, onBusyChange })))
    expect(renderer.root.findByType('select').props.value).toBe(modelBindingKey(second))
    expect(puts()).toHaveLength(0)
  })
  it('ignores late save completion after unmount and releases composer lock', async () => {
    let resolve!: (value: unknown) => void
    api.request.mockImplementation((_path, method) => method === 'PUT' ? new Promise((yes) => { resolve = yes }) : Promise.resolve({ options, main: first }))
    await mount(); await change(); act(() => renderer.unmount())
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    await act(async () => resolve({ room: { ...room, revision: 8 } }))
    expect(saved).not.toHaveBeenCalled()
  })
})
